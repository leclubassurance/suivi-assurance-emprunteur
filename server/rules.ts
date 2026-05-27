import { Dossier } from "./dossierModel";
import { getBlockingMissingLabels } from "../shared/documentChecklist";

export function getPrimaryClientEmail(dossier: Dossier): string | null {
  const email = dossier.formData?.assures?.[0]?.email;
  if (!email || typeof email !== "string") return null;
  return email.trim() || null;
}

export function detectMissingDocs(dossier: Dossier): string[] {
  return getBlockingMissingLabels(dossier.formData?.documents || []);
}

export function isDossierStale(dossier: Dossier, days: number) {
  const updatedAt = new Date(dossier.updatedAt || dossier.createdAt).getTime();
  const delta = Date.now() - updatedAt;
  return delta > days * 24 * 3600 * 1000;
}

