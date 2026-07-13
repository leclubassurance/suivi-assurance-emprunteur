import type { Dossier } from "./dossierModel";
import { materializeStudyEconomics } from "./materializeStudyEconomics";

/** Rejoue l'extraction depuis le mail d'étude et met à jour studyKpi + clubRevenueKpi. */
export function enrichDossierClubEconomics(dossier: Dossier): boolean {
  return materializeStudyEconomics(dossier);
}

/** Backfill tous les dossiers avant calcul forecast / metrics. */
export function backfillClubEconomicsForDossiers(dossiers: Dossier[]): string[] {
  const dirty: string[] = [];
  for (const d of dossiers) {
    if (materializeStudyEconomics(d)) dirty.push(d.id);
  }
  return dirty;
}
