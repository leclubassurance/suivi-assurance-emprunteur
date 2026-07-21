import type { Dossier } from "./dossierModel";
import { getInsuranceChangePlan } from "./insuranceChangePlan";
import type { StudyKpiRecord } from "./studyEmailKpi";
import type { StudyConseillerValidation } from "./studyConseillerValidation";
import {
  coerceSubscriptionPhase,
  phaseRank,
} from "./subscriptionProgress";

function studyValidationRank(status?: string): number {
  if (status === "approved") return 3;
  if (status === "pending") return 2;
  if (status === "cancelled") return 1;
  return 0;
}

function studyValidationTimestamp(v?: StudyConseillerValidation): number {
  if (!v) return 0;
  const raw = v.approvedAt || v.submittedAt || "";
  const ts = new Date(raw).getTime();
  return Number.isFinite(ts) ? ts : 0;
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

  if (existing.status === "cancelled" && incoming.status === "pending") {
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

  if (existing.statusManualAt) {
    if (existing.status) incoming.status = existing.status;
    incoming.statusManualAt = existing.statusManualAt;

    const existingProgress = existing.subscriptionProgress;
    const incomingProgress = incoming.subscriptionProgress;
    const existingRank = phaseRank(coerceSubscriptionPhase(existingProgress?.phase));
    const incomingRank = phaseRank(coerceSubscriptionPhase(incomingProgress?.phase));
    const existingProgressIsAdmin =
      Boolean(existingProgress?.updatedBy) && existingProgress?.updatedBy !== "system";

    if (
      existingProgress &&
      (existingProgressIsAdmin || existingRank > incomingRank)
    ) {
      incoming.subscriptionProgress = existingProgress;
    }

    if (existing.clientAcceptedInsuranceAt) {
      incoming.clientAcceptedInsuranceAt = existing.clientAcceptedInsuranceAt;
      incoming.clientAcceptedInsuranceSource = existing.clientAcceptedInsuranceSource;
      incoming.clientAcceptedInsuranceNote = existing.clientAcceptedInsuranceNote;
    }
  }

  return incoming;
}

export function hasManualInsuranceChangePlan(dossier: Dossier): boolean {
  return getInsuranceChangePlan(dossier)?.source === "manual";
}
