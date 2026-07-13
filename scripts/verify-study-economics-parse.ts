/**
 * Usage: npx tsx scripts/verify-study-economics-parse.ts
 */
import { buildEconomyHtmlDraft } from "../server/economyMailDraft";
import { parseLcifStudyEmailEconomics } from "../shared/studyEconomicsParse";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const dossier = {
  formData: { assures: [{ prenom: "Jean" }] },
};

const comp = {
  ok: true,
  reliability: "HIGH" as const,
  reasons: [],
  extracted: {
    feesAssureurTotal: 220,
    feesCourtierTotal: 720,
    proposedMonthlyByYear: [{ year: 1, monthly: 42.5 }],
  },
  result: {
    grossSavings: 12000,
    currentTotalRemaining: 50000,
    proposedTotalRemaining: 38000,
    table: [
      {
        label: "Année 1",
        currentMonthly: 55,
        proposedMonthly: 42.5,
        gainMonthly: 12.5,
      },
    ],
  },
};

const { html } = buildEconomyHtmlDraft(dossier, comp as any);
const parsed = parseLcifStudyEmailEconomics(html);
assert(Boolean(parsed), "parse OK");
assert(parsed!.grossSavingsEur === 12000, "économie brute");
assert(parsed!.feesAssureurEur === 220, "frais dossier");
assert(parsed!.feesCourtageEur === 720, "courtage");
assert(parsed!.proposedMonthlyYear1Eur === 42.5, "mensuel an 1");
assert(parsed!.annualPremiumEur === 510, "prime annuelle 42.5×12");

console.log("\nParse étude OK.");
