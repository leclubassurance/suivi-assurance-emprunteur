/**
 * Usage: npx tsx scripts/verify-club-revenue-manual-month.ts
 */
import type { Dossier } from "../server/dossierModel";
import { buildClubRevenueForecast } from "../server/clubRevenueForecast";
import { DEFAULT_KEREIS_MIA_SETTINGS } from "../shared/kereisMiaRemuneration";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const now = new Date("2026-07-15T12:00:00.000Z");

const signedWithManualSeptember: Dossier = {
  id: "LCIF-179991",
  status: "ADHESION_EN_COURS",
  clientAcceptedInsuranceAt: "2026-07-10T10:00:00.000Z",
  clubRevenueKpi: { signedAt: "2026-07-10T10:00:00.000Z" },
  insuranceChangePlan: {
    plannedDate: "2026-09-15",
    source: "manual",
    updatedAt: "2026-07-14T10:00:00.000Z",
  },
  studyKpi: {
    feesCourtageEur: 900,
    extractedAt: "2026-07-01T10:00:00.000Z",
  },
} as Dossier;

const forecast = buildClubRevenueForecast({
  dossiers: [signedWithManualSeptember],
  referrals: [],
  kereisSettings: DEFAULT_KEREIS_MIA_SETTINGS,
  now,
});

const row = forecast.summary.contributions?.find((c) => c.id === "LCIF-179991");
assert(Boolean(row), "dossier signé inclus dans le forecast");
assert(row!.segment === "signed", "segment signé");
assert(row!.startMonthKey === "2026-09", "date manuelle septembre pilote le mois (pas juillet)");

const pipelineWithManual: Dossier = {
  id: "LCIF-PIPE",
  status: "MAIL_ENVOYE",
  insuranceChangePlan: {
    plannedDate: "2026-10-01",
    source: "manual",
    updatedAt: "2026-07-14T10:00:00.000Z",
  },
  studyKpi: {
    feesCourtageEur: 500,
    extractedAt: "2026-06-01T10:00:00.000Z",
  },
} as Dossier;

const pipelineForecast = buildClubRevenueForecast({
  dossiers: [pipelineWithManual],
  referrals: [],
  kereisSettings: DEFAULT_KEREIS_MIA_SETTINGS,
  now,
});

const pipelineRow = pipelineForecast.summary.contributions?.find((c) => c.id === "LCIF-PIPE");
assert(Boolean(pipelineRow), "dossier pipeline inclus");
assert(pipelineRow!.startMonthKey === "2026-10", "date manuelle octobre pour pipeline");

console.log("\nManual month forecast OK.");
