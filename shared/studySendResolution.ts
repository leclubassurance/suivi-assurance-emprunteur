/** Données dossier nécessaires pour préparer l'envoi d'une étude. */
export type StudySendDossierSlice = {
  studyKpi?: { source?: string; feesCourtageEur?: number };
  clubRevenueKpi?: { feesCourtageOverrideEur?: number };
  studyConseillerValidation?: { status?: string; feesCourtageTotalEur?: number | null };
  insuranceChangePlan?: { plannedDate?: string; source?: string };
};

/** Priorité : manuel admin → override club → conseiller validé → KPI extrait. */
export function resolveStudyFeesCourtageForSend(dossier: StudySendDossierSlice): number | null {
  const manual = dossier.studyKpi?.source === "manual" ? dossier.studyKpi.feesCourtageEur : undefined;
  if (manual != null && manual > 0) return Math.round(manual);

  const override = dossier.clubRevenueKpi?.feesCourtageOverrideEur;
  if (override != null && Number(override) > 0) return Math.round(Number(override));

  const validation = dossier.studyConseillerValidation;
  if (
    validation?.status === "approved" &&
    validation.feesCourtageTotalEur != null &&
    Number(validation.feesCourtageTotalEur) > 0
  ) {
    return Math.round(Number(validation.feesCourtageTotalEur));
  }

  const kpi = dossier.studyKpi?.feesCourtageEur;
  if (kpi != null && kpi > 0) return Math.round(kpi);

  return null;
}

export function resolveStudyPlannedChangeDate(dossier: StudySendDossierSlice): string | null {
  const raw = dossier.insuranceChangePlan?.plannedDate;
  if (!raw) return null;
  const iso = String(raw).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}
