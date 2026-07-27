/** Statuts CRM hors file active (refusés / clos sans suite). */
export const ARCHIVED_DOSSIER_STATUSES = new Set(["CLOS", "REFUSE", "REFUSÉ"]);

export function isArchivedDossierStatus(status: unknown): boolean {
  return ARCHIVED_DOSSIER_STATUSES.has(String(status || "").toUpperCase());
}

export function isArchivedDossier(dossier: { status?: unknown } | null | undefined): boolean {
  return isArchivedDossierStatus(dossier?.status);
}
