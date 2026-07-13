import type { Dossier } from "./dossierModel";
import { syncClubRevenueKpiFromStudy } from "./clubRevenueKpi";

/** Rejoue l'extraction KPI + sync club revenue (en mémoire). */
export function enrichDossierClubEconomics(dossier: Dossier): boolean {
  const { refreshStudyKpiFromCommunications } = require("./studyEmailKpi") as typeof import("./studyEmailKpi");
  let changed = refreshStudyKpiFromCommunications(dossier);
  if (syncClubRevenueKpiFromStudy(dossier)) changed = true;
  return changed;
}

/** Backfill tous les dossiers avant calcul forecast / metrics. */
export function backfillClubEconomicsForDossiers(dossiers: Dossier[]): string[] {
  const dirty: string[] = [];
  for (const d of dossiers) {
    if (enrichDossierClubEconomics(d)) dirty.push(d.id);
  }
  return dirty;
}
