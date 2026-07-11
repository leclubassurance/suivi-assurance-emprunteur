import { patchStudyHtmlBrokerageFee } from "./studyHtmlPatch";

export type StudyConseillerValidationForSend = {
  status?: string;
  html?: string;
  feesCourtageTotalEur?: number | null;
};

/** HTML réellement envoyé au client — prévisualisation admin et envoi serveur (étude uniquement). */
export function resolveStudyEmailHtmlForSend(params: {
  draftHtml?: string | null;
  validation?: StudyConseillerValidationForSend | null;
}): string {
  const validation = params.validation;
  const draft = String(params.draftHtml || "").trim();
  // Ne jamais substituer un message libre par le HTML du débrief conseiller.
  const base = draft || String(validation?.html || "").trim();
  if (
    validation?.status === "approved" &&
    validation.feesCourtageTotalEur != null &&
    Number.isFinite(validation.feesCourtageTotalEur)
  ) {
    return patchStudyHtmlBrokerageFee(base, validation.feesCourtageTotalEur).html;
  }
  return base;
}
