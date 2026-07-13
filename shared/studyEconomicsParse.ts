/**
 * Extraction des montants depuis le HTML du mail d'étude LCIF
 * (template buildEconomyHtmlDraft — structure stable).
 */

export type ParsedStudyEconomics = {
  grossSavingsEur: number;
  feesCourtageEur: number;
  feesAssureurEur: number;
  /** Cotisation mensuelle proposée année 1. */
  proposedMonthlyYear1Eur: number;
  /** Prime annuelle = proposedMonthlyYear1 × 12. */
  annualPremiumEur: number;
  currentInsuranceTotalEur: number;
  proposedInsuranceTotalEur: number;
  confidence: "high" | "partial" | "low";
};

function parseEuroToken(raw: string): number | null {
  const s = String(raw || "")
    .replace(/\u00a0/g, " ")
    .replace(/[^\d,.\s€]/g, "")
    .trim();
  if (!s || /selon barème|___/i.test(s)) return null;
  const m = s.match(/(\d{1,3}(?:[\s.]\d{3})*|\d+)(?:[,.](\d{2}))?/);
  if (!m) return null;
  const whole = m[1].replace(/[\s.]/g, "");
  const cents = m[2] ?? "00";
  const n = Number(`${whole}.${cents}`);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function decodeHtml(html: string): string {
  return String(html || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-zA-Z]+);/g, (_, name) => {
      const map: Record<string, string> = { nbsp: " ", euro: "€", eacute: "é" };
      return map[name] ?? `&${name};`;
    });
}

function stripTags(html: string): string {
  return decodeHtml(html)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function amountAfterLabel(html: string, labelRe: RegExp): number | null {
  const h = decodeHtml(html);
  const m = h.match(labelRe);
  if (!m || m.index == null) return null;
  const tail = h.slice(m.index + m[0].length, m.index + m[0].length + 200);
  const span = tail.match(/<span[^>]*>([^<]+)<\/span>/i);
  if (span?.[1]) return parseEuroToken(span[1]);
  const plain = tail.match(/(\d{1,3}(?:[\s\u00a0.]\d{3})*(?:[,.]\d{2})?)\s*€/);
  return plain?.[1] ? parseEuroToken(plain[1]) : null;
}

function tableRowAmount(html: string, labelPattern: RegExp): number | null {
  const h = decodeHtml(html);
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(h))) {
    const inner = m[1];
    const label = stripTags(inner.split(/<\/td>/i)[0] || "");
    if (!labelPattern.test(label)) continue;
    const tds = [...inner.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (tds.length >= 2) {
      const val = parseEuroToken(stripTags(tds[tds.length - 1][1]));
      if (val != null) return val;
    }
  }
  return null;
}

/** Lignes du tableau « Évolution estimée des cotisations ». */
export function extractEvolutionTableRows(
  html: string,
): Array<{ label: string; currentMonthly: number | null; proposedMonthly: number | null }> {
  const h = decodeHtml(html);
  const rows: Array<{ label: string; currentMonthly: number | null; proposedMonthly: number | null }> = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let match: RegExpExecArray | null;
  while ((match = trRe.exec(h))) {
    const inner = match[1];
    if (/Proposée\s*\/\s*mois|Actuelle\s*\/\s*mois|<th/i.test(inner)) continue;
    const tds = [...inner.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      stripTags(m[1]),
    );
    if (tds.length < 3) continue;
    const label = tds[0].trim();
    if (!label || /période|periode/i.test(label)) continue;
    rows.push({
      label,
      currentMonthly: parseEuroToken(tds[1]),
      proposedMonthly: parseEuroToken(tds[2]),
    });
  }
  return rows;
}

export function parseLcifStudyEmailEconomics(html: string, _subject = ""): ParsedStudyEconomics | null {
  const raw = String(html || "");
  if (raw.length < 200) return null;
  const blob = stripTags(raw);
  if (!/charles victor|club immobilier|économie brute|economie brute/i.test(blob)) {
    return null;
  }

  if (/déjà bien optimisée|deja bien optimisee/i.test(blob)) {
    return {
      grossSavingsEur: 0,
      feesCourtageEur: 0,
      feesAssureurEur: 0,
      proposedMonthlyYear1Eur: 0,
      annualPremiumEur: 0,
      currentInsuranceTotalEur: 0,
      proposedInsuranceTotalEur: 0,
      confidence: "high",
    };
  }

  const gross =
    tableRowAmount(raw, /Économie brute|Economie brute/) ??
    (() => {
      const hero = raw.match(
        /Économie brute estim[ée]e[\s\S]{0,400}?font-size:\s*(?:2[4-9]|3[0-9]|40)px[\s\S]{0,120}?>([^<]+)</i,
      );
      return hero?.[1] ? parseEuroToken(hero[1]) : null;
    })() ??
    0;

  const feesAssureur =
    amountAfterLabel(raw, /Frais de dossier de la nouvelle assurance\s*:/i) ??
    amountAfterLabel(raw, /Frais de dossier\s*:/i) ??
    0;

  const feesCourtage =
    amountAfterLabel(raw, /Frais de courtage\s*:/i) ??
    (() => {
      const m = blob.match(/frais de courtage\s*:?\s*(\d[\d\s.,]*€)/i);
      return m?.[1] ? parseEuroToken(m[1]) : null;
    })() ??
    0;

  const currentInsuranceTotalEur =
    tableRowAmount(raw, /Assurance actuelle\s*\(durée restante\)/i) ?? 0;
  const proposedInsuranceTotalEur =
    tableRowAmount(raw, /Nouvelle assurance\s*\(durée restante\)/i) ?? 0;

  const evolutionRows = extractEvolutionTableRows(raw);
  const year1 =
    evolutionRows.find((r) => /^année\s*1$/i.test(r.label.trim())) ??
    evolutionRows.find((r) => /année\s*1/i.test(r.label)) ??
    evolutionRows[0];
  const proposedMonthlyYear1Eur = year1?.proposedMonthly ?? 0;
  const annualPremiumEur =
    proposedMonthlyYear1Eur > 0 ? Math.round(proposedMonthlyYear1Eur * 12) : 0;

  let confidence: ParsedStudyEconomics["confidence"] = "low";
  if (feesCourtage > 0 && annualPremiumEur > 0) confidence = "high";
  else if (feesAssureur > 0 || gross > 0 || annualPremiumEur > 0) confidence = "partial";

  return {
    grossSavingsEur: Math.round(gross),
    feesCourtageEur: Math.round(feesCourtage),
    feesAssureurEur: Math.round(feesAssureur),
    proposedMonthlyYear1Eur: Math.round(proposedMonthlyYear1Eur * 100) / 100,
    annualPremiumEur,
    currentInsuranceTotalEur: Math.round(currentInsuranceTotalEur),
    proposedInsuranceTotalEur: Math.round(proposedInsuranceTotalEur),
    confidence,
  };
}
