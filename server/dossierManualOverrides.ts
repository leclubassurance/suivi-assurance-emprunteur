import type { Dossier } from "./dossierModel";
import { getInsuranceChangePlan } from "./insuranceChangePlan";
import type { StudyKpiRecord } from "./studyEmailKpi";

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

  return incoming;
}

export function hasManualInsuranceChangePlan(dossier: Dossier): boolean {
  return getInsuranceChangePlan(dossier)?.source === "manual";
}
