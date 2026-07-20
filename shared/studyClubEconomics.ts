import { parseLcifStudyEmailEconomics } from "./studyEconomicsParse";

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

export type StudyEconomicsSlice = {
  studyKpi?: {
    feesCourtageEur?: number;
    feesAssureurEur?: number;
    annualPremiumEur?: number;
    extractedAt?: string;
  };
  studyDraft?: {
    html?: string | null;
    subject?: string | null;
    extracted?: {
      proposedMonthlyByYear?: Array<{ year: number; monthly: number }>;
    };
    economySummary?: {
      grossSavingsEur?: number;
      feesCourtageEur?: number;
      feesAssureurEur?: number;
      annualPremiumEur?: number;
    };
  };
  studyConseillerValidation?: {
    feesCourtageTotalEur?: number;
    feesPerAssuredEur?: number;
    assuredCount?: number;
  };
  communications?: Array<{
    direction?: string;
    subject?: string;
    html?: string;
    text?: string;
    date?: string;
  }>;
};

function decodeHtmlEntities(s: string): string {
  return String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-zA-Z]+);/g, (_, name) => {
      const map: Record<string, string> = { nbsp: " ", euro: "€" };
      return map[name] ?? `&${name};`;
    });
}

/** Cotisation mensuelle proposée « Année 1 » dans le mail d'étude → prime annuelle. */
export function extractAnnualPremiumFromStudyHtml(rawHtml: string): number | null {
  const html = decodeHtmlEntities(String(rawHtml || ""));
  if (!html.trim()) return null;

  const rowPatterns = [
    />\s*Année\s*1\s*<[\s\S]{0,400}?<td[^>]*>\s*([^<]+)\s*<\/td>\s*<td[^>]*>\s*([^<]+)\s*<\/td>\s*<td[^>]*>\s*([^<]+)\s*<\/td>/i,
    /Année\s*1[\s\S]{0,200}?(\d{1,3}(?:[\s\u00a0.]\d{3})*(?:[,.]\d{2})?)\s*€[\s\S]{0,120}?(\d{1,3}(?:[\s\u00a0.]\d{3})*(?:[,.]\d{2})?)\s*€/i,
  ];

  for (const re of rowPatterns) {
    const m = html.match(re);
    if (!m) continue;
    const proposedIdx = m.length >= 4 ? 2 : 2;
    const proposed = parseEuroToken(m[proposedIdx]);
    if (proposed != null && proposed > 0) {
      return Math.round(proposed * 12);
    }
  }

  return null;
}

function resolveFirstYearMonthlyPremium(dossier: StudyEconomicsSlice): number | null {
  const fromDraftYears = dossier.studyDraft?.extracted?.proposedMonthlyByYear;
  if (fromDraftYears?.length) {
    const y1 = fromDraftYears.find((r) => r.year === 1) ?? fromDraftYears[0];
    if (y1?.monthly > 0) return y1.monthly;
  }
  return null;
}

function lastStudyOutboundHtml(dossier: StudyEconomicsSlice): string {
  const comms = [...(dossier.communications || [])]
    .filter((c) => c.direction === "outbound")
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  for (const c of comms) {
    const sub = String(c.subject || "");
    if (!/\b(étude|etude|économies|economies|assurance emprunteur)/i.test(sub)) continue;
    const html = String(c.html || c.text || "");
    if (html.length > 200) return html;
  }
  return String(dossier.studyDraft?.html || "");
}

/** Prime annuelle — saisie manuelle prioritaire, sinon mail / brouillon calculé. */
export function resolveAnnualPremiumEur(dossier: StudyEconomicsSlice): number {
  if (
    dossier.studyKpi?.source === "manual" &&
    dossier.studyKpi.annualPremiumEur != null &&
    Number(dossier.studyKpi.annualPremiumEur) > 0
  ) {
    return Math.round(Number(dossier.studyKpi.annualPremiumEur));
  }

  const fromSummary = dossier.studyDraft?.economySummary?.annualPremiumEur;
  if (fromSummary != null && Number(fromSummary) > 0) {
    return Math.round(Number(fromSummary));
  }

  const fromKpi = dossier.studyKpi?.annualPremiumEur;
  if (fromKpi != null && Number(fromKpi) > 0) {
    return Math.round(Number(fromKpi));
  }

  const html = lastStudyOutboundHtml(dossier) || String(dossier.studyDraft?.html || "");
  const fromParser = html ? parseLcifStudyEmailEconomics(html)?.annualPremiumEur : null;
  if (fromParser != null && fromParser > 0) return fromParser;

  const monthly = resolveFirstYearMonthlyPremium(dossier);
  if (monthly != null && monthly > 0) {
    return Math.round(monthly * 12);
  }

  return 0;
}

/** Frais de dossier assureur — saisie manuelle prioritaire, sinon brouillon / mail. */
export function resolveFeesAssureurEur(dossier: StudyEconomicsSlice): number {
  if (
    dossier.studyKpi?.source === "manual" &&
    dossier.studyKpi.feesAssureurEur != null &&
    Number(dossier.studyKpi.feesAssureurEur) > 0
  ) {
    return Math.round(Number(dossier.studyKpi.feesAssureurEur));
  }

  const fromKpi = dossier.studyKpi?.feesAssureurEur;
  if (fromKpi != null && Number(fromKpi) > 0) {
    return Math.round(Number(fromKpi));
  }

  const fromSummary = dossier.studyDraft?.economySummary?.feesAssureurEur;
  if (fromSummary != null && Number(fromSummary) > 0) {
    return Math.round(Number(fromSummary));
  }

  const html = lastStudyOutboundHtml(dossier) || String(dossier.studyDraft?.html || "");
  const fromParser = html ? parseLcifStudyEmailEconomics(html)?.feesAssureurEur : null;
  if (fromParser != null && fromParser > 0) return fromParser;

  return 0;
}

/** Complète courtage / frais dossier depuis validation conseiller ou brouillon si le mail ne les affiche pas. */
export function enrichParsedStudyFees(
  parsed: { feesCourtageEur: number; feesAssureurEur?: number; annualPremiumEur?: number },
  dossier: StudyEconomicsSlice,
): void {
  if (parsed.feesCourtageEur <= 0) {
    const candidates = [
      dossier.studyConseillerValidation?.feesCourtageTotalEur,
      dossier.studyDraft?.economySummary?.feesCourtageEur,
    ];
    for (const raw of candidates) {
      const n = Math.round(Number(raw) || 0);
      if (n > 0) {
        parsed.feesCourtageEur = n;
        break;
      }
    }
    if (parsed.feesCourtageEur <= 0) {
      const per = dossier.studyConseillerValidation?.feesPerAssuredEur;
      const count = dossier.studyConseillerValidation?.assuredCount;
      if (per != null && count != null && per > 0 && count > 0) {
        parsed.feesCourtageEur = Math.round(per * count);
      }
    }
  }

  if (parsed.feesAssureurEur == null || parsed.feesAssureurEur <= 0) {
    const fa = resolveFeesAssureurEur(dossier);
    if (fa > 0) parsed.feesAssureurEur = fa;
  }

  if (!parsed.annualPremiumEur || parsed.annualPremiumEur <= 0) {
    const prem = resolveAnnualPremiumEur(dossier);
    if (prem > 0) parsed.annualPremiumEur = prem;
  }
}
