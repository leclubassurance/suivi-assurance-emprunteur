/**
 * Vérifie parsing + overrides assistant ADE (sans Gemini / PDF).
 * Usage: npx tsx scripts/verify-ade-study-assist.ts
 */
import assert from "assert";
import {
  parseAssistNumber,
  areAdeAssistOverridesComplete,
  applyAdeAssistOverrides,
  buildAssistAgenda,
  dossierHasAdeAssistBypass,
} from "../server/adeStudyAssist";
import type { EconomyComputation } from "../server/economyFromDocs";

function baseEco(partial: Partial<EconomyComputation["extracted"]> = {}): EconomyComputation {
  return {
    ok: false,
    reliability: "LOW",
    reasons: [],
    extracted: { ...partial },
  };
}

// --- parse ---
assert.equal(parseAssistNumber("4 426,94 €", "eur").value, 4426.94);
assert.equal(parseAssistNumber("2028.60", "eur").value, 2028.6);
assert.equal(parseAssistNumber("222 mois", "months").value, 222);
assert.equal(parseAssistNumber("passer", "eur").skip, true);
assert.equal(parseAssistNumber("environ 2000", "eur").ambiguous, true);

// --- overrides completeness ---
assert.equal(areAdeAssistOverridesComplete({}), false);
assert.equal(
  areAdeAssistOverridesComplete({
    currentTotalEur: 4426.94,
    proposedTotalEur: 2028.6,
    remainingMonths: 222,
  }),
  true,
);

// --- merge ---
const merged = applyAdeAssistOverrides(baseEco({ remainingMonths: 100 }), {
  currentTotalEur: 5000,
  proposedTotalEur: 2000,
  remainingMonths: 240,
  feesAssureurEur: 110,
});
assert.equal(merged.ok, true);
assert.equal(merged.extracted.currentTotalRemaining, 5000);
assert.equal(merged.extracted.proposedTotalRemaining, 2000);
assert.equal(merged.result?.grossSavings, 3000);
assert.ok(merged.reasons.some((r) => /Assistant ADE/i.test(r)));

// --- agenda asks missing only ---
const agenda = buildAssistAgenda(baseEco({ proposedTotalRemaining: 2000 }), {});
assert.ok(agenda.some((a) => a.id === "currentTotalEur"));
assert.ok(agenda.some((a) => a.id === "remainingMonths"));
assert.ok(!agenda.some((a) => a.id === "proposedTotalEur"));

// --- bypass ---
assert.equal(
  dossierHasAdeAssistBypass({
    adeStudyAssist: {
      mode: "study",
      status: "ready",
      overrides: { currentTotalEur: 1, proposedTotalEur: 1, remainingMonths: 12 },
      kereisPatches: {},
      messages: [],
    },
  }),
  true,
);
assert.equal(
  dossierHasAdeAssistBypass({
    adeStudyAssist: {
      mode: "study",
      status: "needs_input",
      overrides: { currentTotalEur: 1, proposedTotalEur: 1, remainingMonths: 12 },
      kereisPatches: {},
      messages: [],
    },
  }),
  true,
);
assert.equal(
  dossierHasAdeAssistBypass({
    adeStudyAssist: {
      mode: "kereis",
      status: "ready",
      overrides: {},
      kereisPatches: {},
      messages: [],
    },
  }),
  false,
);

console.log("verify-ade-study-assist: OK");
