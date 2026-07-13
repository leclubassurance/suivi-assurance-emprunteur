/**
 * Usage: npx tsx scripts/verify-club-revenue-forecast.ts
 */
import {
  buildClubRevenueForecastFromContributions,
  monthPointTotalNetClub,
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
      segment: "settled",
      startMonthKey: start,
      courtageGrossEur: 250,
      courtageNetEur: 200,
      monthlyCommissionEur: 15,
    },
    {
      id: "B",
      segment: "pipeline",
      startMonthKey: "2026-08",
      courtageGrossEur: 400,
      courtageNetEur: 300,
      monthlyCommissionEur: 20,
    },
    {
      id: "C",
      segment: "signed",
      startMonthKey: "2026-06",
      courtageGrossEur: 500,
      courtageNetEur: 350,
      monthlyCommissionEur: 10,
    },
    {
      id: "D",
      segment: "pipeline",
      startMonthKey: "2027-02",
      courtageGrossEur: 1400,
      courtageNetEur: 900,
      monthlyCommissionEur: 0,
    },
  ],
  { monthsPast: 2, monthsFuture: 3, now },
);

const may = forecast.months.find((m) => m.monthKey === "2026-05");
const jun = forecast.months.find((m) => m.monthKey === "2026-06");
const jul = forecast.months.find((m) => m.monthKey === "2026-07");
const aug = forecast.months.find((m) => m.monthKey === "2026-08");
const last = forecast.months[forecast.months.length - 1];

assert(Boolean(may), "mai présent");
assert(may!.settledCourtageNetEur === 200, "courtage net traité mai");
assert(may!.settledMonthlyCommissionEur === 15, "commission récurrente traitée mai");
assert(jun!.signedCourtageNetEur === 350, "courtage net signé juin");
assert(jun!.signedMonthlyCommissionEur === 10, "commission signée juin");
assert(jul!.settledMonthlyCommissionEur === 15, "commission traitée juillet");
assert(jul!.signedMonthlyCommissionEur === 10, "commission signée juillet");
assert(aug!.pipelineCourtageNetEur === 300, "projection courtage net août");
assert(aug!.pipelineMonthlyCommissionEur === 20, "projection récurrent août");
assert(
  monthPointTotalNetClub(aug!) === 345,
  "total août = courtage pipeline + récurrent signé + récurrent traité",
);
assert(last!.pipelineCourtageNetEur === 900, "courtage pipeline hors fenêtre clampé au dernier mois");
assert(forecast.summary.settledMrrCommissionEur === 15, "MRR traités total");
assert(forecast.summary.signedMrrCommissionEur === 10, "MRR signés total");
assert(forecast.summary.pipelineMrrCommissionEur === 20, "MRR pipeline total");
assert(forecast.summary.pipelineCourtageNetEur === 1200, "somme courtage pipeline net");
assert(forecast.summary.peakMonthKey === last!.monthKey, "pic sur le mois le plus chargé");
assert(forecast.summary.peakMonthTotalEur === monthPointTotalNetClub(last!), "montant pic cohérent");

console.log("\nForecast OK.");
