import { CAMILLE_META_DOSSIER_ID, isCamilleMetaDossier } from "./camilleMeta";

/** Dossier technique Firestore — stockage apporteurs / recommandations. */
export const APPORTEUR_META_DOSSIER_ID = "LCIF-999998";

export function isApporteurMetaDossier(id: string | null | undefined): boolean {
  return String(id || "").trim() === APPORTEUR_META_DOSSIER_ID;
}

export function isTechnicalMetaDossier(id: string | null | undefined): boolean {
  return isCamilleMetaDossier(id) || isApporteurMetaDossier(id);
}

export function isVisibleAdminDossier(id: string | null | undefined): boolean {
  return !isTechnicalMetaDossier(id);
}
