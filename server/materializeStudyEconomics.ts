import type { Dossier } from "./dossierModel";
import { addEvent } from "./dossierModel";
import { isStudyEconomyOutboundEmail } from "./studyEmailKpi";
import { parseLcifStudyEmailEconomics } from "../shared/studyEconomicsParse";
import { syncClubRevenueKpiFromStudy } from "./clubRevenueKpi";
import type { StudyKpiRecord } from "./studyEmailKpi";

export type StudyEconomicsSnapshot = {
  grossSavingsEur: number;
  feesCourtageEur: number;
  feesAssureurEur: number;
  annualPremiumEur: number;
  proposedMonthlyYear1Eur: number;
  source: "study_email" | "study_draft" | "conseiller_validation" | "manual";
  communicationId?: string;
  extractedAt: string;
};

function pickBestStudyCommunication(dossier: Dossier): {
  html: string;
  subject: string;
  id: string;
  date: string;
} | null {
  const comms = [...(dossier.communications || [])]
    .filter((c: any) => c.direction === "outbound")
    .sort((a: any, b: any) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

  for (const c of comms) {
    const html = String(c.html || c.text || "");
    const subject = String(c.subject || "");
    if (html.length < 200) continue;
    if (!isStudyEconomyOutboundEmail(subject, html)) continue;
    return {
      html,
      subject,
      id: String(c.gmailId || c.id || ""),
      date: String(c.date || dossier.updatedAt),
    };
  }

  const draftHtml = String(dossier.studyDraft?.html || "");
  if (draftHtml.length >= 200) {
    return {
      html: draftHtml,
      subject: String(dossier.studyDraft?.subject || ""),
      id: `study_draft_${dossier.id}`,
      date: String(dossier.studyDraft?.computedAt || dossier.updatedAt),
    };
  }
  return null;
}

/** Source de vérité unique : mail d'étude + brouillon + validation conseiller. */
export function resolveStudyEconomicsSnapshot(dossier: Dossier): StudyEconomicsSnapshot | null {
  const prevManual = dossier.studyKpi?.source === "manual";
  const comm = pickBestStudyCommunication(dossier);
  const parsed = comm ? parseLcifStudyEmailEconomics(comm.html, comm.subject) : null;

  const draft = dossier.studyDraft?.economySummary;
  const draftExtracted = dossier.studyDraft?.extracted as
    | { proposedMonthlyByYear?: Array<{ year: number; monthly: number }> }
    | undefined;
  const validation = dossier.studyConseillerValidation;

  let feesCourtageEur = 0;
  let feesAssureurEur = 0;
  let grossSavingsEur = 0;
  let annualPremiumEur = 0;
  let proposedMonthlyYear1Eur = 0;
  let source: StudyEconomicsSnapshot["source"] = "study_email";

  if (parsed) {
    grossSavingsEur = parsed.grossSavingsEur;
    feesAssureurEur = parsed.feesAssureurEur;
    feesCourtageEur = parsed.feesCourtageEur;
    annualPremiumEur = parsed.annualPremiumEur;
    proposedMonthlyYear1Eur = parsed.proposedMonthlyYear1Eur;
  }

  const manualCourtage =
    prevManual && dossier.studyKpi?.feesCourtageEur != null && dossier.studyKpi.feesCourtageEur > 0
      ? Math.round(Number(dossier.studyKpi.feesCourtageEur))
      : null;
  const manualGross =
    prevManual && dossier.studyKpi?.grossSavingsEur != null
      ? Math.round(Number(dossier.studyKpi.grossSavingsEur) || 0)
      : null;
  const manualPremium =
    prevManual &&
    dossier.studyKpi?.annualPremiumEur != null &&
    dossier.studyKpi.annualPremiumEur > 0
      ? Math.round(Number(dossier.studyKpi.annualPremiumEur))
      : null;
  const manualFeesAssureur =
    prevManual &&
    dossier.studyKpi?.feesAssureurEur != null &&
    dossier.studyKpi.feesAssureurEur > 0
      ? Math.round(Number(dossier.studyKpi.feesAssureurEur))
      : null;
  const overrideCourtage =
    dossier.clubRevenueKpi?.feesCourtageOverrideEur != null &&
    Number(dossier.clubRevenueKpi.feesCourtageOverrideEur) > 0
      ? Math.round(Number(dossier.clubRevenueKpi.feesCourtageOverrideEur))
      : null;

  if (manualGross != null) {
    grossSavingsEur = manualGross;
    source = "manual";
  }
  if (manualPremium != null) {
    annualPremiumEur = manualPremium;
    source = "manual";
  }
  if (manualFeesAssureur != null) {
    feesAssureurEur = manualFeesAssureur;
    source = "manual";
  }

  if (manualCourtage != null) {
    feesCourtageEur = manualCourtage;
    source = "manual";
  } else if (overrideCourtage != null) {
    feesCourtageEur = overrideCourtage;
    source = "manual";
  } else if (validation?.feesCourtageTotalEur != null && validation.feesCourtageTotalEur > 0) {
    feesCourtageEur = Math.round(Number(validation.feesCourtageTotalEur));
    source = "conseiller_validation";
  } else if (
    validation?.feesPerAssuredEur != null &&
    validation.assuredCount != null &&
    validation.feesPerAssuredEur > 0 &&
    feesCourtageEur <= 0
  ) {
    feesCourtageEur = Math.round(validation.feesPerAssuredEur * validation.assuredCount);
    source = "conseiller_validation";
  }

  if (draft?.grossSavingsEur != null && grossSavingsEur <= 0) {
    grossSavingsEur = Math.round(Number(draft.grossSavingsEur) || 0);
    if (source === "study_email") source = "study_draft";
  }
  if (draft?.feesAssureurEur != null && draft.feesAssureurEur > 0 && feesAssureurEur <= 0) {
    feesAssureurEur = Math.round(Number(draft.feesAssureurEur));
    if (source === "study_email") source = "study_draft";
  }
  if (
    draft?.feesCourtageEur != null &&
    draft.feesCourtageEur > 0 &&
    feesCourtageEur <= 0 &&
    source !== "manual"
  ) {
    feesCourtageEur = Math.round(Number(draft.feesCourtageEur));
    source = "study_draft";
  }
  if (draft?.annualPremiumEur != null && draft.annualPremiumEur > 0 && annualPremiumEur <= 0) {
    annualPremiumEur = Math.round(Number(draft.annualPremiumEur));
    if (source === "study_email") source = "study_draft";
  }

  const y1Monthly =
    draftExtracted?.proposedMonthlyByYear?.find((r) => r.year === 1)?.monthly ??
    draftExtracted?.proposedMonthlyByYear?.[0]?.monthly;
  if (y1Monthly != null && y1Monthly > 0 && annualPremiumEur <= 0) {
    proposedMonthlyYear1Eur = y1Monthly;
    annualPremiumEur = Math.round(y1Monthly * 12);
    if (source === "study_email") source = "study_draft";
  }

  if (
    grossSavingsEur <= 0 &&
    feesCourtageEur <= 0 &&
    feesAssureurEur <= 0 &&
    annualPremiumEur <= 0
  ) {
    return null;
  }

  return {
    grossSavingsEur,
    feesCourtageEur,
    feesAssureurEur,
    annualPremiumEur,
    proposedMonthlyYear1Eur,
    source,
    communicationId: comm?.id,
    extractedAt: comm?.date || new Date().toISOString(),
  };
}

/** Persiste studyKpi + clubRevenueKpi depuis le snapshot. */
export function materializeStudyEconomics(dossier: Dossier): boolean {
  const snap = resolveStudyEconomicsSnapshot(dossier);
  if (!snap) return false;

  const prev = dossier.studyKpi as StudyKpiRecord | undefined;
  const keepManual = prev?.source === "manual";

  const feesCourtageEur =
    keepManual && prev?.feesCourtageEur != null && prev.feesCourtageEur > 0
      ? prev.feesCourtageEur
      : snap.feesCourtageEur;
  const grossSavingsEur =
    keepManual && prev?.grossSavingsEur != null
      ? prev.grossSavingsEur
      : snap.grossSavingsEur || prev?.grossSavingsEur || 0;
  const feesAssureurEur =
    keepManual && prev?.feesAssureurEur != null && prev.feesAssureurEur > 0
      ? prev.feesAssureurEur
      : snap.feesAssureurEur || prev?.feesAssureurEur;
  const annualPremiumEur =
    keepManual && prev?.annualPremiumEur != null && prev.annualPremiumEur > 0
      ? prev.annualPremiumEur
      : snap.annualPremiumEur || prev?.annualPremiumEur;

  const record: StudyKpiRecord = {
    grossSavingsEur,
    feesCourtageEur,
    feesAssureurEur,
    annualPremiumEur,
    loanCapitalEur: prev?.loanCapitalEur,
    scenario: grossSavingsEur <= 0 ? "C" : grossSavingsEur < 500 ? "B" : "A",
    confidence: annualPremiumEur > 0 && feesCourtageEur > 0 ? "high" : "medium",
    source: keepManual ? "manual" : snap.source === "manual" ? "manual" : "gmail_outbound",
    gmailId: snap.communicationId || prev?.gmailId || `econ_${dossier.id}`,
    extractedAt: snap.extractedAt,
    subject: prev?.subject,
    grossSource: keepManual ? prev?.grossSource || "manual" : "table",
  };

  const unchanged =
    prev &&
    prev.feesCourtageEur === record.feesCourtageEur &&
    prev.feesAssureurEur === record.feesAssureurEur &&
    prev.annualPremiumEur === record.annualPremiumEur &&
    prev.grossSavingsEur === record.grossSavingsEur;

  if (!unchanged) {
    dossier.studyKpi = record;
    addEvent(dossier, {
      type: "NOTE_ADDED",
      actor: { kind: "SYSTEM" },
      message: `Économie étude matérialisée (${snap.source}) : courtage ${feesCourtageEur} €, prime ${snap.annualPremiumEur} €/an, frais dossier ${snap.feesAssureurEur} €.`,
      meta: {
        template: "STUDY_ECONOMICS_MATERIALIZED",
        ...snap,
        feesCourtageEur,
      },
    });
  }

  return syncClubRevenueKpiFromStudy(dossier) || !unchanged;
}
