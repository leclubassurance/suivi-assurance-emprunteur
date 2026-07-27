/**
 * Score de faisabilité étude ADE auto (/10).
 * ≥ ADE_FEASIBILITY_PASS_SCORE → génération PDF autorisée
 * &lt; seuil → assistant ADE (ancrages manuels) ou étude hors app.
 */
import fs from "fs";
import { extractPdfTextFromBuffer } from "./pdfTextExtract";
import { computeEconomyFromDossierDocs, type EconomyComputation } from "./economyFromDocs";

export const ADE_FEASIBILITY_PASS_SCORE = 8;
export const ADE_FEASIBILITY_MAX = 10;

export type AdeFeasibilityCheck = {
  id: string;
  label: string;
  points: number;
  earned: number;
  ok: boolean;
  detail?: string;
};

export type AdeFeasibilityAssessment = {
  score: number;
  max: number;
  pass: boolean;
  threshold: number;
  checks: AdeFeasibilityCheck[];
  blockers: string[];
  summary: {
    tableauCount: number;
    tableauxParsed: number;
    currentTotalEur: number | null;
    remainingMonths: number | null;
    hasDevis: boolean;
    proposedTotalEur: number | null;
    feesAssureurEur: number | null;
    economyOk: boolean;
    economyReliability: EconomyComputation["reliability"] | null;
  };
  reasons: string[];
  assessedAt: string;
};

async function pdfTextLen(localPath?: string): Promise<number> {
  if (!localPath || !fs.existsSync(localPath)) return 0;
  try {
    const t = await extractPdfTextFromBuffer(fs.readFileSync(localPath));
    return t.trim().length;
  } catch {
    return 0;
  }
}

function pushCheck(
  checks: AdeFeasibilityCheck[],
  id: string,
  label: string,
  points: number,
  ok: boolean,
  detail?: string,
) {
  checks.push({
    id,
    label,
    points,
    earned: ok ? points : 0,
    ok,
    detail,
  });
}

/**
 * Évalue si l'extraction locale (tableaux + devis) est assez fiable pour un PDF auto.
 * Les montants restent pilotés par computeEconomyFromDossierDocs — ce score ne génère pas d'euros.
 */
export async function assessAdeStudyFeasibility(dossier: any): Promise<AdeFeasibilityAssessment> {
  const docs = (dossier?.formData?.documents || []) as any[];
  const tableaux = docs.filter((d) => String(d?.category || "") === "tableau");
  const devisList = docs.filter(
    (d) =>
      String(d?.category || "") === "devis" ||
      (/devis/i.test(String(d?.name || "")) && String(d?.category || "") !== "cni"),
  );
  const offre = docs.find((d) => String(d?.category || "") === "offre");

  const checks: AdeFeasibilityCheck[] = [];
  const blockers: string[] = [];

  // --- Tableaux lisibles (+2) ---
  let tableauxWithText = 0;
  for (const t of tableaux) {
    const len = await pdfTextLen(t?.localPath);
    if (len >= 40) tableauxWithText += 1;
  }
  const hasReadableTableau = tableauxWithText >= 1;
  pushCheck(
    checks,
    "tableau_readable",
    "Au moins un tableau d'amortissement lisible",
    2,
    hasReadableTableau,
    hasReadableTableau
      ? `${tableauxWithText}/${tableaux.length || 0} tableau(x) avec texte`
      : tableaux.length
        ? "Tableau(x) présents mais texte vide (scan image ?)"
        : "Aucun tableau sur le dossier",
  );
  if (!hasReadableTableau) {
    blockers.push(
      tableaux.length
        ? "Tableau d'amortissement illisible (probable scan) — étude manuelle."
        : "Aucun tableau d'amortissement — étude manuelle.",
    );
  }

  // --- Tous les tableaux uploadés parsables (+1) ---
  const allTableauxOk =
    tableaux.length === 0 ? false : tableauxWithText === tableaux.length;
  pushCheck(
    checks,
    "all_tableaux_parsed",
    "Tous les tableaux uploadés sont lisibles",
    1,
    allTableauxOk,
    tableaux.length
      ? `${tableauxWithText}/${tableaux.length} OK`
      : "Aucun tableau",
  );
  if (tableaux.length >= 2 && !allTableauxOk) {
    blockers.push(
      `${tableaux.length - tableauxWithText} tableau(x) illisible(s) sur ${tableaux.length} — risque de sous-estimer l'assurance actuelle.`,
    );
  }

  // Extraction économie (source de vérité montants)
  const eco = await computeEconomyFromDossierDocs(dossier);
  const current = eco.extracted.currentTotalRemaining ?? null;
  const proposed = eco.extracted.proposedTotalRemaining ?? null;
  const months = eco.extracted.remainingMonths ?? null;
  const fees = eco.extracted.feesAssureurTotal ?? null;

  // --- Coût actuel extrait (+2) ---
  const currentOk = current != null && current > 0;
  pushCheck(
    checks,
    "current_total",
    "Coût assurance actuelle restant extrait",
    2,
    currentOk,
    currentOk ? `${current!.toFixed(2)} €` : "Impossible d'extraire la colonne assurance",
  );
  if (!currentOk) {
    blockers.push("Coût actuel introuvable sur le(s) échéancier(s) — étude manuelle.");
  }

  // --- Durée / mois restants (+1) ---
  const monthsOk = months != null && months >= 12;
  pushCheck(
    checks,
    "remaining_months",
    "Durée restante cohérente (≥ 12 mois)",
    1,
    monthsOk,
    monthsOk ? `${months} mois` : "Durée restante absente ou trop courte",
  );

  // --- Multi-prêt : si plusieurs tableaux, totaux cumulés mentionnés (+1) ---
  const multiOk =
    tableaux.length <= 1 ||
    eco.reasons.some((r) => /tableaux d'amortissement cumulés/i.test(r));
  pushCheck(
    checks,
    "multi_loan",
    "Multi-prêts : cumuls cohérents (si plusieurs tableaux)",
    1,
    multiOk,
    tableaux.length <= 1
      ? "Un seul tableau"
      : multiOk
        ? "Plusieurs tableaux cumulés"
        : "Plusieurs tableaux sans cumuls détectés",
  );
  if (tableaux.length >= 2 && !multiOk) {
    blockers.push("Plusieurs tableaux sans cumul fiable — vérifier manuellement chaque prêt.");
  }

  // --- Devis (+2 proposed, +1 fees) ---
  const hasDevis = devisList.length > 0;
  let devisReadable = false;
  for (const d of devisList) {
    if ((await pdfTextLen(d?.localPath)) >= 40) {
      devisReadable = true;
      break;
    }
  }
  const proposedOk = proposed != null && proposed > 0;
  pushCheck(
    checks,
    "proposed_total",
    "Total cotisations devis extrait",
    2,
    proposedOk,
    proposedOk
      ? `${proposed!.toFixed(2)} €`
      : hasDevis
        ? devisReadable
          ? "Devis présent mais total introuvable"
          : "Devis illisible (scan ?)"
        : "Aucun devis uploadé",
  );
  if (!proposedOk) {
    blockers.push(
      hasDevis
        ? "Total devis introuvable — étude manuelle ou réupload devis."
        : "Déposez d'abord le devis, puis régénérez — ou faites l'étude à la main.",
    );
  }

  const feesOk = fees != null && fees > 0;
  pushCheck(
    checks,
    "fees",
    "Frais assureur (adhésion / dossier) extraits",
    1,
    feesOk,
    feesOk ? `${fees!.toFixed(2)} €` : "Frais non trouvés (souvent 75–110 €)",
  );

  // Score
  const score = Math.min(
    ADE_FEASIBILITY_MAX,
    checks.reduce((s, c) => s + c.earned, 0),
  );
  const pass = score >= ADE_FEASIBILITY_PASS_SCORE && currentOk && proposedOk;

  // Alertes non bloquantes dans reasons
  const reasons = [...eco.reasons];
  if (offre && (await pdfTextLen(offre.localPath)) < 40) {
    reasons.push("Offre de prêt peu lisible (non bloquant pour le score).");
  }
  if (currentOk && proposedOk && current! > 0 && proposed! > current! * 1.5) {
    reasons.push(
      `Attention: proposée (${proposed}) > actuelle (${current}) — vérifier double-comptage devis.`,
    );
  }

  if (!pass && score < ADE_FEASIBILITY_PASS_SCORE && !blockers.some((b) => /manuelle|assistant/i.test(b))) {
    blockers.push(
      `Score ${score}/${ADE_FEASIBILITY_MAX} < ${ADE_FEASIBILITY_PASS_SCORE} — ouvrez l'assistant ADE pour compléter les montants.`,
    );
  }

  return {
    score,
    max: ADE_FEASIBILITY_MAX,
    pass,
    threshold: ADE_FEASIBILITY_PASS_SCORE,
    checks,
    blockers: [...new Set(blockers)],
    summary: {
      tableauCount: tableaux.length,
      tableauxParsed: tableauxWithText,
      currentTotalEur: current,
      remainingMonths: months,
      hasDevis,
      proposedTotalEur: proposed,
      feesAssureurEur: fees,
      economyOk: eco.ok,
      economyReliability: eco.reliability,
    },
    reasons,
    assessedAt: new Date().toISOString(),
  };
}
