/**
 * Usage: npx tsx scripts/verify-club-revenue-forecast.ts
 */
import {
  buildClubRevenueForecastFromContributions,
  toMonthKey,
} from "../shared/clubRevenueForecast";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const now = new Date("2026-07-15T12:00:00.000Z");
const start = toMonthKey("2026-05-01");

const forecast = buildClubRevenueForecastFromContributions(
  [
    {
      id: "A",
      segment: "signed",
      startMonthKey: start,
      courtageNetEur: 200,
      monthlyCommissionEur: 15,
      monthlyPremiumEur: 100,
    },
    {
      id: "B",
      segment: "pipeline",
      startMonthKey: "2026-08",
      courtageNetEur: 300,
      monthlyCommissionEur: 20,
      monthlyPremiumEur: 120,
    },
  ],
  { monthsPast: 2, monthsFuture: 3, now },
);

const may = forecast.months.find((m) => m.monthKey === "2026-05");
const jul = forecast.months.find((m) => m.monthKey === "2026-07");
const aug = forecast.months.find((m) => m.monthKey === "2026-08");

assert(Boolean(may), "mai présent");
assert(may!.courtageNetEur === 200, "courtage mai");
assert(may!.monthlyCommissionEur === 15, "commission récurrente mai");
assert(jul!.monthlyCommissionEur === 15, "commission juillet signé");
assert(jul!.monthlyPremiumEur === 100, "prime juillet");
assert(aug!.projectedCourtageNetEur === 300, "projection courtage août");
assert(aug!.projectedMonthlyCommissionEur === 20, "projection MRR août");
assert(forecast.summary.currentMrrCommissionEur === 15, "MRR courant");
assert(forecast.summary.projectedMrrCommissionEur === 35, "MRR avec pipeline");

console.log("\nForecast OK.");
