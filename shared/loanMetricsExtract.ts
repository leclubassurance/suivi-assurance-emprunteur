/**
 * Extraction déterministe CRD / taux / durée depuis texte offre ou échéancier.
 * Complète Gemini quand l'IA rate ou renvoie du bruit (nom, date…).
 */

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Parse nombre FR en refusant lettres / dates. */
export function parseLoanNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const s0 = String(raw ?? "").trim();
  if (!s0) return null;
  if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(s0.replace(/\s/g, ""))) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s0)) return null;
  const cleaned = s0
    .replace(/\s/g, "")
    .replace(/%/g, "")
    .replace(/€/gi, "")
    .replace(",", ".");
  if (/[a-zA-Zàâäéèêëïîôùûüç]/i.test(cleaned.replace(/[eE][+-]?\d+$/, ""))) return null;
  const m = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

export function looksLikeLoanRate(raw: unknown): boolean {
  const n = parseLoanNumber(raw);
  return n != null && n > 0 && n <= 25;
}

export function looksLikeLoanCapital(raw: unknown): boolean {
  const n = parseLoanNumber(raw);
  return n != null && n >= 1000;
}

export function looksLikeLoanDurationMonths(raw: unknown): boolean {
  const n = parseLoanNumber(raw);
  return n != null && n >= 1 && n <= 600;
}

function firstMatch(text: string, patterns: RegExp[]): number | null {
  const t = norm(text);
  for (const re of patterns) {
    const m = t.match(re);
    if (!m?.[1]) continue;
    const n = parseLoanNumber(m[1]);
    if (n != null) return n;
  }
  return null;
}

/** Taux nominal hors assurance (pas TAEG / TAEA / assurance). */
export function extractTauxNominalFromText(text: string): number | null {
  if (!text || text.length < 20) return null;
  const n = firstMatch(text, [
    /taux\s+nominal(?:\s+hors\s+assurance)?[^0-9%]{0,40}(\d{1,2}(?:[.,]\d{1,4})?)\s*%/,
    /taux\s+(?:du\s+)?pret[^0-9%]{0,30}(\d{1,2}(?:[.,]\d{1,4})?)\s*%/,
    /taux\s+fixe[^0-9%]{0,30}(\d{1,2}(?:[.,]\d{1,4})?)\s*%/,
    /(?:^|\n)[^\n]{0,40}taux(?!\s*(?:aeg|aea|assurance|effectif))[^\n]{0,40}?(\d{1,2}(?:[.,]\d{1,4})?)\s*%/,
  ]);
  return n != null && n > 0 && n <= 25 ? n : null;
}

export function extractCapitalFromText(text: string): number | null {
  if (!text || text.length < 20) return null;
  const n = firstMatch(text, [
    /capital\s+restant\s+du[^0-9]{0,40}(\d{1,3}(?:[\s.]\d{3})*(?:[.,]\d+)?|\d+(?:[.,]\d+)?)/,
    /crd[^0-9]{0,20}(\d{1,3}(?:[\s.]\d{3})*(?:[.,]\d+)?|\d+(?:[.,]\d+)?)/,
    /montant\s+(?:du\s+)?pret[^0-9]{0,40}(\d{1,3}(?:[\s.]\d{3})*(?:[.,]\d+)?|\d+(?:[.,]\d+)?)/,
  ]);
  return n != null && n >= 1000 ? n : null;
}

export function extractDureeMoisFromText(text: string): number | null {
  if (!text || text.length < 20) return null;
  const months = firstMatch(text, [
    /duree\s+restante[^0-9]{0,30}(\d{1,3})\s*(?:mois|m\b)/,
    /(\d{1,3})\s*mois\s+restant/,
  ]);
  if (months != null && months >= 1 && months <= 600) return Math.round(months);
  const years = firstMatch(text, [/duree[^0-9]{0,30}(\d{1,2})\s*ans/]);
  if (years != null && years >= 1 && years <= 50) return Math.round(years * 12);
  return null;
}

export function extractLoanMetricsFromText(text: string): {
  capitalRestantDu: number | null;
  tauxNominal: number | null;
  dureeRestanteMois: number | null;
} {
  return {
    capitalRestantDu: extractCapitalFromText(text),
    tauxNominal: extractTauxNominalFromText(text),
    dureeRestanteMois: extractDureeMoisFromText(text),
  };
}

export function formatTauxForForm(n: number): string {
  const s = String(Number(n.toFixed(4)));
  return s.replace(".", ",");
}
