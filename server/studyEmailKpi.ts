import { addEvent, type Dossier } from "./dossierModel";
import { getLastStudyOutbound, isOutboundConfirmation } from "./dossierLifecycle";

export type StudyKpiGrossSource = "draft" | "table" | "hero" | "text" | "subject" | "manual";

export type StudyKpiRecord = {
  grossSavingsEur: number;
  feesCourtageEur: number;
  feesAssureurEur?: number;
  scenario?: "A" | "B" | "C";
  confidence: "high" | "medium" | "low";
  source: "gmail_outbound" | "study_draft" | "manual";
  gmailId: string;
  extractedAt: string;
  subject?: string;
  loanCapitalEur?: number;
  grossSource?: StudyKpiGrossSource;
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

const GROSS_SOURCE_RANK: Record<StudyKpiGrossSource, number> = {
  manual: 200,
  draft: 100,
  table: 85,
  hero: 55,
  text: 35,
  subject: 15,
};

const CONFIDENCE_RANK = { high: 30, medium: 20, low: 8 };

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

/** Montant affiché en grand — uniquement si libellé « économie brute » à proximité. */
function extractGrossFromHeroHtml(rawHtml: string): number | null {
  const html = decodeHtmlEntities(rawHtml);
  const afterLabel = html.match(
    /[ÉE]conomie brute estim[ée]e[\s\S]{0,500}?font-size:\s*(?:2[4-9]|3[0-9]|40)px[\s\S]{0,120}?>([^<]+)</i,
  );
  if (afterLabel?.[1]) {
    const n = parseEuroToken(afterLabel[1]);
    if (n != null) return n;
  }
  const hero = html.match(
    /font-size:\s*(?:2[4-9]|3[0-9]|40)px[\s\S]{0,220}?>([^<]+)</i,
  );
  if (hero?.[1]) {
    const n = parseEuroToken(hero[1]);
    if (n != null) return n;
  }
  return null;
}

/** Ligne de tableau « Économie brute » (pas « Assurance actuelle »). */
function extractGrossFromStudyTableHtml(rawHtml: string): number | null {
  const html = decodeHtmlEntities(rawHtml);
  const patterns = [
    /<td[^>]*>\s*[ÉE]conomie brute\s*<\/td>\s*<td[^>]*>\s*([^<]+)\s*<\/td>/i,
    /<td[^>]*>\s*ECONOMIE GENEREE\s*<\/td>\s*<td[^>]*>\s*([^<]+)\s*<\/td>/i,
    /[ÉE]conomie brute[\s\S]{0,80}?<span[^>]*>([^<]*€[^<]*)</i,
  ];
  for (const re of patterns) {
    const row = html.match(re);
    if (row?.[1]) {
      const n = parseEuroToken(row[1]);
      if (n != null) return n;
    }
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

export function isGrossSavingsPlausible(gross: number, loanCapitalEur: number): boolean {
  if (!Number.isFinite(gross) || gross < 0) return false;
  if (gross === 0) return true;
  if (!loanCapitalEur || loanCapitalEur <= 0) return true;
  return gross <= loanCapitalEur * 1.2;
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

type ParsedStudyKpi = Omit<StudyKpiRecord, "gmailId" | "extractedAt" | "source" | "loanCapitalEur">;

function rejectGrossIfInsuranceCollision(
  gross: number | null,
  grossSource: StudyKpiGrossSource | null,
  blob: string,
): { gross: number | null; grossSource: StudyKpiGrossSource | null } {
  const insuranceTotal =
    firstAmountAfter(/assurance actuelle/i, blob, 80) ??
    firstAmountAfter(/assurance actuelle \(durée restante\)/i, blob, 80);

  if (
    gross != null &&
    insuranceTotal != null &&
    Math.abs(gross - insuranceTotal) < 0.02
  ) {
    const retry = extractGrossFromTextBlob(
      blob.replace(/assurance actuelle[\s\S]{0,120}?\d[\d\s,.]*€/i, " "),
    );
    if (retry != null && Math.abs(retry - insuranceTotal) >= 0.02) {
      return { gross: retry, grossSource: "text" };
    }
    return { gross: null, grossSource: null };
  }
  return { gross, grossSource };
}

export function parseStudyEconomyFromEmailHtml(
  html: string,
  subject: string,
  loanCapitalEur = 0,
): ParsedStudyKpi | null {
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
      grossSource: "table",
      subject,
    };
  }

  let gross: number | null = null;
  let grossSource: StudyKpiGrossSource | null = null;

  if (rawHtml.length > 0) {
    gross = extractGrossFromStudyTableHtml(rawHtml);
    if (gross != null) grossSource = "table";
    if (gross == null) {
      gross = extractGrossFromHeroHtml(rawHtml);
      if (gross != null) grossSource = "hero";
    }
  }

  if (gross == null) {
    gross = extractGrossFromTextBlob(blob);
    if (gross != null) grossSource = "text";
  }

  if (gross == null) {
    gross = extractGrossFromStudySubject(subject);
    if (gross != null) grossSource = "subject";
  }

  ({ gross, grossSource } = rejectGrossIfInsuranceCollision(gross, grossSource, blob));

  if (gross != null && gross > 0 && !isGrossSavingsPlausible(gross, loanCapitalEur)) {
    gross = null;
    grossSource = null;
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
    gross != null && gross > 0 && grossSource === "table"
      ? "high"
      : gross != null && gross > 0 && grossSource === "hero"
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
    grossSource: grossSource || undefined,
    subject,
  };
}

function kpiQualityScore(
  kpi: Pick<StudyKpiRecord, "grossSavingsEur" | "confidence" | "grossSource">,
  loanCapitalEur: number,
): number {
  let score = CONFIDENCE_RANK[kpi.confidence] || 0;
  score += GROSS_SOURCE_RANK[kpi.grossSource || "subject"] || 0;
  if (Number(kpi.grossSavingsEur) > 0) score += 12;
  if (!isGrossSavingsPlausible(Number(kpi.grossSavingsEur) || 0, loanCapitalEur)) score -= 500;
  return score;
}

function isBetterKpi(next: ParsedStudyKpi, prev: StudyKpiRecord | undefined, loanCapitalEur: number): boolean {
  if (!prev) return true;
  const nextScore = kpiQualityScore(
    { grossSavingsEur: next.grossSavingsEur, confidence: next.confidence, grossSource: next.grossSource },
    loanCapitalEur,
  );
  const prevScore = kpiQualityScore(prev, loanCapitalEur);
  if (nextScore !== prevScore) return nextScore > prevScore;
  if (next.grossSavingsEur > 0 && prev.grossSavingsEur <= 0) return true;
  return false;
}

function writeStudyKpi(
  dossier: Dossier,
  parsed: ParsedStudyKpi,
  meta: { gmailId: string; date: string; source: StudyKpiRecord["source"] },
): boolean {
  const loanCapitalEur = getLoanCapitalFromDossier(dossier);
  const prev = dossier.studyKpi as StudyKpiRecord | undefined;
  if (prev?.source === "manual" && meta.source !== "manual") {
    return false;
  }
  if (prev?.gmailId === meta.gmailId && prev && !isBetterKpi(parsed, prev, loanCapitalEur)) {
    return false;
  }
  if (
    prev?.extractedAt &&
    prev.gmailId !== meta.gmailId &&
    new Date(meta.date).getTime() < new Date(prev.extractedAt).getTime() &&
    !isBetterKpi(parsed, prev, loanCapitalEur)
  ) {
    return false;
  }
  if (prev && prev.gmailId !== meta.gmailId && !isBetterKpi(parsed, prev, loanCapitalEur)) {
    return false;
  }

  dossier.studyKpi = {
    ...parsed,
    loanCapitalEur,
    source: meta.source,
    gmailId: meta.gmailId,
    extractedAt: meta.date,
  };

  addEvent(dossier, {
    type: "NOTE_ADDED",
    actor: { kind: "SYSTEM" },
    message: `KPI étude (${parsed.grossSource || meta.source}) : ${parsed.grossSavingsEur} € économie brute, confiance ${parsed.confidence}.`,
    meta: {
      template: "STUDY_KPI_EXTRACTED",
      gmailId: meta.gmailId,
      grossSavingsEur: parsed.grossSavingsEur,
      feesCourtageEur: parsed.feesCourtageEur,
      loanCapitalEur,
      scenario: parsed.scenario,
      confidence: parsed.confidence,
      grossSource: parsed.grossSource,
    },
  });

  return true;
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

  const loanCapitalEur = getLoanCapitalFromDossier(dossier);
  const parsed = parseStudyEconomyFromEmailHtml(html || text, params.subject, loanCapitalEur);
  if (!parsed) return false;

  return writeStudyKpi(dossier, parsed, {
    gmailId: params.gmailId,
    date: params.date,
    source: "gmail_outbound",
  });
}

/** KPI depuis le brouillon calculé (compute-economy) — source de vérité prioritaire. */
export function applyStudyKpiFromStudyDraft(dossier: Dossier): boolean {
  const draft = dossier.studyDraft as
    | {
        html?: string | null;
        subject?: string | null;
        computedAt?: string;
        reliability?: string;
        economySummary?: {
          grossSavingsEur?: number;
          feesCourtageEur?: number;
          feesAssureurEur?: number;
        };
      }
    | undefined;
  if (!draft) return false;

  const summary = draft.economySummary;
  if (summary && summary.grossSavingsEur != null) {
    const gross = Math.round(Number(summary.grossSavingsEur) || 0);
    const parsed: ParsedStudyKpi = {
      grossSavingsEur: gross,
      feesCourtageEur: Math.round(Number(summary.feesCourtageEur) || 0),
      feesAssureurEur: summary.feesAssureurEur,
      scenario: gross <= 0 ? "C" : gross < 500 ? "B" : "A",
      confidence: draft.reliability === "HIGH" ? "high" : "medium",
      grossSource: "draft",
      subject: draft.subject || undefined,
    };
    const loanCapitalEur = getLoanCapitalFromDossier(dossier);
    if (!isBetterKpi(parsed, dossier.studyKpi as StudyKpiRecord | undefined, loanCapitalEur)) {
      return Boolean(dossier.studyKpi?.grossSavingsEur != null);
    }
    return writeStudyKpi(dossier, parsed, {
      gmailId: `study_draft_${dossier.id}`,
      date: draft.computedAt || new Date().toISOString(),
      source: "study_draft",
    });
  }

  if (!draft.html) return false;
  const loanCapitalEur = getLoanCapitalFromDossier(dossier);
  const parsed = parseStudyEconomyFromEmailHtml(
    String(draft.html),
    String(draft.subject || ""),
    loanCapitalEur,
  );
  if (!parsed) return false;
  parsed.grossSource = "draft";
  parsed.confidence = draft.reliability === "HIGH" ? "high" : parsed.confidence;
  return writeStudyKpi(dossier, parsed, {
    gmailId: `study_draft_html_${dossier.id}`,
    date: draft.computedAt || new Date().toISOString(),
    source: "study_draft",
  });
}

/** Applique la meilleure source disponible : brouillon calculé > mail HTML. */
export function applyStudyKpiBestAvailable(
  dossier: Dossier,
  mailParams?: {
    subject: string;
    html?: string;
    text?: string;
    gmailId: string;
    date: string;
  },
): boolean {
  const fromDraft = applyStudyKpiFromStudyDraft(dossier);
  const loanCapitalEur = getLoanCapitalFromDossier(dossier);
  const currentOk =
    dossier.studyKpi &&
    isGrossSavingsPlausible(Number(dossier.studyKpi.grossSavingsEur) || 0, loanCapitalEur) &&
    dossier.studyKpi.grossSource === "draft";

  if (fromDraft && currentOk) return true;

  if (mailParams) {
    return applyStudyKpiFromGmailOutbound(dossier, mailParams) || fromDraft;
  }
  return fromDraft;
}

/** Rejoue l'extraction sur l'historique Gmail déjà synchronisé (backfill KPI). */
export function refreshStudyKpiFromCommunications(dossier: Dossier): boolean {
  const existing = dossier.studyKpi as StudyKpiRecord | undefined;
  if (existing?.source === "manual") return false;

  if (applyStudyKpiFromStudyDraft(dossier)) {
    const loan = getLoanCapitalFromDossier(dossier);
    const kpi = dossier.studyKpi;
    if (
      kpi?.grossSource === "draft" &&
      isGrossSavingsPlausible(Number(kpi.grossSavingsEur) || 0, loan)
    ) {
      return true;
    }
  }

  const loanCapitalEur = getLoanCapitalFromDossier(dossier);
  const comms = [...(dossier.communications || [])]
    .filter((c: any) => c.direction === "outbound")
    .sort((a: any, b: any) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

  let best: { parsed: ParsedStudyKpi; gmailId: string; date: string } | null = null;
  let bestScore = -Infinity;

  for (const c of comms) {
    const html = String(c.html || "");
    const text = String(c.text || "");
    const body = html.length >= text.length ? html : text;
    if (!isStudyEconomyOutboundEmail(String(c.subject || ""), body)) continue;
    const parsed = parseStudyEconomyFromEmailHtml(body, String(c.subject || ""), loanCapitalEur);
    if (!parsed) continue;
    const score = kpiQualityScore(parsed, loanCapitalEur);
    if (score > bestScore) {
      bestScore = score;
      best = {
        parsed,
        gmailId: String(c.gmailId || c.id || ""),
        date: String(c.date || dossier.updatedAt),
      };
    }
  }

  if (best && bestScore > -100) {
    const changed = writeStudyKpi(dossier, best.parsed, {
      gmailId: best.gmailId,
      date: best.date,
      source: "gmail_outbound",
    });
    if (changed) return true;
  }

  return applyStudyKpiFromStudyDraft(dossier);
}

/** Date de référence pour les totaux bandeau admin (date d'envoi étude > date extraction). */
export function getStudyKpiActivityDate(dossier: Dossier): number {
  const kpi = dossier.studyKpi;
  if (!kpi) return 0;
  const study = getLastStudyOutbound(dossier);
  const studyTs = study?.date ? new Date(study.date).getTime() : 0;
  const extractedTs = new Date(kpi.extractedAt || 0).getTime();
  if (studyTs > 0) return studyTs;
  return extractedTs;
}

/** Saisie manuelle admin — prioritaire sur l'extraction automatique. */
export function applyManualStudyKpi(
  dossier: Dossier,
  input: {
    grossSavingsEur: number;
    feesCourtageEur: number;
    loanCapitalEur?: number;
  },
): StudyKpiRecord {
  const gross = Math.round(Number(input.grossSavingsEur) || 0);
  const feesCourtageEur = Math.round(Number(input.feesCourtageEur) || 0);
  const loanCapitalEur =
    Number(input.loanCapitalEur) > 0
      ? Math.round(Number(input.loanCapitalEur))
      : getLoanCapitalFromDossier(dossier);
  const prev = dossier.studyKpi as StudyKpiRecord | undefined;
  const now = new Date().toISOString();
  const record: StudyKpiRecord = {
    grossSavingsEur: gross,
    feesCourtageEur,
    loanCapitalEur,
    scenario: gross <= 0 ? "C" : gross < 500 ? "B" : "A",
    confidence: "high",
    source: "manual",
    grossSource: "manual",
    gmailId: prev?.gmailId || `manual_${dossier.id}`,
    extractedAt: now,
    subject: prev?.subject,
  };
  dossier.studyKpi = record;
  addEvent(dossier, {
    type: "NOTE_ADDED",
    actor: { kind: "ADMIN", label: "Admin" },
    message: `KPI étude saisis manuellement : ${gross} € économie brute, ${feesCourtageEur} € courtage.`,
    meta: {
      template: "STUDY_KPI_MANUAL",
      grossSavingsEur: gross,
      feesCourtageEur,
      loanCapitalEur,
      source: "manual",
    },
  });
  return record;
}

export function formatEurKpi(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 €";
  return (
    Math.round(n).toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €"
  );
}
