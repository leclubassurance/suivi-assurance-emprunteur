import fs from "fs";
import path from "path";
import type { Dossier } from "./dossierModel";
import { addEvent } from "./dossierModel";
import { ensureDocumentLocalFile } from "./documentFileResolve";
import { computeEconomyFromDossierDocs, type EconomyComputation } from "./economyFromDocs";
import {
  computeAdeStudyEconomics,
  type AdeStudyComputation,
  type AdeYearRow,
} from "./adeStudyCompute";
import { generateAdeStudyPdfBuffer, DEFAULT_ADE_GUARANTEES } from "./adeStudyPdfGenerate";
import { ingestStudyPdfForDossier } from "./studyPdfFlow";
import { defaultEffectDateIso } from "./kereisDraftBuild";
import { extractDocsByCategories } from "./documentTextForAnalysis";
import { computeAdeStudyWithSkillGemini } from "./adeStudySkillGemini";

export type AdeStudyGenerateResult =
  | {
      ok: true;
      computation: AdeStudyComputation;
      studyDraft: Dossier["studyDraft"];
      studyKpi: Dossier["studyKpi"];
      studyPdf: any;
      parsed: any;
      feasibility?: import("./adeStudyFeasibility").AdeFeasibilityAssessment;
    }
  | {
      ok: false;
      error: string;
      code?:
        | "missing_devis"
        | "missing_tableau"
        | "files_unavailable"
        | "extraction_failed"
        | "low_feasibility"
        | "ingest_failed"
        | "unknown";
      hint?: string;
      computation?: AdeStudyComputation;
      reasons?: string[];
      feasibility?: import("./adeStudyFeasibility").AdeFeasibilityAssessment;
    };

type AssureLite = { name: string; birthIso: string | null };

/** Assurés du dossier (nom affichable + date de naissance si connue). */
function assuresFromDossier(dossier: Dossier): AssureLite[] {
  const list = (dossier.formData?.assures || []) as any[];
  const out: AssureLite[] = [];
  for (const a of list) {
    const name = [a?.prenom, a?.nom].filter(Boolean).join(" ").trim();
    if (!name) continue;
    out.push({
      name,
      birthIso: parseFrEffectToIso(String(a?.dateNaissance || a?.dateDeNaissance || a?.birthDate || "")),
    });
  }
  return out;
}

/** Nom client = tous les assurés (couple dans un même PDF). */
function clientNameFromDossier(dossier: Dossier): string {
  const names = assuresFromDossier(dossier).map((a) => a.name);
  return names.join(" & ") || dossier.id;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function formatFrLong(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return String(iso || "");
  try {
    // Format « 27 octobre 2026 » — conservé tel quel (le parseur d'étude lit cette forme).
    return new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function addMonthsIso(iso: string, months: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const index = m - 1 + months;
  const year = y + Math.floor(index / 12);
  const month = ((index % 12) + 12) % 12;
  const day = Math.min(d, new Date(year, month + 1, 0).getDate());
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function ageAtIso(birthIso: string, atIso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthIso) || !/^\d{4}-\d{2}-\d{2}$/.test(atIso)) return null;
  const [by, bm, bd] = birthIso.split("-").map(Number);
  const [ay, am, ad] = atIso.split("-").map(Number);
  let age = ay - by;
  if (am < bm || (am === bm && ad < bd)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/** Capital du prêt (formulaire ou brouillon Kereis) — indicatif pour la synthèse. */
function loanCapitalFromDossier(dossier: Dossier): number | null {
  const toNum = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = Number(String(v).replace(/[\s\u00a0€]/g, "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const pret = ((dossier.formData?.prets || []) as any[])[0] || {};
  const fromForm =
    toNum(pret.capitalRestant) ??
    toNum(pret.capitalRestantDu) ??
    toNum(pret.montant) ??
    toNum(dossier.formData?.montantPret);
  if (fromForm) return fromForm;
  const loans = ((dossier as any).kereisDraft?.steps?.prets || []) as any[];
  for (const loan of loans) {
    for (const f of (loan?.fields || []) as any[]) {
      if (/capital\s+restant/i.test(String(f?.label || ""))) {
        const n = toNum(f?.value);
        if (n) return n;
      }
    }
  }
  return null;
}

/** Situation loi Lemoine par assuré (formulations skill, sans conclusion définitive). */
function lemoineProfilesFor(
  assures: AssureLite[],
  loanEndIso: string | null,
  insuredCapitalEur: number | null,
): NonNullable<AdeStudyComputation["lemoineProfiles"]> {
  const capitalOver = insuredCapitalEur != null && insuredCapitalEur > 200_000;
  return assures.map((a) => {
    const age = a.birthIso && loanEndIso ? ageAtIso(a.birthIso, loanEndIso) : null;
    if (capitalOver) {
      return {
        name: a.name,
        tone: "orange" as const,
        text:
          "La part assurée sur l'encours dépasse le plafond légal de 200 000 € : l'assureur peut demander un " +
          "questionnaire de santé et, si nécessaire, des pièces ou examens complémentaires.",
      };
    }
    if (age != null && age >= 60) {
      return {
        name: a.name,
        tone: "orange" as const,
        text:
          "Le prêt se termine après son 60e anniversaire : l'assureur peut demander un questionnaire de santé et, " +
          "si nécessaire, des pièces ou examens complémentaires.",
      };
    }
    if (age != null) {
      return {
        name: a.name,
        tone: "green" as const,
        text:
          "Fin du prêt avant 60 ans et part assurée du prêt étudié inférieure à 200 000 € : absence de " +
          "questionnaire, sous réserve que ses autres encours assurés éventuels ne fassent pas dépasser le " +
          "plafond légal.",
      };
    }
    return {
      name: a.name,
      tone: "green" as const,
      text:
        "Les conditions d'exonération (plafond 200 000 € et fin du prêt avant 60 ans) s'apprécient sur " +
        "l'ensemble de vos encours. L'assureur indiquera lui-même si un questionnaire est requis — aucune " +
        "démarche médicale n'est à anticiper.",
    };
  });
}

/** Ventilation par assuré : proportions du devis (ou parts égales) appliquées aux totaux. */
function insuredBreakdownFor(
  assures: AssureLite[],
  individualProposed: number[],
  currentTotal: number,
  proposedTotal: number,
  feesTotal: number,
): NonNullable<AdeStudyComputation["insuredBreakdown"]> | undefined {
  const n = assures.length;
  if (n < 2) return undefined;

  const usable =
    individualProposed.length === n && individualProposed.every((v) => Number.isFinite(v) && v > 0)
      ? individualProposed
      : new Array(n).fill(1);
  const sum = usable.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return undefined;

  const rows: NonNullable<AdeStudyComputation["insuredBreakdown"]> = [];
  let currentLeft = round2(currentTotal);
  let proposedLeft = round2(proposedTotal);
  let feesLeft = round2(feesTotal);
  assures.forEach((a, i) => {
    const last = i === n - 1;
    const ratio = usable[i] / sum;
    const cur = last ? currentLeft : round2(currentTotal * ratio);
    const prop = last ? proposedLeft : round2(proposedTotal * ratio);
    const fee = last ? feesLeft : round2(feesTotal / n);
    currentLeft = round2(currentLeft - cur);
    proposedLeft = round2(proposedLeft - prop);
    feesLeft = round2(feesLeft - fee);
    rows.push({
      name: a.name,
      currentEur: cur,
      proposedEur: prop,
      feesEur: fee,
      netEur: round2(cur - prop - fee),
    });
  });
  return rows;
}

function parseFrEffectToIso(raw?: string): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const numeric = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (numeric) {
    return `${numeric[3]}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`;
  }
  const months: Record<string, string> = {
    janvier: "01",
    fevrier: "02",
    février: "02",
    mars: "03",
    avril: "04",
    mai: "05",
    juin: "06",
    juillet: "07",
    aout: "08",
    août: "08",
    septembre: "09",
    octobre: "10",
    novembre: "11",
    decembre: "12",
    décembre: "12",
  };
  const named = s.match(
    /(\d{1,2})\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\s+(\d{4})/i,
  );
  if (!named) return null;
  const moKey = named[2].toLowerCase();
  const mo =
    months[moKey] ||
    months[moKey.normalize("NFD").replace(/[\u0300-\u036f]/g, "")] ||
    null;
  if (!mo) return null;
  return `${named[3]}-${mo}-${named[1].padStart(2, "0")}`;
}

/** Résout les fichiers locaux (Drive si besoin) avant calcul. */
async function materializeLoanDocs(dossier: Dossier, uploadsDir: string): Promise<string[]> {
  const warnings: string[] = [];
  const docs = (dossier.formData?.documents || []) as any[];
  for (const doc of docs) {
    const cat = String(doc?.category || "").toLowerCase();
    if (!["offre", "tableau", "devis", "fiche"].includes(cat)) continue;
    const resolved = await ensureDocumentLocalFile(dossier, doc, uploadsDir);
    if (resolved.localPath) {
      doc.localPath = resolved.localPath;
    } else {
      warnings.push(`${doc.name || cat}: ${resolved.skipReason || "fichier manquant"}`);
    }
  }
  return warnings;
}

function economyToAdeComputation(
  eco: EconomyComputation,
  dossier: Dossier,
  effectFallbackIso: string,
): AdeStudyComputation | null {
  const clientName = clientNameFromDossier(dossier);
  const current = Number(eco.extracted.currentTotalRemaining || 0);
  const proposed = Number(eco.extracted.proposedTotalRemaining || 0);
  if (!(current > 0 && proposed > 0)) return null;

  const fees = round2(Number(eco.extracted.feesAssureurTotal || 0));
  const gross = round2(current - proposed);
  const net = round2(gross - fees);
  const savingsPercent = current > 0 ? round2((gross / current) * 1000) / 10 : 0;

  const currentByYear = eco.extracted.currentMonthlyByYear || [];
  const proposedByYear = eco.extracted.proposedMonthlyByYear || [];
  const yearCount = Math.max(currentByYear.length, proposedByYear.length, 1);

  const years: AdeYearRow[] = [];
  let cumul = 0;
  for (let y = 1; y <= yearCount; y++) {
    const cur =
      currentByYear.find((r) => r.year === y)?.total ??
      (currentByYear.find((r) => r.year === y)?.monthly != null
        ? round2((currentByYear.find((r) => r.year === y)!.monthly || 0) * 12)
        : 0);
    const propMonthly = proposedByYear.find((r) => r.year === y)?.monthly;
    let prop = propMonthly != null ? round2(propMonthly * 12) : 0;
    // Dernière année partielle : prorata si current months connus
    if (y === yearCount && currentByYear.find((r) => r.year === y)) {
      const monthsInYear = Math.max(
        1,
        Math.round(
          (currentByYear.find((r) => r.year === y)!.total || 0) /
            Math.max(0.01, currentByYear.find((r) => r.year === y)!.monthly || 1),
        ),
      );
      if (propMonthly != null && monthsInYear < 12) {
        prop = round2(propMonthly * monthsInYear);
      }
    }
    if (prop <= 0 && yearCount > 0) {
      // Répartition lissée si détail annuel proposé manquant sur cette année
      prop = round2(proposed / yearCount);
    }
    const fee = y === 1 ? fees : 0;
    const annualNet = round2(cur - prop - fee);
    cumul = round2(cumul + annualNet);
    years.push({
      year: y,
      currentEur: round2(cur),
      proposedEur: round2(prop),
      netSavingEur: annualNet,
      cumulNetEur: cumul,
    });
  }

  // Si totaux annuels ne collent pas, forcer une seule ligne synthèse + répartition lissée
  const sumCur = round2(years.reduce((a, r) => a + r.currentEur, 0));
  if (years.length && Math.abs(sumCur - current) > Math.max(50, current * 0.05)) {
    years.length = 0;
    cumul = 0;
    const months = eco.extracted.remainingMonths || Math.max(12, Math.round(current / 50));
    const fullYears = Math.floor(months / 12);
    const remMonths = months % 12;
    const curMonthly = current / months;
    const propMonthly = proposed / months;
    for (let y = 1; y <= fullYears + (remMonths ? 1 : 0); y++) {
      const m = y <= fullYears ? 12 : remMonths;
      const curY = round2(curMonthly * m);
      const propY = round2(propMonthly * m);
      const fee = y === 1 ? fees : 0;
      const annualNet = round2(curY - propY - fee);
      cumul = round2(cumul + annualNet);
      years.push({
        year: y,
        currentEur: curY,
        proposedEur: propY,
        netSavingEur: annualNet,
        cumulNetEur: cumul,
      });
    }
  }

  const year1ProposedEur =
    years[0]?.proposedEur ||
    (proposedByYear[0]?.monthly != null ? round2(proposedByYear[0].monthly * 12) : round2(proposed / Math.max(1, years.length)));

  const effectDateIso =
    parseFrEffectToIso(eco.extracted.proposedEffectiveDate) || effectFallbackIso;

  const confidence: AdeStudyComputation["confidence"] =
    eco.reliability === "HIGH" ? "high" : eco.reliability === "MEDIUM" ? "partial" : "low";

  const monthsCompared = eco.extracted.remainingMonths || years.length * 12;
  const loanEndIso = monthsCompared > 0 ? addMonthsIso(effectDateIso, monthsCompared - 1) : null;
  const assures = assuresFromDossier(dossier);
  const loanCapitalEur = loanCapitalFromDossier(dossier);

  const first8Years = years.slice(0, 8);
  const first8CurrentEur =
    years.length >= 8 && eco.extracted.currentTotal8y != null
      ? round2(eco.extracted.currentTotal8y)
      : round2(first8Years.reduce((a, r) => a + r.currentEur, 0));
  const first8ProposedEur =
    years.length >= 8 && eco.extracted.proposedTotal8y != null
      ? round2(eco.extracted.proposedTotal8y)
      : round2(first8Years.reduce((a, r) => a + r.proposedEur, 0));

  return {
    effectDateIso,
    currentTotalEur: round2(current),
    proposedTotalEur: round2(proposed),
    feesAssureurEur: fees,
    grossSavingsEur: gross,
    netSavingsEur: net,
    savingsPercent,
    year1ProposedEur,
    years,
    monthsCompared,
    guarantees: DEFAULT_ADE_GUARANTEES,
    assumptions: [
      `Calcul depuis échéancier + devis (fiabilité ${eco.reliability}).`,
      ...(eco.reasons || []).slice(0, 4),
    ],
    warnings: eco.reasons || [],
    confidence,
    clientName,
    provider: "heuristic",
    studyDateLabel: formatFrLong(new Date().toISOString().slice(0, 10)),
    comparisonEndLabel: loanEndIso ? formatFrLong(loanEndIso) : undefined,
    insuredBreakdown: insuredBreakdownFor(
      assures,
      eco.extracted.proposedInsuredTotals || [],
      round2(current),
      round2(proposed),
      fees,
    ),
    lemoineProfiles: assures.length
      ? lemoineProfilesFor(assures, loanEndIso, loanCapitalEur)
      : undefined,
    first8CurrentEur,
    first8ProposedEur,
    loanCapitalEur: loanCapitalEur ?? undefined,
  };
}

/** Complète un calcul (voie Gemini) avec le contexte dossier pour la présentation PDF. */
function enrichComputationFromDossier(
  comp: AdeStudyComputation,
  dossier: Dossier,
): AdeStudyComputation {
  const assures = assuresFromDossier(dossier);
  const monthsCompared = comp.monthsCompared || comp.years.length * 12;
  const loanEndIso = monthsCompared > 0 ? addMonthsIso(comp.effectDateIso, monthsCompared - 1) : null;
  const loanCapitalEur = loanCapitalFromDossier(dossier);
  const first8 = comp.years.slice(0, 8);

  return {
    ...comp,
    clientName: comp.clientName || clientNameFromDossier(dossier),
    guarantees: comp.guarantees?.length ? comp.guarantees : DEFAULT_ADE_GUARANTEES,
    studyDateLabel: formatFrLong(new Date().toISOString().slice(0, 10)),
    comparisonEndLabel: loanEndIso ? formatFrLong(loanEndIso) : undefined,
    lemoineProfiles: assures.length ? lemoineProfilesFor(assures, loanEndIso, loanCapitalEur) : undefined,
    first8CurrentEur: round2(first8.reduce((a, r) => a + r.currentEur, 0)),
    first8ProposedEur: round2(first8.reduce((a, r) => a + r.proposedEur, 0)),
    loanCapitalEur: loanCapitalEur ?? undefined,
  };
}

/**
 * Devis + échéancier → calcul → PDF comparatif → ingest KPI (parcours existant).
 */
export async function generateAndIngestAdeStudyForDossier(params: {
  dossier: Dossier;
  uploadsDir: string;
  actorLabel?: string;
}): Promise<AdeStudyGenerateResult> {
  const { dossier, uploadsDir } = params;
  const resolveWarnings = await materializeLoanDocs(dossier, uploadsDir);

  const docs = (dossier.formData?.documents || []) as any[];
  const hasDevis = docs.some(
    (d) =>
      String(d?.category || "").toLowerCase() === "devis" ||
      /devis/i.test(String(d?.name || "")),
  );
  const hasTableau = docs.some((d) => String(d?.category || "").toLowerCase() === "tableau");

  if (!hasDevis) {
    return {
      ok: false,
      code: "missing_devis",
      error: "Aucun devis assureur sur ce dossier.",
      hint: "Étape 2 : uploadez le PDF devis Kereis (souvent les deux assurés dans le même fichier).",
      reasons: resolveWarnings,
    };
  }
  if (!hasTableau) {
    return {
      ok: false,
      code: "missing_tableau",
      error: "Tableau d'amortissement manquant sur le dossier.",
      hint: "Dans Documents, ajoutez le tableau (catégorie « tableau »), puis réessayez.",
      reasons: resolveWarnings,
    };
  }

  const missingFiles = resolveWarnings.filter((w) => /manquant|missing|drive/i.test(w));
  if (missingFiles.length) {
    const docsNow = (dossier.formData?.documents || []) as any[];
    const tableauOk = docsNow.some(
      (d) => String(d?.category || "") === "tableau" && d?.localPath && fs.existsSync(String(d.localPath)),
    );
    const devisOk = docsNow.some(
      (d) =>
        (String(d?.category || "") === "devis" || /devis/i.test(String(d?.name || ""))) &&
        d?.localPath &&
        fs.existsSync(String(d.localPath)),
    );
    if (!tableauOk || !devisOk) {
      return {
        ok: false,
        code: "files_unavailable",
        error:
          "Fichiers introuvables sur le serveur (souvent après un redéploiement Railway).",
        hint: !tableauOk
          ? "Réimportez le tableau d'amortissement + le(s) devis, puis cliquez à nouveau sur Générer."
          : "Réimportez le(s) devis PDF, puis cliquez à nouveau sur Générer.",
        reasons: resolveWarnings,
      };
    }
  }

  // Score faisabilité : < 8/10 → pas de PDF auto (étude manuelle)
  const { assessAdeStudyFeasibility, ADE_FEASIBILITY_PASS_SCORE } = await import(
    "./adeStudyFeasibility"
  );
  const feasibility = await assessAdeStudyFeasibility(dossier);
  (dossier as any).adeStudyFeasibility = feasibility;

  if (!feasibility.pass) {
    return {
      ok: false,
      code: "low_feasibility",
      error: `Score faisabilité ${feasibility.score}/${feasibility.max} — génération auto refusée.`,
      hint:
        feasibility.score < ADE_FEASIBILITY_PASS_SCORE
          ? `Sous ${ADE_FEASIBILITY_PASS_SCORE}/10 : faites l'étude manuellement (PDF hors app), puis importez-la si besoin.`
          : "Documents incomplets ou montants illisibles — complétez tableaux/devis ou passez en manuel.",
      reasons: [
        ...feasibility.blockers,
        ...feasibility.checks.filter((c) => !c.ok).map((c) => `✗ ${c.label}${c.detail ? ` (${c.detail})` : ""}`),
        ...resolveWarnings.slice(0, 3),
      ].slice(0, 10),
      feasibility,
    };
  }

  const effectFromKereis = String((dossier as any).kereisDraft?.effectDateIso || "");
  const effectFallback =
    /^\d{4}-\d{2}-\d{2}$/.test(effectFromKereis) ? effectFromKereis : defaultEffectDateIso();

  const texts = await extractDocsByCategories(dossier, uploadsDir, ["tableau", "devis", "offre"]);
  const scheduleText = texts.filter((d) => d.category === "tableau").map((d) => d.text).join("\n\n");
  const devisText = texts.filter((d) => d.category === "devis").map((d) => d.text).join("\n\n");
  const offerText = texts.filter((d) => d.category === "offre").map((d) => d.text).join("\n\n");

  let computation: AdeStudyComputation | null = null;
  const skillReasons: string[] = [
    ...resolveWarnings,
    `Faisabilité ADE ${feasibility.score}/${feasibility.max} (≥ ${ADE_FEASIBILITY_PASS_SCORE} → auto).`,
  ];

  // Extraction locale d'abord (ancrages fiables : échéancier CE + totaux devis)
  const eco = await computeEconomyFromDossierDocs(dossier);
  const heuristic = economyToAdeComputation(eco, dossier, effectFallback);
  const anchors = {
    currentTotalEur: eco.extracted.currentTotalRemaining ?? null,
    proposedTotalEur: eco.extracted.proposedTotalRemaining ?? null,
    feesAssureurEur: eco.extracted.feesAssureurTotal ?? null,
    remainingMonths: eco.extracted.remainingMonths ?? null,
    proposedInsuredTotals: eco.extracted.proposedInsuredTotals ?? null,
    proposedEffectiveDate: eco.extracted.proposedEffectiveDate ?? null,
    currentMonthlyByYear: eco.extracted.currentMonthlyByYear ?? null,
    proposedMonthlyByYear: eco.extracted.proposedMonthlyByYear ?? null,
  };

  // 1) Gemini + skill, calé sur les ancrages locaux
  const skill = await computeAdeStudyWithSkillGemini({
    clientName: clientNameFromDossier(dossier),
    effectDateIso: effectFallback,
    assuresSummary: assuresFromDossier(dossier)
      .map((a) => (a.birthIso ? `${a.name} (né(e) ${a.birthIso})` : a.name))
      .join(" · "),
    scheduleText,
    devisText,
    offerText,
    anchors,
  });
  if (skill.ok) {
    computation = enrichComputationFromDossier(skill.computation, dossier);
    skillReasons.push("Étude calculée par Gemini selon le skill présentation ADE LCIF (ancrages locaux).");
  } else if ("error" in skill) {
    skillReasons.push(`Gemini skill: ${skill.error}`);
  }

  // Si heuristique HIGH, imposer ses totaux / années économiques (Gemini garde garanties)
  // Lemoine : page informative générique dans le PDF — on garde l'heuristique locale si dispo
  if (heuristic && heuristic.confidence === "high") {
    if (computation) {
      computation = {
        ...heuristic,
        guarantees: computation.guarantees?.length ? computation.guarantees : heuristic.guarantees,
        lemoineProfiles: heuristic.lemoineProfiles?.length
          ? heuristic.lemoineProfiles
          : computation.lemoineProfiles,
        insuredBreakdown: computation.insuredBreakdown?.length
          ? computation.insuredBreakdown.map((row, i) => {
              const h = heuristic.insuredBreakdown?.[i];
              return h
                ? {
                    ...row,
                    currentEur: h.currentEur,
                    proposedEur: h.proposedEur,
                    feesEur: h.feesEur,
                    netEur: h.netEur,
                  }
                : row;
            })
          : heuristic.insuredBreakdown,
        clientName: computation.clientName || heuristic.clientName,
        studyDateLabel: computation.studyDateLabel || heuristic.studyDateLabel,
        comparisonStartLabel: computation.comparisonStartLabel || heuristic.comparisonStartLabel,
        comparisonEndLabel: computation.comparisonEndLabel || heuristic.comparisonEndLabel,
        assumptions: [
          ...(heuristic.assumptions || []),
          "Économie : extraction locale HIGH ; rédaction garanties/Lemoine : Gemini skill.",
        ].slice(0, 10),
        provider: "mixed",
      };
      skillReasons.push("Économie forcée sur extraction locale HIGH (évite approximation Gemini du coût actuel).");
    } else {
      computation = heuristic;
      skillReasons.push(...(eco.reasons || []).slice(0, 4));
    }
  }

  // 2) Fallback heuristique si Gemini a échoué
  if (!computation || computation.confidence === "low") {
    if (
      heuristic &&
      heuristic.currentTotalEur > 0 &&
      heuristic.proposedTotalEur > 0
    ) {
      computation = heuristic;
      skillReasons.push(...(eco.reasons || []).slice(0, 4));
    }
  }

  // 3) Fallback Gemini léger (ancien extracteur) si toujours insuffisant
  if (!computation || computation.confidence === "low") {
    if (scheduleText.length >= 40 && devisText.length >= 40) {
      const alt = await computeAdeStudyEconomics({
        clientName: clientNameFromDossier(dossier),
        effectDateIso: effectFallback,
        scheduleText,
        devisText,
      });
      if (
        alt.currentTotalEur > 0 &&
        alt.proposedTotalEur > 0 &&
        (!computation || alt.confidence === "high" || alt.grossSavingsEur > (computation?.grossSavingsEur || 0))
      ) {
        computation = enrichComputationFromDossier(alt, dossier);
        skillReasons.push("Fallback extracteur Gemini devis/échéancier.");
      }
    }
  }

  if (!computation || computation.currentTotalEur <= 0 || computation.proposedTotalEur <= 0) {
    return {
      ok: false,
      code: "extraction_failed",
      error:
        "Impossible de calculer l'étude à partir du tableau et du devis (Gemini + heuristiques).",
      hint:
        "Vérifiez que le tableau et le devis sont bien lisibles, réuploadez-les si besoin, puis régénérez. Les devis Cardif multi-prêts nécessitent GEMINI_API_KEY côté serveur.",
      computation: computation || undefined,
      reasons: skillReasons,
    };
  }

  computation = {
    ...computation,
    assumptions: [...(computation.assumptions || []), ...skillReasons.filter((r) => /Gemini skill|Fallback/i.test(r))].slice(0, 10),
  };

  const pdfBuf = await generateAdeStudyPdfBuffer(computation);
  const dossierDir = path.join(uploadsDir, dossier.id);
  if (!fs.existsSync(dossierDir)) fs.mkdirSync(dossierDir, { recursive: true });
  const fileName = `Etude_economies_ADE_${dossier.id}_${Date.now()}.pdf`;
  const filePath = path.join(dossierDir, fileName);
  fs.writeFileSync(filePath, pdfBuf);

  (dossier as any).adeStudyComputation = {
    computedAt: new Date().toISOString(),
    ...computation,
    economyReliability: computation.provider === "gemini" ? "HIGH" : computation.confidence,
    economyReasons: skillReasons,
    feasibilityScore: feasibility.score,
  };

  const ingest = await ingestStudyPdfForDossier({
    dossier,
    filePath,
    originalName: fileName,
    mimeType: "application/pdf",
    size: pdfBuf.length,
    uploadsDir,
    actorLabel: params.actorLabel || "Génération étude ADE",
  });

  if (!ingest.ok) {
    return {
      ok: false,
      code: "ingest_failed",
      error: ingest.error || "PDF généré mais enregistrement KPI échoué.",
      hint: "Réessayez, ou importez le PDF manuellement via « Importer PDF d'étude ».",
      computation,
      reasons: resolveWarnings,
      feasibility,
    };
  }

  addEvent(dossier, {
    type: "AI_DECISION",
    actor: { kind: "SYSTEM", label: params.actorLabel || "ADE study" },
    message: `Étude PDF générée automatiquement — économie brute ${computation.grossSavingsEur} € (confiance ${computation.confidence}, faisabilité ${feasibility.score}/10).`,
    meta: {
      template: "ADE_STUDY_GENERATE",
      gross: computation.grossSavingsEur,
      confidence: computation.confidence,
      feasibilityScore: feasibility.score,
    },
  });

  return {
    ok: true,
    computation,
    studyDraft: dossier.studyDraft,
    studyKpi: dossier.studyKpi,
    studyPdf: (dossier as any).studyPdf,
    parsed: ingest.parsed,
    feasibility,
  };
}
