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

  if (draft?.grossSavingsEur != null && grossSavingsEur <= 0) {
    grossSavingsEur = Math.round(Number(draft.grossSavingsEur) || 0);
    source = "study_draft";
  }
  if (draft?.feesAssureurEur != null && draft.feesAssureurEur > 0 && feesAssureurEur <= 0) {
    feesAssureurEur = Math.round(Number(draft.feesAssureurEur));
    source = "study_draft";
  }
  if (draft?.feesCourtageEur != null && draft.feesCourtageEur > 0 && feesCourtageEur <= 0) {
    feesCourtageEur = Math.round(Number(draft.feesCourtageEur));
    source = "study_draft";
  }
  if (draft?.annualPremiumEur != null && draft.annualPremiumEur > 0 && annualPremiumEur <= 0) {
    annualPremiumEur = Math.round(Number(draft.annualPremiumEur));
    source = "study_draft";
  }

  const y1Monthly =
    draftExtracted?.proposedMonthlyByYear?.find((r) => r.year === 1)?.monthly ??
    draftExtracted?.proposedMonthlyByYear?.[0]?.monthly;
  if (y1Monthly != null && y1Monthly > 0 && annualPremiumEur <= 0) {
    proposedMonthlyYear1Eur = y1Monthly;
    annualPremiumEur = Math.round(y1Monthly * 12);
    source = "study_draft";
  }

  if (validation?.feesCourtageTotalEur != null && validation.feesCourtageTotalEur > 0) {
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

  if (prevManual && dossier.studyKpi?.feesCourtageEur != null && dossier.studyKpi.feesCourtageEur > 0) {
    feesCourtageEur = Math.round(Number(dossier.studyKpi.feesCourtageEur));
    source = "manual";
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
  const keepManualCourtage =
    prev?.source === "manual" &&
    prev.feesCourtageEur != null &&
    prev.feesCourtageEur > 0;

  const feesCourtageEur = keepManualCourtage ? prev!.feesCourtageEur! : snap.feesCourtageEur;

  const record: StudyKpiRecord = {
    grossSavingsEur: snap.grossSavingsEur || prev?.grossSavingsEur || 0,
    feesCourtageEur,
    feesAssureurEur: snap.feesAssureurEur || prev?.feesAssureurEur,
    annualPremiumEur: snap.annualPremiumEur || prev?.annualPremiumEur,
    loanCapitalEur: prev?.loanCapitalEur,
    scenario:
      (snap.grossSavingsEur || prev?.grossSavingsEur || 0) <= 0
        ? "C"
        : (snap.grossSavingsEur || 0) < 500
          ? "B"
          : "A",
    confidence: snap.annualPremiumEur > 0 && feesCourtageEur > 0 ? "high" : "medium",
    source: keepManualCourtage ? "manual" : snap.source === "manual" ? "manual" : "gmail_outbound",
    gmailId: snap.communicationId || prev?.gmailId || `econ_${dossier.id}`,
    extractedAt: snap.extractedAt,
    subject: prev?.subject,
    grossSource: keepManualCourtage ? prev?.grossSource : "table",
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
