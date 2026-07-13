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
      courtageGrossEur: 250,
      courtageNetEur: 200,
      monthlyCommissionEur: 15,
      monthlyPremiumEur: 100,
    },
    {
      id: "B",
      segment: "pipeline",
      startMonthKey: "2026-08",
      courtageGrossEur: 400,
      courtageNetEur: 300,
      monthlyCommissionEur: 20,
      monthlyPremiumEur: 120,
    },
    {
      id: "C",
      segment: "pipeline",
      startMonthKey: "2027-02",
      courtageGrossEur: 1400,
      courtageNetEur: 900,
      monthlyCommissionEur: 0,
      monthlyPremiumEur: 0,
    },
  ],
  { monthsPast: 2, monthsFuture: 3, now },
);

const may = forecast.months.find((m) => m.monthKey === "2026-05");
const jul = forecast.months.find((m) => m.monthKey === "2026-07");
const aug = forecast.months.find((m) => m.monthKey === "2026-08");
const last = forecast.months[forecast.months.length - 1];

assert(Boolean(may), "mai présent");
assert(may!.courtageGrossEur === 250, "courtage brut mai");
assert(may!.courtageNetEur === 200, "courtage net mai");
assert(may!.monthlyCommissionEur === 15, "commission récurrente mai");
assert(jul!.monthlyCommissionEur === 15, "commission juillet signé");
assert(jul!.monthlyPremiumEur === 100, "prime juillet");
assert(aug!.projectedCourtageGrossEur === 400, "projection courtage brut août");
assert(aug!.projectedCourtageNetEur === 300, "projection courtage net août");
assert(aug!.projectedMonthlyCommissionEur === 20, "projection MRR août");
assert(aug!.projectedTotalEur === 420, "projection totale août = courtage brut + MRR");
assert(last!.projectedCourtageGrossEur === 1400, "courtage pipeline hors fenêtre clampé au dernier mois");
assert(forecast.summary.currentMrrCommissionEur === 15, "MRR courant");
assert(forecast.summary.projectedMrrCommissionEur === 35, "MRR avec pipeline");
assert(forecast.summary.projectedPipelineCourtageGrossEur === 1800, "somme courtage pipeline brut");

console.log("\nForecast OK.");
