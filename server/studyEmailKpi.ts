import { addEvent, type Dossier } from "./dossierModel";
import { isOutboundConfirmation } from "./dossierLifecycle";

export type StudyKpiRecord = {
  grossSavingsEur: number;
  feesCourtageEur: number;
  feesAssureurEur?: number;
  scenario?: "A" | "B" | "C";
  confidence: "high" | "medium" | "low";
  source: "gmail_outbound";
  gmailId: string;
  extractedAt: string;
  subject?: string;
};

const STUDY_SUBJECT_RE =
  /\b(étude|etude)(\s+personnalisée|\s+personnalisee)?\b|économies|economies|économiser|economiser|assurance emprunteur/i;

const NAMED_HTML_ENTITIES: Record<string, string> = {
  nbsp: " ",
  eacute: "é",
  Eacute: "É",
  egrave: "è",
  agrave: "à",
  ucirc: "û",
  icirc: "î",
  ocirc: "ô",
  ccedil: "ç",
  euro: "€",
};

function decodeHtmlEntities(s: string): string {
  return String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&([a-zA-Z]+);/g, (_, name) => NAMED_HTML_ENTITIES[name] ?? `&${name};`)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function stripHtml(html: string): string {
  return decodeHtmlEntities(String(html || ""))
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseEuroToken(raw: string): number | null {
  const s = String(raw || "")
    .replace(/\u00a0/g, " ")
    .replace(/[^\d,.\s]/g, "")
    .trim();
  if (!s) return null;
  const m = s.match(/(\d{1,3}(?:[\s.]\d{3})*|\d+)(?:[,.](\d{2}))?/);
  if (!m) return null;
  const whole = m[1].replace(/[\s.]/g, "");
  const cents = m[2] ? m[2] : "00";
  const n = Number(`${whole}.${cents}`);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function firstAmountAfter(labelRe: RegExp, blob: string, windowChars = 140): number | null {
  const m = blob.match(labelRe);
  if (!m || m.index == null) return null;
  const tail = blob.slice(m.index + m[0].length, m.index + m[0].length + windowChars);
  const amt = tail.match(/(\d{1,3}(?:[\s\u00a0.]\d{3})*(?:[,.]\d{2})?)\s*€/);
  return amt ? parseEuroToken(amt[1]) : null;
}

/** Montant dans l'objet « … économiser ~12 345 € ». */
export function extractGrossFromStudySubject(subject: string): number | null {
  const m = String(subject || "").match(
    /économiser\s*~?\s*([\d\s\u00a0.]+)\s*€/i,
  );
  return m?.[1] ? parseEuroToken(m[1]) : null;
}

/** Montant affiché en grand (bloc bleu) — source la plus fiable. */
function extractGrossFromHeroHtml(rawHtml: string): number | null {
  const html = decodeHtmlEntities(rawHtml);
  const hero = html.match(
    /font-size:\s*(?:2[4-9]|3[0-9]|40)px[\s\S]{0,220}?>([^<]+)</i,
  );
  if (hero?.[1]) {
    const n = parseEuroToken(hero[1]);
    if (n != null) return n;
  }
  const afterLabel = html.match(
    /[ÉE]conomie brute estim[ée]e[\s\S]{0,500}?font-size:\s*(?:2[4-9]|3[0-9]|40)px[\s\S]{0,120}?>([^<]+)</i,
  );
  if (afterLabel?.[1]) {
    const n = parseEuroToken(afterLabel[1]);
    if (n != null) return n;
  }
  return null;
}

/** Ligne de tableau « Économie brute » (pas « Assurance actuelle »). */
function extractGrossFromStudyTableHtml(rawHtml: string): number | null {
  const html = decodeHtmlEntities(rawHtml);
  const row = html.match(
    /<td[^>]*>\s*[ÉE]conomie brute\s*<\/td>\s*<td[^>]*>\s*([^<]+)\s*<\/td>/i,
  );
  if (row?.[1]) {
    const n = parseEuroToken(row[1]);
    if (n != null) return n;
  }
  return null;
}

function extractGrossFromTextBlob(blob: string): number | null {
  const fromEstimee = firstAmountAfter(/[ée]conomie brute estim[ée]e/i, blob, 100);
  if (fromEstimee != null) return fromEstimee;

  const fromGeneree =
    firstAmountAfter(/[ée]conomie\s+g[ée]n[ée]r[ée]e/i, blob, 80) ??
    firstAmountAfter(/economie\s+generee/i, blob, 80);
  if (fromGeneree != null) return fromGeneree;

  const rowMatch = blob.match(
    /[ée]conomie brute\s+(\d{1,3}(?:[\s\u00a0.]\d{3})*(?:[,.]\d{2})?)\s*€/i,
  );
  if (rowMatch?.[1]) {
    const idx = rowMatch.index ?? 0;
    const before = blob.slice(Math.max(0, idx - 40), idx).toLowerCase();
    if (!/actuelle|nouvelle assurance/.test(before)) {
      const n = parseEuroToken(rowMatch[1]);
      if (n != null) return n;
    }
  }
  return null;
}

function extractFeesCourtageFromHtml(rawHtml: string, blob: string): number | null {
  const html = decodeHtmlEntities(rawHtml);
  const patterns = [
    /Frais de courtage\s*:?\s*<\/span>\s*<span[^>]*>([^<]+)</i,
    /Frais de courtage[\s\S]{0,80}?<span[^>]*>([^<]+€[^<]*)</i,
    /Frais de courtage[\s\S]{0,120}?(\d{1,3}(?:[\s\u00a0.]\d{3})*(?:[,.]\d{2})?)\s*€/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      const n = parseEuroToken(m[1]);
      if (n != null && !/_{2,}|___/.test(m[1])) return n;
    }
  }
  return (
    firstAmountAfter(/frais de courtage/i, blob) ??
    firstAmountAfter(/frais courtage/i, blob) ??
    null
  );
}

export function getLoanCapitalFromDossier(dossier: Dossier | any): number {
  const prets = dossier?.formData?.prets || [];
  let sum = 0;
  for (const p of prets) {
    const n = Number(p?.capitalRestant);
    if (Number.isFinite(n) && n > 0) sum += n;
  }
  return Math.round(sum);
}

export function isStudyEconomyOutboundEmail(subject: string, body: string): boolean {
  const sub = String(subject || "");
  const blob = stripHtml(body).slice(0, 12000);
  if (isOutboundConfirmation(sub, blob)) return false;
  if (STUDY_SUBJECT_RE.test(sub) && /charles victor|club immobilier/i.test(blob)) return true;
  if (
    /charles victor/i.test(blob) &&
    (/économie brute|economie brute|évolution estimée des cotisations/i.test(blob) ||
      /déjà bien optimisée|deja bien optimisee/i.test(blob))
  ) {
    return true;
  }
  return false;
}

export function parseStudyEconomyFromEmailHtml(
  html: string,
  subject: string,
): Omit<StudyKpiRecord, "gmailId" | "extractedAt" | "source" | "loanCapitalEur"> | null {
  const rawHtml = String(html || "");
  const blob = stripHtml(rawHtml || subject);
  if (!isStudyEconomyOutboundEmail(subject, rawHtml || blob)) return null;

  if (/déjà bien optimisée|deja bien optimisee|pas.*amélioration économique/i.test(blob)) {
    return {
      grossSavingsEur: 0,
      feesCourtageEur: 0,
      feesAssureurEur: 0,
      scenario: "C",
      confidence: "high",
      subject,
    };
  }

  let gross: number | null = null;
  let grossSource: "hero" | "table" | "text" | null = null;

  if (rawHtml.length > 0) {
    gross = extractGrossFromHeroHtml(rawHtml);
    if (gross != null) grossSource = "hero";
    if (gross == null) {
      gross = extractGrossFromStudyTableHtml(rawHtml);
      if (gross != null) grossSource = "table";
    }
  }

  if (gross == null) {
    gross = extractGrossFromTextBlob(blob);
    if (gross != null) grossSource = "text";
  }

  if (gross == null) {
    gross = extractGrossFromStudySubject(subject);
    if (gross != null) grossSource = "text";
  }

  const insuranceTotal =
    firstAmountAfter(/assurance actuelle/i, blob, 80) ??
    firstAmountAfter(/assurance actuelle \(durée restante\)/i, blob, 80);
  if (
    gross != null &&
    insuranceTotal != null &&
    Math.abs(gross - insuranceTotal) < 0.02 &&
    grossSource !== "hero"
  ) {
    gross = extractGrossFromTextBlob(blob.replace(/assurance actuelle[\s\S]{0,120}?\d[\d\s,.]*€/i, " "));
    if (gross == null || Math.abs(gross - insuranceTotal) < 0.02) {
      gross = null;
    }
  }

  let feesCourtage = rawHtml.length > 0 ? extractFeesCourtageFromHtml(rawHtml, blob) : null;
  if (feesCourtage == null) {
    feesCourtage =
      firstAmountAfter(/frais de courtage/i, blob) ??
      firstAmountAfter(/frais courtage/i, blob) ??
      0;
  }

  const feesAssureur =
    firstAmountAfter(/frais de dossier/i, blob) ??
    firstAmountAfter(/frais de dossier de la nouvelle assurance/i, blob) ??
    undefined;

  let scenario: "A" | "B" | "C" = "A";
  if ((gross ?? 0) <= 0) scenario = "C";
  else if ((gross ?? 0) < 500) scenario = "B";

  const confidence: "high" | "medium" | "low" =
    gross != null && gross > 0 && grossSource === "hero"
      ? "high"
      : gross != null && gross > 0
        ? "medium"
        : gross === 0 && scenario === "C"
          ? "high"
          : "low";

  return {
    grossSavingsEur: gross ?? 0,
    feesCourtageEur: feesCourtage ?? 0,
    feesAssureurEur: feesAssureur,
    scenario,
    confidence,
    subject,
  };
}

function isBetterKpi(
  next: Omit<StudyKpiRecord, "gmailId" | "extractedAt" | "source" | "loanCapitalEur">,
  prev: StudyKpiRecord | undefined,
): boolean {
  if (!prev) return true;
  const rank = { high: 3, medium: 2, low: 1 };
  if ((rank[next.confidence] || 0) > (rank[prev.confidence] || 0)) return true;
  if ((rank[next.confidence] || 0) < (rank[prev.confidence] || 0)) return false;
  if (next.grossSavingsEur > 0 && prev.grossSavingsEur <= 0) return true;
  return false;
}

export function applyStudyKpiFromGmailOutbound(
  dossier: Dossier,
  params: {
    subject: string;
    html?: string;
    text?: string;
    gmailId: string;
    date: string;
  },
): boolean {
  const html = params.html || "";
  const text = params.text || "";
  const body = html || text;
  if (!isStudyEconomyOutboundEmail(params.subject, body)) return false;

  const parsed = parseStudyEconomyFromEmailHtml(html || text, params.subject);
  if (!parsed) return false;

  const prev = dossier.studyKpi as StudyKpiRecord | undefined;
  if (prev?.gmailId === params.gmailId && prev && !isBetterKpi(parsed, prev)) {
    return true;
  }
  if (
    prev?.extractedAt &&
    prev.gmailId !== params.gmailId &&
    new Date(params.date).getTime() < new Date(prev.extractedAt).getTime()
  ) {
    return false;
  }
  if (prev && prev.gmailId !== params.gmailId && !isBetterKpi(parsed, prev)) {
    return false;
  }

  const loanCapitalEur = getLoanCapitalFromDossier(dossier);

  dossier.studyKpi = {
    ...parsed,
    loanCapitalEur,
    source: "gmail_outbound",
    gmailId: params.gmailId,
    extractedAt: params.date,
  };

  addEvent(dossier, {
    type: "NOTE_ADDED",
    actor: { kind: "SYSTEM" },
    message: `KPI étude extraits du mail Gmail (${parsed.grossSavingsEur} € économie brute, confiance ${parsed.confidence}).`,
    meta: {
      template: "STUDY_KPI_EXTRACTED",
      gmailId: params.gmailId,
      grossSavingsEur: parsed.grossSavingsEur,
      feesCourtageEur: parsed.feesCourtageEur,
      loanCapitalEur,
      scenario: parsed.scenario,
      confidence: parsed.confidence,
    },
  });

  return true;
}

/** KPI depuis le brouillon calculé (compute-economy) ou son HTML. */
export function applyStudyKpiFromStudyDraft(dossier: Dossier): boolean {
  const draft = dossier.studyDraft as
    | {
        html?: string | null;
        subject?: string | null;
        computedAt?: string;
        economySummary?: {
          grossSavingsEur?: number;
          feesCourtageEur?: number;
          feesAssureurEur?: number;
        };
      }
    | undefined;
  if (!draft) return false;

  const summary = draft.economySummary;
  if (summary && Number(summary.grossSavingsEur) > 0) {
    const parsed = {
      grossSavingsEur: Math.round(Number(summary.grossSavingsEur) || 0),
      feesCourtageEur: Math.round(Number(summary.feesCourtageEur) || 0),
      feesAssureurEur: summary.feesAssureurEur,
      scenario: "A" as const,
      confidence: "high" as const,
      subject: draft.subject || undefined,
    };
    if (!isBetterKpi(parsed, dossier.studyKpi as StudyKpiRecord | undefined)) {
      return Boolean(dossier.studyKpi?.grossSavingsEur);
    }
    dossier.studyKpi = {
      ...parsed,
      loanCapitalEur: getLoanCapitalFromDossier(dossier),
      source: "gmail_outbound",
      gmailId: `study_draft_${dossier.id}`,
      extractedAt: draft.computedAt || new Date().toISOString(),
    };
    addEvent(dossier, {
      type: "NOTE_ADDED",
      actor: { kind: "SYSTEM" },
      message: `KPI étude depuis brouillon calculé (${parsed.grossSavingsEur} € économie brute).`,
      meta: { template: "STUDY_KPI_FROM_DRAFT", grossSavingsEur: parsed.grossSavingsEur },
    });
    return true;
  }

  if (!draft.html) return false;
  return applyStudyKpiFromGmailOutbound(dossier, {
    subject: String(draft.subject || ""),
    html: String(draft.html),
    text: String(draft.html),
    gmailId: `study_draft_html_${dossier.id}`,
    date: draft.computedAt || new Date().toISOString(),
  });
}

/** Rejoue l'extraction sur l'historique Gmail déjà synchronisé (backfill KPI). */
export function refreshStudyKpiFromCommunications(dossier: Dossier): boolean {
  const comms = [...(dossier.communications || [])]
    .filter((c: any) => c.direction === "outbound")
    .sort((a: any, b: any) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

  for (const c of comms) {
    const html = String(c.html || "");
    const text = String(c.text || "");
    const body = html.length >= text.length ? html : text;
    if (
      applyStudyKpiFromGmailOutbound(dossier, {
        subject: String(c.subject || ""),
        html: body,
        text,
        gmailId: String(c.gmailId || c.id || ""),
        date: String(c.date || dossier.updatedAt),
      })
    ) {
      return true;
    }
  }
  return applyStudyKpiFromStudyDraft(dossier);
}

export function formatEurKpi(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 €";
  return (
    Math.round(n).toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €"
  );
}
