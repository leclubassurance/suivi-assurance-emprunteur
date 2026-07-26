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
import { generateAdeStudyPdfBuffer } from "./adeStudyPdfGenerate";
import { ingestStudyPdfForDossier } from "./studyPdfFlow";
import { defaultEffectDateIso } from "./kereisDraftBuild";
import { extractDocsByCategories } from "./documentTextForAnalysis";

export type AdeStudyGenerateResult =
  | {
      ok: true;
      computation: AdeStudyComputation;
      studyDraft: Dossier["studyDraft"];
      studyKpi: Dossier["studyKpi"];
      studyPdf: any;
      parsed: any;
    }
  | {
      ok: false;
      error: string;
      computation?: AdeStudyComputation;
      reasons?: string[];
    };

function clientNameFromDossier(dossier: Dossier): string {
  const a = (dossier.formData?.assures || [])[0] || {};
  return [a.prenom, a.nom].filter(Boolean).join(" ") || dossier.id;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
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
  clientName: string,
  effectFallbackIso: string,
): AdeStudyComputation | null {
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
    monthsCompared: eco.extracted.remainingMonths || years.length * 12,
    guarantees: [
      { label: "Décès", current: "Oui", proposed: "Oui" },
      { label: "PTIA", current: "Oui", proposed: "Oui" },
      { label: "ITT / IPT / IPP", current: "Oui", proposed: "Oui" },
    ],
    assumptions: [
      `Calcul depuis échéancier + devis (fiabilité ${eco.reliability}).`,
      ...(eco.reasons || []).slice(0, 4),
    ],
    warnings: eco.reasons || [],
    confidence,
    clientName,
    provider: "heuristic",
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
      error: "Déposez le devis assureur (PDF) dans l'étape « Uploader le devis » ci-dessus.",
      reasons: resolveWarnings,
    };
  }
  // Improve pipeline error when Drive files missing
  if (!hasTableau) {
    return {
      ok: false,
      error: "Tableau d'amortissement manquant sur le dossier.",
      reasons: resolveWarnings,
    };
  }

  const missingFiles = resolveWarnings.filter((w) => /manquant|missing|drive/i.test(w));
  if (missingFiles.length) {
    // Continue if at least one tableau+devis resolved locally; otherwise fail clearly.
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
        error:
          "Fichiers introuvables sur le serveur (disque Railway vidé après déploiement). Réuploadez le tableau et le(s) devis dans les étapes ci-dessus, puis regénérez.",
        reasons: resolveWarnings,
      };
    }
  }

  const effectFromKereis = String((dossier as any).kereisDraft?.effectDateIso || "");
  const effectFallback =
    /^\d{4}-\d{2}-\d{2}$/.test(effectFromKereis) ? effectFromKereis : defaultEffectDateIso();

  const eco = await computeEconomyFromDossierDocs(dossier);
  let computation = economyToAdeComputation(eco, clientNameFromDossier(dossier), effectFallback);

  // Fallback Gemini / heuristiques texte si parse échéancier CE a marché mais devis faible, ou inverse
  if (!computation || computation.confidence === "low") {
    const texts = await extractDocsByCategories(dossier, uploadsDir, ["tableau", "devis"]);
    const scheduleText = texts.filter((d) => d.category === "tableau").map((d) => d.text).join("\n\n");
    const devisText = texts.filter((d) => d.category === "devis").map((d) => d.text).join("\n\n");
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
        computation = alt;
      }
    }
  }

  if (!computation || computation.currentTotalEur <= 0 || computation.proposedTotalEur <= 0) {
    return {
      ok: false,
      error:
        "Extraction insuffisante (échéancier ou devis). Vérifiez que le tableau a une colonne assurance lisible et que le devis contient le total des cotisations.",
      computation: computation || undefined,
      reasons: [...resolveWarnings, ...(eco.reasons || [])],
    };
  }

  const pdfBuf = await generateAdeStudyPdfBuffer(computation);
  const dossierDir = path.join(uploadsDir, dossier.id);
  if (!fs.existsSync(dossierDir)) fs.mkdirSync(dossierDir, { recursive: true });
  const fileName = `Etude_economies_ADE_${dossier.id}_${Date.now()}.pdf`;
  const filePath = path.join(dossierDir, fileName);
  fs.writeFileSync(filePath, pdfBuf);

  (dossier as any).adeStudyComputation = {
    computedAt: new Date().toISOString(),
    ...computation,
    economyReliability: eco.reliability,
    economyReasons: eco.reasons,
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
      error: ingest.error || "PDF généré mais ingest KPI échoué.",
      computation,
      reasons: resolveWarnings,
    };
  }

  addEvent(dossier, {
    type: "AI_DECISION",
    actor: { kind: "SYSTEM", label: params.actorLabel || "ADE study" },
    message: `Étude PDF générée automatiquement — économie brute ${computation.grossSavingsEur} € (confiance ${computation.confidence}).`,
    meta: {
      template: "ADE_STUDY_GENERATE",
      gross: computation.grossSavingsEur,
      confidence: computation.confidence,
    },
  });

  return {
    ok: true,
    computation,
    studyDraft: dossier.studyDraft,
    studyKpi: dossier.studyKpi,
    studyPdf: (dossier as any).studyPdf,
    parsed: ingest.parsed,
  };
}
