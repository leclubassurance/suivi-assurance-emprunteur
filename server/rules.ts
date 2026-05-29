import { Dossier } from "./dossierModel";
import {
  getPostStudyIdentityReminderLabels,
  getPreStudyLoanReminderLabels,
} from "../shared/documentChecklist";
import { hasStudyBeenSent } from "./dossierLifecycle";

export function getPrimaryClientEmail(dossier: Dossier): string | null {
  const email = dossier.formData?.assures?.[0]?.email;
  if (!email || typeof email !== "string") return null;
  return email.trim() || null;
}

export function detectMissingDocs(dossier: Dossier): string[] {
  const docs = dossier.formData?.documents || [];
  if (hasStudyBeenSent(dossier)) {
    return getPostStudyIdentityReminderLabels(docs);
  }
  return getPreStudyLoanReminderLabels(docs);
}

export function isDossierStale(dossier: Dossier, days: number) {
  const updatedAt = new Date(dossier.updatedAt || dossier.createdAt).getTime();
  const delta = Date.now() - updatedAt;
  return delta > days * 24 * 3600 * 1000;
}

