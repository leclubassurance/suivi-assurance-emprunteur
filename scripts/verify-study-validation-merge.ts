/**
 * Usage: npx tsx scripts/verify-study-validation-merge.ts
 */
import { mergeStudyConseillerValidation } from "../server/dossierManualOverrides";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const pending = {
  status: "pending" as const,
  submittedAt: "2026-07-21T08:00:00.000Z",
  subject: "Étude",
  html: "<p>x</p>",
  assuredCount: 2,
  suggestedFeePerAssuredEur: 360,
};

const approved = {
  ...pending,
  status: "approved" as const,
  approvedAt: "2026-07-21T09:00:00.000Z",
  feesPerAssuredEur: 320,
  feesCourtageTotalEur: 640,
};

assert(
  mergeStudyConseillerValidation(pending, approved)?.status === "approved",
  "approved écrase pending",
);
assert(
  mergeStudyConseillerValidation(approved, pending)?.status === "approved",
  "sync stale pending n'écrase pas approved",
);

const newerPending = {
  ...pending,
  submittedAt: "2026-07-21T10:00:00.000Z",
};
assert(
  mergeStudyConseillerValidation(approved, newerPending)?.status === "pending",
  "nouvelle soumission pending après une approbation remplace l'ancienne",
);

const stalePending = {
  ...pending,
  submittedAt: "2026-07-21T08:00:00.000Z",
};
assert(
  mergeStudyConseillerValidation(approved, stalePending)?.status === "approved",
  "sync stale pending n'écrase pas approved",
);

console.log("\nMerge validation conseiller OK.");
