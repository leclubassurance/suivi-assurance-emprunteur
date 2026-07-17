/**
 * Usage: npx tsx scripts/verify-low-savings-courtage.ts
 */
import {
  LOW_SAVINGS_COURTAGE_THRESHOLD_EUR,
  resolveEffectiveMinPerAssuredEur,
  validateFeesPerAssuredEur,
} from "../server/studyConseillerValidation";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const config = { minPerAssuredEur: 200, maxPerAssuredEur: 500 };

assert(LOW_SAVINGS_COURTAGE_THRESHOLD_EUR === 2000, "seuil 2000 €");

assert(
  resolveEffectiveMinPerAssuredEur({ configMinPerAssuredEur: 200, grossSavingsEur: 1564 }) === 0,
  "économie 1564 → min 0",
);
assert(
  resolveEffectiveMinPerAssuredEur({ configMinPerAssuredEur: 200, grossSavingsEur: 2500 }) === 200,
  "économie 2500 → min 200",
);

assert(validateFeesPerAssuredEur(150, config, { grossSavingsEur: 1564 }).ok === true, "150 € OK si < 2000");
assert(validateFeesPerAssuredEur(150, config, { grossSavingsEur: 3000 }).ok === false, "150 € refusé si >= 2000");
assert(validateFeesPerAssuredEur(200, config, { grossSavingsEur: 3000 }).ok === true, "200 € OK barème normal");
assert(validateFeesPerAssuredEur(0, config, { grossSavingsEur: 3000 }).ok === true, "0 € toujours OK");

console.log("\nLow savings courtage OK.");
