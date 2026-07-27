/**
 * Usage: npx tsx scripts/verify-study-validation-merge.ts
 */
import { mergeStudyConseillerValidation } from "../server/dossierManualOverrides";
import { cancelStudyConseillerValidation } from "../server/studyConseillerValidation";
import type { Dossier } from "../server/dossierModel";

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

const cancelled = {
  ...approved,
  status: "cancelled" as const,
  cancelledAt: "2026-07-21T11:00:00.000Z",
  approvedAt: undefined,
  feesPerAssuredEur: undefined,
  feesCourtageTotalEur: undefined,
};
assert(
  mergeStudyConseillerValidation(approved, cancelled)?.status === "cancelled",
  "annulation admin écrase approved en Firestore (bug LCIF-744670)",
);
assert(
  mergeStudyConseillerValidation(cancelled, approved)?.status === "cancelled",
  "sync stale approved ne ressuscite pas après annulation",
);
assert(
  mergeStudyConseillerValidation(cancelled, {
    ...pending,
    submittedAt: "2026-07-21T12:00:00.000Z",
  })?.status === "pending",
  "nouvelle soumission après annulation OK",
);

const dossier = {
  id: "LCIF-TEST-RESUBMIT",
  formData: { assures: [{ prenom: "Jean", nom: "Dupont" }] },
  studyConseillerValidation: { ...approved },
  events: [],
  eventLog: [],
} as unknown as Dossier;

const cancelledResult = cancelStudyConseillerValidation(dossier, "admin@test.fr");
assert(cancelledResult.ok === true, "cancel approved OK");
assert(dossier.studyConseillerValidation?.status === "cancelled", "statut cancelled");
assert(Boolean(dossier.studyConseillerValidation?.cancelledAt), "cancelledAt posé");

console.log("\nMerge validation conseiller OK.");
