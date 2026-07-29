import type { Dossier } from "./dossierModel";
import { getInsuranceChangePlan } from "./insuranceChangePlan";
import type { StudyKpiRecord } from "./studyEmailKpi";
import type { StudyConseillerValidation } from "./studyConseillerValidation";
import {
  coerceSubscriptionPhase,
  phaseRank,
} from "./subscriptionProgress";

function ts(v?: string): number {
  const n = new Date(String(v || "")).getTime();
  return Number.isFinite(n) ? n : 0;
}

function studyValidationRank(status?: string): number {
  if (status === "approved") return 3;
  if (status === "pending") return 2;
  if (status === "cancelled") return 1;
  return 0;
}

function studyValidationTimestamp(v?: StudyConseillerValidation): number {
  if (!v) return 0;
  const raw = (v as { cancelledAt?: string }).cancelledAt || v.approvedAt || v.submittedAt || "";
  const n = new Date(raw).getTime();
  return Number.isFinite(n) ? n : 0;
}

/** Évite qu'une synchro Gmail stale écrase une validation conseiller déjà approuvée. */
export function mergeStudyConseillerValidation(
  existing?: StudyConseillerValidation,
  incoming?: StudyConseillerValidation,
): StudyConseillerValidation | undefined {
  if (!incoming) return existing;
  if (!existing) return incoming;

  const existingApprovedAt = existing.approvedAt ? new Date(existing.approvedAt).getTime() : 0;
  const incomingSubmittedAt = incoming.submittedAt ? new Date(incoming.submittedAt).getTime() : 0;
  const existingSubmittedAt = existing.submittedAt ? new Date(existing.submittedAt).getTime() : 0;
  const incomingCancelledAt = (incoming as { cancelledAt?: string }).cancelledAt
    ? new Date(String((incoming as { cancelledAt?: string }).cancelledAt)).getTime()
    : 0;
  const existingCancelledAt = (existing as { cancelledAt?: string }).cancelledAt
    ? new Date(String((existing as { cancelledAt?: string }).cancelledAt)).getTime()
    : 0;

  // Annulation admin explicite : ne jamais laisser un approved/pending plus ancien la réécrire.
  if (incoming.status === "cancelled") {
    if (
      (existing.status === "pending" || existing.status === "approved") &&
      existingSubmittedAt > 0 &&
      incomingSubmittedAt > 0 &&
      existingSubmittedAt > incomingSubmittedAt
    ) {
      // Nouvelle soumission déjà enregistrée après l'annulation de l'ancienne.
      return existing;
    }
    return incoming;
  }
  if (existing.status === "cancelled") {
    const cancelTs = existingCancelledAt || existingSubmittedAt;
    if (incoming.status === "pending" && incomingSubmittedAt > cancelTs) {
      return incoming;
    }
    if (incoming.status === "approved" && incomingSubmittedAt > cancelTs) {
      // Approbation d'une soumission postérieure à l'annulation.
      return incoming;
    }
    // Ne pas ressusciter un ancien approved après annulation.
    return existing;
  }

  // Sync Gmail stale : pending d'une soumission déjà approuvée.
  if (
    existing.status === "approved" &&
    incoming.status === "pending" &&
    existingApprovedAt > 0 &&
    incomingSubmittedAt > 0 &&
    existingApprovedAt >= incomingSubmittedAt
  ) {
    return existing;
  }

  // Nouvelle soumission admin après une validation précédente.
  if (
    existing.status === "approved" &&
    incoming.status === "pending" &&
    existingApprovedAt > 0 &&
    incomingSubmittedAt > existingApprovedAt
  ) {
    return incoming;
  }

  const existingRank = studyValidationRank(existing.status);
  const incomingRank = studyValidationRank(incoming.status);
  if (incomingRank > existingRank) return incoming;
  if (existingRank > incomingRank) return existing;

  const existingTs = studyValidationTimestamp(existing);
  const incomingTs = studyValidationTimestamp(incoming);
  return incomingTs >= existingTs ? incoming : existing;
}

/** Empêche une synchro Gmail / metrics d'écraser des saisies admin — jamais l'inverse. */
export function mergeManualDossierOverrides(existing: Dossier, incoming: Dossier): Dossier {
  const existingPlan = getInsuranceChangePlan(existing);
  const incomingPlan = getInsuranceChangePlan(incoming);

  // Saisie admin explicite : toujours prioritaire sur une date extraite du mail.
  if (incomingPlan?.source === "manual") {
    // keep incoming
  } else if (existingPlan?.source === "manual") {
    (incoming as any).insuranceChangePlan = existingPlan;
  }

  const existingKpi = existing.studyKpi as StudyKpiRecord | undefined;
  const incomingKpi = incoming.studyKpi as StudyKpiRecord | undefined;
  if (existingKpi?.source === "manual" && incomingKpi?.source !== "manual") {
    incoming.studyKpi = {
      ...incomingKpi,
      ...existingKpi,
      source: "manual",
      grossSource: existingKpi.grossSource || "manual",
    };
  }

  incoming.studyConseillerValidation = mergeStudyConseillerValidation(
    existing.studyConseillerValidation,
    incoming.studyConseillerValidation,
  );

  const existingStatusManualTs = ts(existing.statusManualAt);
  const incomingStatusManualTs = ts(incoming.statusManualAt);
  const incomingHasNewerManualStatus =
    incomingStatusManualTs > 0 && incomingStatusManualTs >= existingStatusManualTs;

  if (existing.statusManualAt || incoming.statusManualAt) {
    if (!incomingHasNewerManualStatus && existing.status) {
      incoming.status = existing.status;
      incoming.statusManualAt = existing.statusManualAt;
    }

    const existingProgress = existing.subscriptionProgress;
    const incomingProgress = incoming.subscriptionProgress;
    const existingRank = phaseRank(coerceSubscriptionPhase(existingProgress?.phase));
    const incomingRank = phaseRank(coerceSubscriptionPhase(incomingProgress?.phase));
    const existingProgressIsAdmin =
      Boolean(existingProgress?.updatedBy) && existingProgress?.updatedBy !== "system";

    if (
      !incomingHasNewerManualStatus &&
      existingProgress &&
      (existingProgressIsAdmin || existingRank > incomingRank)
    ) {
      incoming.subscriptionProgress = existingProgress;
    }

    if (!incomingHasNewerManualStatus && existing.clientAcceptedInsuranceAt) {
      incoming.clientAcceptedInsuranceAt = existing.clientAcceptedInsuranceAt;
      incoming.clientAcceptedInsuranceSource = existing.clientAcceptedInsuranceSource;
      incoming.clientAcceptedInsuranceNote = existing.clientAcceptedInsuranceNote;
    }
  }

  // Ne jamais perdre un rattachement conseiller/apporteur sur une sync partielle.
  if (existing.apporteur && !incoming.apporteur) {
    incoming.apporteur = existing.apporteur;
  }

  // Ne jamais perdre une suppression admin du PDF d'étude (sinon Drive/ADE ressuscitent).
  const incomingHasNewStudyPdf = Boolean(
    incoming.studyPdf?.fileName || incoming.studyPdf?.driveFileId,
  );
  if (existing.studyPdfSuppressed && !incomingHasNewStudyPdf) {
    incoming.studyPdfSuppressed = true;
    incoming.studyPdfClearedAt = incoming.studyPdfClearedAt || existing.studyPdfClearedAt;
    if (!incoming.studyPdf) delete (incoming as any).studyPdf;
    if (
      String(existing.studyDraft?.kind || "") === "PDF_UPLOAD_CLEARED" &&
      String(incoming.studyDraft?.kind || "") !== "PDF_UPLOAD_CLEARED"
    ) {
      incoming.studyDraft = {
        ...(incoming.studyDraft || existing.studyDraft || {
          computedAt: existing.studyPdfClearedAt || new Date().toISOString(),
          reliability: "cleared",
        }),
        kind: "PDF_UPLOAD_CLEARED",
      } as any;
    }
  }

  return incoming;
}

export function hasManualInsuranceChangePlan(dossier: Dossier): boolean {
  return getInsuranceChangePlan(dossier)?.source === "manual";
}
