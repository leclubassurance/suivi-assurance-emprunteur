/**
 * Extraction des montants depuis le texte d'un PDF d'étude LCIF
 * (template « Votre étude d'économies sur l'assurance de prêt »).
 */

export type ParsedStudyPdfEconomics = {
  grossSavingsEur: number | null;
  netSavingsEur: number | null;
  feesAssureurEur: number | null;
  currentInsuranceTotalEur: number | null;
  proposedInsuranceTotalEur: number | null;
  /** Cotisation annuelle proposée ≈ Année 1 « Nouvelle solution » × 12. */
  annualPremiumEur: number | null;
  proposedMonthlyYear1Eur: number | null;
  loanCapitalEur: number | null;
  plannedChangeDate: string | null;
  savingsPercent: number | null;
  confidence: "high" | "partial" | "low";
};

function parseEuroToken(raw: string): number | null {
  const s = String(raw || "")
    .replace(/\u00a0/g, " ")
    .replace(/[^\d,.\s]/g, "")
    .trim();
  if (!s) return null;
  const m = s.match(/(\d{1,3}(?:[\s.]\d{3})*|\d+)(?:[,.](\d{2}))?/);
  if (!m) return null;
  const whole = m[1].replace(/[\s.]/g, "");
  const cents = m[2] ?? "00";
  const n = Number(`${whole}.${cents}`);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function amountAfterLabel(text: string, labelRe: RegExp, windowChars = 80): number | null {
  const m = text.match(labelRe);
  if (!m || m.index == null) return null;
  const tail = text.slice(m.index + m[0].length, m.index + m[0].length + windowChars);
  const amt = tail.match(/(\d{1,3}(?:[\s\u00a0.]\d{3})*(?:[,.]\d{2})?)\s*€/);
  return amt ? parseEuroToken(amt[1]) : null;
}

function parseFrDateToIso(raw: string): string | null {
  const s = String(raw || "").trim();
  const m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Parse le texte brut extrait du PDF d'étude. */
export function parseStudyEconomicsFromPdfText(rawText: string): ParsedStudyPdfEconomics {
  const text = String(rawText || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");

  const gross =
    amountAfterLabel(text, /ÉCONOMIE\s+BRUTE\b/i) ??
    amountAfterLabel(text, /Économie\s+brute\b/i);
  const net =
    amountAfterLabel(text, /ÉCONOMIE\s+NETTE(?:\s+ESTIMÉE)?\b/i) ??
    amountAfterLabel(text, /Économie\s+nette\b/i);
  const feesAssureur =
    amountAfterLabel(text, /Frais\s+de\s+dossier\b/i) ??
    amountAfterLabel(text, /frais\s+assureur\b/i);
  const currentTotal =
    amountAfterLabel(text, /CO[ÛU]T\s+ACTUEL\s+RESTANT\b/i) ??
    amountAfterLabel(text, /Assurance\s+actuelle\b/i);
  const proposedTotal =
    amountAfterLabel(text, /NOUVELLE\s+SOLUTION\b/i) ??
    amountAfterLabel(text, /Nouvelle\s+solution\b/i);

  let proposedMonthlyYear1: number | null = null;
  const year1 = text.match(
    /Ann[ée]e\s*1\s+(\d{1,3}(?:[\s.]\d{3})*(?:[,.]\d{2})?)\s*€\s+(\d{1,3}(?:[\s.]\d{3})*(?:[,.]\d{2})?)\s*€/i,
  );
  if (year1?.[2]) {
    proposedMonthlyYear1 = parseEuroToken(year1[2]);
  }

  const annualPremiumEur =
    proposedMonthlyYear1 != null ? Math.round(proposedMonthlyYear1 * 12 * 100) / 100 : null;

  let loanCapitalEur: number | null = null;
  const capital =
    text.match(/Prêt\s+immobilier\s*[—–\-]\s*(\d{1,3}(?:[\s.]\d{3})+)\s*€/i) ||
    text.match(/capital\s+(?:initial|emprunté)\s*[:=]?\s*(\d{1,3}(?:[\s.]\d{3})+)\s*€/i);
  if (capital?.[1]) {
    const n = Number(capital[1].replace(/[\s.]/g, ""));
    if (Number.isFinite(n) && n > 0) loanCapitalEur = n;
  }

  let plannedChangeDate: string | null = null;
  const dateM =
    text.match(/date\s+d['’]effet\s+du\s+(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i) ||
    text.match(/à\s+compter\s+de\s+la\s+date\s+d['’]effet\s+du\s+(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i);
  if (dateM?.[1]) plannedChangeDate = parseFrDateToIso(dateM[1]);

  let savingsPercent: number | null = null;
  const pct = text.match(/soit\s+(-?\d+(?:[,.]\d+)?)\s*%/i) || text.match(/\n(-?\d+(?:[,.]\d+)?)\s*%/);
  if (pct?.[1]) {
    const n = Number(pct[1].replace(",", "."));
    if (Number.isFinite(n)) savingsPercent = Math.abs(n);
  }

  const filled = [gross, feesAssureur, currentTotal, proposedTotal, annualPremiumEur].filter(
    (v) => v != null,
  ).length;
  const confidence: ParsedStudyPdfEconomics["confidence"] =
    gross != null && filled >= 4 ? "high" : gross != null ? "partial" : "low";

  return {
    grossSavingsEur: gross,
    netSavingsEur: net,
    feesAssureurEur: feesAssureur,
    currentInsuranceTotalEur: currentTotal,
    proposedInsuranceTotalEur: proposedTotal,
    annualPremiumEur,
    proposedMonthlyYear1Eur: proposedMonthlyYear1,
    loanCapitalEur,
    plannedChangeDate,
    savingsPercent,
    confidence,
  };
}
