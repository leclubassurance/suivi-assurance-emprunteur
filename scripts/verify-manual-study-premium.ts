/**
 * Usage: npx tsx scripts/verify-manual-study-premium.ts
 */
import { buildEconomyHtmlDraft } from "../server/economyMailDraft";
import { patchStudyKpi } from "../server/studyEmailKpi";
import { materializeStudyEconomics } from "../server/materializeStudyEconomics";
import {
  resolveAnnualPremiumEur,
  resolveFeesAssureurEur,
} from "../shared/studyClubEconomics";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const comp = {
  ok: true,
  reliability: "HIGH" as const,
  reasons: [],
  extracted: { feesAssureurTotal: 220, feesCourtierTotal: 720 },
  result: {
    grossSavings: 12000,
    currentTotalRemaining: 50000,
    proposedTotalRemaining: 38000,
    table: [{ label: "Année 1", currentMonthly: 55, proposedMonthly: 42.5, gainMonthly: 12.5 }],
  },
};

const baseDossier = {
  id: "LCIF-TEST",
  formData: { assures: [{ prenom: "Jean" }] },
} as any;

const { html } = buildEconomyHtmlDraft(baseDossier, comp as any);
baseDossier.studyDraft = {
  html,
  computedAt: "2026-07-01T10:00:00.000Z",
  economySummary: {
    grossSavingsEur: 12000,
    feesCourtageEur: 720,
    feesAssureurEur: 220,
    annualPremiumEur: 510,
  },
};

assert(resolveAnnualPremiumEur(baseDossier) === 510, "prime initiale depuis premier devis");

patchStudyKpi(baseDossier, { annualPremiumEur: 840, feesAssureurEur: 280 });
assert(baseDossier.studyKpi.source === "manual", "KPI manuel");
assert(resolveAnnualPremiumEur(baseDossier) === 840, "prime manuelle prioritaire sur brouillon");
assert(resolveFeesAssureurEur(baseDossier) === 280, "frais dossier manuels prioritaires");

materializeStudyEconomics(baseDossier);
assert(baseDossier.studyKpi.annualPremiumEur === 840, "matérialisation conserve prime manuelle");
assert(baseDossier.studyKpi.feesAssureurEur === 280, "matérialisation conserve frais dossier manuels");

console.log("\nPrime / frais dossier manuels OK.");
