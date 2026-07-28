import type { Dossier } from "./dossierModel";
import { getLastStudyOutbound, getStudySentAtMs, hasStudyBeenSent } from "./dossierLifecycle";

export const CLIENT_LANDING_MIN_GROSS_SAVINGS_EUR = 5000;
export const CLIENT_LANDING_RECENT_STUDIES_LIMIT = 10;

export type ClientLandingRecentStudy = {
  dossierId: string;
  studySentAt: string;
  studySentAtLabel: string;
  grossSavingsEur: number;
  grossSavingsLabel: string;
};

function resolveGrossSavingsEur(dossier: Dossier): number {
  const candidates = [
    dossier.studyKpi?.grossSavingsEur,
    dossier.studyDraft?.economySummary?.grossSavingsEur,
    (dossier as { studyConseillerValidation?: { grossSavingsEur?: number } }).studyConseillerValidation
      ?.grossSavingsEur,
  ];
  for (const raw of candidates) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return 0;
}

function formatStudySentAtLabel(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatSavingsLabel(eur: number): string {
  return `${eur.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`;
}

/**
 * Dernières études envoyées au client avec économie brute ≥ seuil.
 * Triées par date d'envoi (plus récentes d'abord), max `limit` (défaut 10).
 * Données anonymisées : date + montant uniquement.
 */
export function listClientLandingRecentStudies(
  dossiers: Dossier[],
  opts?: { minGrossSavingsEur?: number; limit?: number },
): ClientLandingRecentStudy[] {
  const min = opts?.minGrossSavingsEur ?? CLIENT_LANDING_MIN_GROSS_SAVINGS_EUR;
  const limit = opts?.limit ?? CLIENT_LANDING_RECENT_STUDIES_LIMIT;

  const rows: ClientLandingRecentStudy[] = [];
  for (const dossier of dossiers) {
    if (!hasStudyBeenSent(dossier)) continue;
    const gross = resolveGrossSavingsEur(dossier);
    if (gross < min) continue;
    const ms = getStudySentAtMs(dossier);
    if (ms == null || ms <= 0) continue;
    const last = getLastStudyOutbound(dossier);
    const studySentAt = last?.date || new Date(ms).toISOString();
    rows.push({
      dossierId: dossier.id,
      studySentAt,
      studySentAtLabel: formatStudySentAtLabel(studySentAt),
      grossSavingsEur: gross,
      grossSavingsLabel: formatSavingsLabel(gross),
    });
  }

  rows.sort((a, b) => new Date(b.studySentAt).getTime() - new Date(a.studySentAt).getTime());
  return rows.slice(0, Math.max(0, limit));
}
