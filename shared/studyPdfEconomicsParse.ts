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

function amountAfterLabel(text: string, labelRe: RegExp, windowChars = 120): number | null {
  const m = text.match(labelRe);
  if (!m || m.index == null) return null;
  const tail = text.slice(m.index + m[0].length, m.index + m[0].length + windowChars);
  const amt = tail.match(/(\d{1,3}(?:[\s\u00a0.]\d{3})*(?:[,.]\d{2})?)\s*€/);
  return amt ? parseEuroToken(amt[1]) : null;
}

/** Ligne Total / ventilation : actuelle | nouvelle | économie. */
function parseTotalsRow(text: string): {
  current: number | null;
  proposed: number | null;
  economy: number | null;
} {
  const row =
    text.match(
      /Total\s+(\d{1,3}(?:[\s\u00a0.]\d{3})*(?:[,.]\d{2})?)\s*€\s+(\d{1,3}(?:[\s\u00a0.]\d{3})*(?:[,.]\d{2})?)\s*€\s+(\d{1,3}(?:[\s\u00a0.]\d{3})*(?:[,.]\d{2})?)\s*€/i,
    ) ||
    text.match(
      /Prêt\s+[^\n]{0,80}?(\d{1,3}(?:[\s\u00a0.]\d{3})*(?:[,.]\d{2})?)\s*€\s+(\d{1,3}(?:[\s\u00a0.]\d{3})*(?:[,.]\d{2})?)\s*€\s+(\d{1,3}(?:[\s\u00a0.]\d{3})*(?:[,.]\d{2})?)\s*€/i,
    );
  if (!row) return { current: null, proposed: null, economy: null };
  return {
    current: parseEuroToken(row[1]),
    proposed: parseEuroToken(row[2]),
    economy: parseEuroToken(row[3]),
  };
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

  const totals = parseTotalsRow(text);

  let gross =
    amountAfterLabel(text, /Économie\s+brute\b/i) ??
    amountAfterLabel(text, /ÉCONOMIE\s+BRUTE\b/i) ??
    totals.economy;
  const net =
    amountAfterLabel(text, /Économie\s+nette(?:\s+estimée)?\b/i) ??
    amountAfterLabel(text, /ÉCONOMIE\s+NETTE(?:\s+ESTIMÉE)?\b/i);
  const feesAssureur =
    amountAfterLabel(text, /Frais\s+de\s+dossier\b/i) ??
    amountAfterLabel(text, /frais\s+assureur\b/i) ??
    amountAfterLabel(text, /Aucun\s+frais\s+de\s+dossier/i);
  let currentTotal =
    totals.current ??
    amountAfterLabel(text, /CO[ÛU]T\s+ACTUEL\s+RESTANT\b/i) ??
    amountAfterLabel(text, /Assurance\s+actuelle(?:\s*\([^)]*\))?\b/i);
  let proposedTotal =
    totals.proposed ??
    amountAfterLabel(text, /NOUVELLE\s+SOLUTION\b/i) ??
    amountAfterLabel(text, /Nouvelle\s+solution\b/i) ??
    amountAfterLabel(text, /Solution\s+propos[ée]e\b/i) ??
    amountAfterLabel(text, /Co[ûu]t\s+propos[ée]\b/i);

  // Si le PDF n'expose que actuel + économie brute → déduire la nouvelle solution.
  if (
    proposedTotal == null &&
    currentTotal != null &&
    gross != null &&
    currentTotal >= gross
  ) {
    proposedTotal = Math.round((currentTotal - gross) * 100) / 100;
  }
  if (gross == null && currentTotal != null && proposedTotal != null && currentTotal >= proposedTotal) {
    gross = Math.round((currentTotal - proposedTotal) * 100) / 100;
  }

  let proposedMonthlyYear1: number | null = null;
  const year1Patterns = [
    /Ann[ée]e\s*1\s+(\d{1,3}(?:[\s.]\d{3})*(?:[,.]\d{2})?)\s*€\s+(\d{1,3}(?:[\s.]\d{3})*(?:[,.]\d{2})?)\s*€/i,
    /Ann[ée]e\s*1[^\d]{0,40}?(\d{1,3}(?:[\s.]\d{3})*(?:[,.]\d{2})?)\s*€[^\d]{0,40}?(\d{1,3}(?:[\s.]\d{3})*(?:[,.]\d{2})?)\s*€/i,
  ];
  for (const re of year1Patterns) {
    const year1 = text.match(re);
    if (year1?.[2]) {
      proposedMonthlyYear1 = parseEuroToken(year1[2]);
      if (proposedMonthlyYear1 != null) break;
    }
  }

  const annualPremiumEur =
    proposedMonthlyYear1 != null ? Math.round(proposedMonthlyYear1 * 12 * 100) / 100 : null;

  let loanCapitalEur: number | null = null;
  const capital =
    text.match(/Prêt\s+immobilier\s*[—–\-]\s*(\d{1,3}(?:[\s.]\d{3})+|\d+)\s*€/i) ||
    text.match(/capital\s+(?:initial|emprunté|restant)\s*[:=]?\s*(\d{1,3}(?:[\s.]\d{3})+|\d+)\s*€/i) ||
    text.match(/montant\s+(?:du\s+)?prêt\s*[:=]?\s*(\d{1,3}(?:[\s.]\d{3})+|\d+)\s*€/i);
  if (capital?.[1]) {
    const n = Number(capital[1].replace(/[\s.]/g, ""));
    if (Number.isFinite(n) && n > 0) loanCapitalEur = n;
  }

  let plannedChangeDate: string | null = null;
  const dateM =
    text.match(/date\s+d['’]effet\s+du\s+(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i) ||
    text.match(/à\s+compter\s+de\s+la\s+date\s+d['’]effet\s+du\s+(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i) ||
    text.match(/prise\s+d['’]effet\s*[:=]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i) ||
    text.match(/effectif(?:ve)?\s+(?:au|le)\s+(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i);
  if (dateM?.[1]) plannedChangeDate = parseFrDateToIso(dateM[1]);

  let savingsPercent: number | null = null;
  const pct = text.match(/soit\s+(-?\d+(?:[,.]\d+)?)\s*%/i) || text.match(/\n(-?\d+(?:[,.]\d+)?)\s*%/);
  if (pct?.[1]) {
    const n = Number(pct[1].replace(",", "."));
    if (Number.isFinite(n)) savingsPercent = Math.abs(n);
  } else if (gross != null && currentTotal != null && currentTotal > 0) {
    savingsPercent = Math.round((gross / currentTotal) * 1000) / 10;
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
