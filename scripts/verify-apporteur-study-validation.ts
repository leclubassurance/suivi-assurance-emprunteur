/**
 * Usage: npx tsx scripts/verify-apporteur-study-validation.ts
 */
import assert from "node:assert/strict";
import type { Dossier } from "../server/dossierModel";
import {
  buildPortalStudyValidationPending,
  extractStudyValidationContext,
} from "../server/studyConseillerValidation";
import { getRemunerationConfig } from "../shared/apporteurRemuneration";

const dossier: Dossier = {
  id: "D-TEST-001",
  status: "EN_COURS",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  apporteur: { apporteurId: "ap-test" },
  formData: { assures: [{ prenom: "Alice", nom: "Martin" }] },
  studyConseillerValidation: {
    status: "pending",
    submittedAt: new Date().toISOString(),
    subject: "Votre étude personnalisée",
    assuredCount: 1,
    suggestedFeePerAssuredEur: 200,
    grossSavingsEur: 5000,
  },
} as Dossier;

// Mock findApporteurById via module cache is hard — test pure helpers instead.
const apporteurConfig = getRemunerationConfig("apporteur_affaires");
const ctx = extractStudyValidationContext("", dossier, "", apporteurConfig);
assert.ok(ctx.suggestedFeePerAssuredEur >= 200, "suggested fee respects barème apporteur");

const pending = buildPortalStudyValidationPending(dossier, apporteurConfig);
assert.ok(pending, "pending validation built");
assert.equal(pending!.payoutSharePercent, 0.5, "50 % rétro apporteur");
assert.equal(pending!.conseillerRetroEur, 100, "rétro sur 200 € courtage");

console.log("verify-apporteur-study-validation: OK");
