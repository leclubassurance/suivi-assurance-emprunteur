/**
 * Usage: npx tsx scripts/verify-insurance-change-plan-manual.ts
 */
import { buildEconomyHtmlDraft } from "../server/economyMailDraft";
import { extractPlannedChangeDateFromStudyContent } from "../server/insuranceChangePlan";
import { mergeManualDossierOverrides } from "../server/dossierManualOverrides";
import type { Dossier } from "../server/dossierModel";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const comp = {
  ok: true,
  reliability: "HIGH" as const,
  reasons: [],
  extracted: { feesCourtierTotal: 720, feesAssureurTotal: 220 },
  result: {
    grossSavings: 12000,
    currentTotalRemaining: 50000,
    proposedTotalRemaining: 38000,
    table: [],
  },
};

const { html } = buildEconomyHtmlDraft({ formData: { assures: [{ prenom: "Jean" }] } }, comp as any);
assert(extractPlannedChangeDateFromStudyContent(html) == null, "étude standard sans date parasite");

const withPrivacy = `${html} assurance-emprunteur-2026-07-01 politique 1 juillet 2026`;
assert(
  extractPlannedChangeDateFromStudyContent(withPrivacy) == null,
  "pas d'extraction sur version politique seule",
);

const explicit = `${html} Date de changement prévue : 15 juillet 2026`;
assert(
  extractPlannedChangeDateFromStudyContent(explicit) === "2026-07-15",
  "extrait une date explicite",
);

const existing = {
  id: "LCIF-179991",
  insuranceChangePlan: {
    plannedDate: "2026-07-15",
    source: "study_email",
    updatedAt: "2026-07-10T10:00:00.000Z",
  },
} as Dossier;

const incoming = {
  id: "LCIF-179991",
  insuranceChangePlan: {
    plannedDate: "2026-09-01",
    source: "manual",
    updatedAt: "2026-07-14T10:00:00.000Z",
  },
} as Dossier;

const mergedSave = mergeManualDossierOverrides(existing, incoming);
assert(mergedSave.insuranceChangePlan?.plannedDate === "2026-09-01", "sauvegarde manuelle prioritaire");
assert(mergedSave.insuranceChangePlan?.source === "manual", "source manual conservée");

const staleSync = {
  id: "LCIF-179991",
  insuranceChangePlan: {
    plannedDate: "2026-07-15",
    source: "study_email",
    updatedAt: "2026-07-14T11:00:00.000Z",
  },
} as Dossier;

const mergedSync = mergeManualDossierOverrides(incoming, staleSync);
assert(mergedSync.insuranceChangePlan?.plannedDate === "2026-09-01", "sync stale ne remplace pas le manuel");

console.log("\nPlan changement assurance OK.");
