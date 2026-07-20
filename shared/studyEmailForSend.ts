import { patchStudyHtmlBrokerageFee, patchStudyHtmlPlannedDate } from "./studyHtmlPatch";
import {
  resolveStudyFeesCourtageForSend,
  resolveStudyPlannedChangeDate,
  type StudySendDossierSlice,
} from "./studySendResolution";

export type StudyConseillerValidationForSend = {
  status?: string;
  html?: string;
  feesCourtageTotalEur?: number | null;
};

/** HTML réellement envoyé au client — prévisualisation admin et envoi serveur (étude uniquement). */
export function resolveStudyEmailHtmlForSend(params: {
  draftHtml?: string | null;
  validation?: StudyConseillerValidationForSend | null;
  /** Priorité manuel / override / validation — passer le dossier ou les montants explicites. */
  dossier?: StudySendDossierSlice;
  feesCourtageEur?: number | null;
  plannedChangeDate?: string | null;
}): string {
  const validation = params.validation;
  const draft = String(params.draftHtml || "").trim();
  const base = draft || String(validation?.html || "").trim();
  let html = base;

  const fees =
    params.feesCourtageEur != null
      ? params.feesCourtageEur
      : params.dossier
        ? resolveStudyFeesCourtageForSend(params.dossier)
        : validation?.status === "approved" && validation.feesCourtageTotalEur != null
          ? validation.feesCourtageTotalEur
          : null;

  if (fees != null && Number.isFinite(fees) && fees > 0) {
    html = patchStudyHtmlBrokerageFee(html, fees).html;
  }

  const planned =
    params.plannedChangeDate != null
      ? params.plannedChangeDate
      : params.dossier
        ? resolveStudyPlannedChangeDate(params.dossier)
        : null;

  if (planned) {
    const { html: next, patched } = patchStudyHtmlPlannedDate(html, planned);
    if (patched) html = next;
  }

  return html;
}

/** Met à jour le HTML stocké (brouillon + validation conseiller) avec courtage / date manuels. */
export function applyStudyHtmlOverridesToDossier(dossier: StudySendDossierSlice & {
  studyDraft?: { html?: string | null };
  studyConseillerValidation?: StudyConseillerValidationForSend | null;
}): boolean {
  const slice: StudySendDossierSlice = {
    studyKpi: dossier.studyKpi,
    clubRevenueKpi: dossier.clubRevenueKpi,
    studyConseillerValidation: dossier.studyConseillerValidation ?? undefined,
    insuranceChangePlan: dossier.insuranceChangePlan,
  };
  let changed = false;

  if (dossier.studyDraft?.html) {
    const next = resolveStudyEmailHtmlForSend({ draftHtml: dossier.studyDraft.html, dossier: slice });
    if (next !== dossier.studyDraft.html) {
      dossier.studyDraft.html = next;
      changed = true;
    }
  }

  const validation = dossier.studyConseillerValidation;
  if (validation?.html) {
    const next = resolveStudyEmailHtmlForSend({
      draftHtml: validation.html,
      validation,
      dossier: slice,
    });
    if (next !== validation.html) {
      validation.html = next;
      changed = true;
    }
  }

  return changed;
}

export function dossierSliceForStudySend(dossier: StudySendDossierSlice): StudySendDossierSlice {
  return {
    studyKpi: dossier.studyKpi,
    clubRevenueKpi: dossier.clubRevenueKpi,
    studyConseillerValidation: dossier.studyConseillerValidation,
    insuranceChangePlan: dossier.insuranceChangePlan,
  };
}
