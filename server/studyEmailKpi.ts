import { addEvent, type Dossier } from "./dossierModel";
import { isOutboundConfirmation } from "./dossierLifecycle";

export type StudyKpiRecord = {
  grossSavingsEur: number;
  feesCourtageEur: number;
  feesAssureurEur?: number;
  loanCapitalEur: number;
  scenario?: "A" | "B" | "C";
  confidence: "high" | "medium" | "low";
  source: "gmail_outbound";
  gmailId: string;
  extractedAt: string;
  subject?: string;
};

const STUDY_SUBJECT_RE =
  /\b(étude|etude)(\s+personnalisée|\s+personnalisee)?\b|économies|economies|économiser|economiser|assurance emprunteur/i;

function stripHtml(html: string): string {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function parseEuroToken(raw: string): number | null {
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

function firstAmountAfter(labelRe: RegExp, blob: string): number | null {
  const m = blob.match(labelRe);
  if (!m || m.index == null) return null;
  const tail = blob.slice(m.index + m[0].length, m.index + m[0].length + 120);
  const amt = tail.match(/(\d{1,3}(?:[\s\u00a0.]\d{3})*(?:[,.]\d{2})?)\s*€/);
  return amt ? parseEuroToken(amt[1]) : null;
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

  let gross =
    firstAmountAfter(/économie brute estimée/i, blob) ??
    firstAmountAfter(/économie brute/i, blob) ??
    firstAmountAfter(/ECONOMIE GENEREE/i, blob);

  const htmlGross = rawHtml.match(
    /Économie brute[\s\S]{0,400}?font-size:\s*36px[\s\S]{0,80}?>([^<]+)</i,
  );
  if (htmlGross?.[1]) {
    const fromHtml = parseEuroToken(htmlGross[1]);
    if (fromHtml != null) gross = fromHtml;
  }

  let feesCourtage: number | null = null;
  const courtageHtml = rawHtml.match(
    /Frais de courtage\s*:?\s*<\/span>\s*<span[^>]*>([^<]+)</i,
  );
  if (courtageHtml?.[1]) {
    feesCourtage = parseEuroToken(courtageHtml[1]);
  }
  if (feesCourtage == null) {
    const courtageRow = rawHtml.match(
      /Frais de courtage[\s\S]{0,120}?(\d{1,3}(?:[\s\u00a0.]\d{3})*(?:[,.]\d{2})?)\s*€/i,
    );
    if (courtageRow?.[1]) feesCourtage = parseEuroToken(courtageRow[1]);
  }
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
    gross != null && gross > 0 ? "high" : gross === 0 && scenario === "C" ? "high" : "medium";

  return {
    grossSavingsEur: gross ?? 0,
    feesCourtageEur: feesCourtage ?? 0,
    feesAssureurEur: feesAssureur,
    scenario,
    confidence,
    subject,
  };
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
  if (prev?.gmailId === params.gmailId) return true;
  if (prev?.extractedAt && new Date(params.date).getTime() < new Date(prev.extractedAt).getTime()) {
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
    message: `KPI étude extraits du mail Gmail (${parsed.grossSavingsEur} € économie brute).`,
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

/** Rejoue l'extraction sur l'historique Gmail déjà synchronisé (backfill KPI). */
export function refreshStudyKpiFromCommunications(dossier: Dossier): boolean {
  const comms = [...(dossier.communications || [])]
    .filter((c: any) => c.direction === "outbound")
    .sort((a: any, b: any) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

  for (const c of comms) {
    const html = String(c.html || "");
    const text = String(c.text || "");
    if (
      applyStudyKpiFromGmailOutbound(dossier, {
        subject: String(c.subject || ""),
        html,
        text,
        gmailId: String(c.gmailId || c.id || ""),
        date: String(c.date || dossier.updatedAt),
      })
    ) {
      return true;
    }
  }
  return false;
}

export function formatEurKpi(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 €";
  return (
    Math.round(n).toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €"
  );
}
