/**
 * Vérification locale du calcul rémunération club (sans Firestore).
 * Usage: npx tsx scripts/verify-club-revenue.ts
 */
import { computeClubRevenueBreakdown } from "../shared/kereisMiaRemuneration";
import { computeActivityMetrics } from "../server/activityMetrics";
import type { Dossier } from "../server/dossierModel";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const dossier: Dossier = {
  id: "LCIF-TEST",
  status: "EN_COURS",
  createdAt: "2025-01-01T10:00:00.000Z",
  updatedAt: "2025-06-01T10:00:00.000Z",
  formData: { assures: [{ prenom: "Jean", nom: "Dupont" }], prets: [] },
  communications: [],
  eventLog: [],
  emails: [],
  studyKpi: {
    grossSavingsEur: 10000,
    feesCourtageEur: 720,
    loanCapitalEur: 200000,
    confidence: "high",
    source: "manual",
    gmailId: "manual",
    extractedAt: "2025-06-01T10:00:00.000Z",
  },
  studyConseillerValidation: {
    status: "approved",
    submittedAt: "2025-05-01T10:00:00.000Z",
    subject: "Étude",
    html: "",
    assuredCount: 2,
    suggestedFeePerAssuredEur: 360,
    feesCourtageTotalEur: 720,
    conseillerRetroEur: 504,
    approvedAt: "2025-05-02T10:00:00.000Z",
  },
  clubRevenueKpi: {
    annualPremiumEur: 1200,
    linearCommissionPercent: 15,
    paymentStatus: "pending",
    source: "manual",
    updatedAt: "2025-06-01T10:00:00.000Z",
  },
};

const b = computeClubRevenueBreakdown(dossier);
assert(b.feesCourtageEur === 720, "courtage = distribution 720");
assert(b.kereisCommissionEur === 180, "commission linéaire 15% × 1200 = 180");
assert(b.monthlyLinearCommissionEur === 15, "commission mensuelle 15 €/mois");
assert(b.partnerPayoutEur === 504, "rétro conseiller 504 (70%)");
assert(b.clubCourtageNetEur === 216, "reste courtage club 216");
assert(b.clubNetEur === 396, "net club 396 (216 + 180)");

const dossierValidationOnly: Dossier = {
  ...dossier,
  id: "LCIF-VAL",
  studyKpi: {
    ...dossier.studyKpi!,
    feesCourtageEur: 0,
  },
};
const bVal = computeClubRevenueBreakdown(dossierValidationOnly);
assert(bVal.feesCourtageEur === 720, "courtage depuis validation si KPI étude à 0");

const metrics = computeActivityMetrics([dossier], 3650);
assert(metrics.totalClubGrossEur === 900, "metrics brut club 900");
assert(metrics.totalClubNetEur === 396, "metrics net club 396");

console.log("\nTous les tests club revenue OK.");
