/**
 * Usage: npx tsx scripts/verify-study-conseiller-cancel.ts
 */
import { cancelStudyConseillerValidation } from "../server/studyConseillerValidation";
import type { Dossier } from "../server/dossierModel";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const dossier = {
  id: "LCIF-TEST-CANCEL",
  formData: { assures: [{ prenom: "Jean", nom: "Dupont" }] },
  studyConseillerValidation: {
    status: "approved" as const,
    submittedAt: "2026-06-30T10:00:00.000Z",
    subject: "Étude",
    html: "<p>Bonjour</p>",
    assuredCount: 1,
    suggestedFeePerAssuredEur: 400,
    feesPerAssuredEur: 400,
    feesCourtageTotalEur: 400,
    approvedAt: "2026-06-30T12:00:00.000Z",
  },
  events: [],
} as unknown as Dossier;

const cancelled = cancelStudyConseillerValidation(dossier, "admin@test.fr");
assert(cancelled.ok === true, "annulation approved OK");
assert(dossier.studyConseillerValidation?.status === "cancelled", "statut cancelled");
assert(dossier.studyConseillerValidation?.feesCourtageTotalEur == null, "frais courtage effacés");

const nothing = cancelStudyConseillerValidation(dossier, "admin@test.fr");
assert(!nothing.ok && nothing.error === "nothing_to_cancel", "rien à annuler si déjà cancelled");

dossier.studyConseillerValidation = {
  status: "pending",
  submittedAt: "2026-07-20T10:00:00.000Z",
  subject: "Étude v2",
  html: "<p>v2</p>",
  assuredCount: 1,
  suggestedFeePerAssuredEur: 350,
};
const cancelPending = cancelStudyConseillerValidation(dossier, "admin");
assert(cancelPending.ok === true, "annulation pending OK");
assert(dossier.studyConseillerValidation?.status === "cancelled", "pending → cancelled");

console.log("\nAnnulation validation conseiller OK.");
