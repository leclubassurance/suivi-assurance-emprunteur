/** Dossier technique Firestore — stockage des playbooks Camille (pas un vrai client). */
export const CAMILLE_META_DOSSIER_ID = "LCIF-999999";

export function isCamilleMetaDossier(id: string | null | undefined): boolean {
  return String(id || "").trim() === CAMILLE_META_DOSSIER_ID;
}

export function isVisibleAdminDossier(id: string | null | undefined): boolean {
  return !isCamilleMetaDossier(id);
}
