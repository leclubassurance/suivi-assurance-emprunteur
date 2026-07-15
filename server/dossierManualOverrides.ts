import type { Dossier } from "./dossierModel";
import { getInsuranceChangePlan } from "./insuranceChangePlan";
import type { StudyKpiRecord } from "./studyEmailKpi";
import {
  coerceSubscriptionPhase,
  phaseRank,
} from "./subscriptionProgress";

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
  if (
    existingKpi?.source === "manual" &&
    existingKpi.feesCourtageEur != null &&
    incomingKpi?.source !== "manual"
  ) {
    incoming.studyKpi = {
      ...incomingKpi,
      ...existingKpi,
      source: "manual",
      grossSource: existingKpi.grossSource || "manual",
    };
  }

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
