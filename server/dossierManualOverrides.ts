import type { Dossier } from "./dossierModel";
import { getInsuranceChangePlan, type InsuranceChangePlan } from "./insuranceChangePlan";
import type { StudyKpiRecord } from "./studyEmailKpi";

function planTimestamp(plan: InsuranceChangePlan | null | undefined): number {
  if (!plan?.updatedAt) return 0;
  const t = new Date(plan.updatedAt).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Empêche une synchro Gmail / metrics d'écraser des saisies admin plus récentes. */
export function mergeManualDossierOverrides(existing: Dossier, incoming: Dossier): Dossier {
  const existingPlan = getInsuranceChangePlan(existing);
  const incomingPlan = getInsuranceChangePlan(incoming);

  if (existingPlan?.source === "manual") {
    const incomingIsManual = incomingPlan?.source === "manual";
    const keepExisting =
      !incomingIsManual || planTimestamp(existingPlan) >= planTimestamp(incomingPlan);
    if (keepExisting) {
      (incoming as any).insuranceChangePlan = existingPlan;
    }
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
