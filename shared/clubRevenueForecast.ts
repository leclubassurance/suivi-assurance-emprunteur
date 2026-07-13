/** Point mensuel agrégé — réalisé + projection pipeline. */
export type ClubRevenueMonthPoint = {
  monthKey: string;
  label: string;
  /** Courtage net club encaissé ce mois (ponctuel). */
  courtageNetEur: number;
  /** Commissions linéaires Kereis ce mois (contrats actifs). */
  monthlyCommissionEur: number;
  /** Primes clients ce mois (somme primes annuelles / 12). */
  monthlyPremiumEur: number;
  /** Total net club réalisé = courtage + commissions du mois. */
  totalNetClubEur: number;
  /** Projection : courtage net si dossiers pipeline signent ce mois. */
  projectedCourtageNetEur: number;
  projectedMonthlyCommissionEur: number;
  projectedMonthlyPremiumEur: number;
  projectedTotalEur: number;
  signedContributors: number;
  pipelineContributors: number;
};

export type ClubRevenueForecastSummary = {
  currentMrrCommissionEur: number;
  currentMonthlyPremiumEur: number;
  projectedMrrCommissionEur: number;
  signedDossiers: number;
  pipelineDossiers: number;
};

export type ClubRevenueForecast = {
  months: ClubRevenueMonthPoint[];
  summary: ClubRevenueForecastSummary;
  generatedAt: string;
};

export type ForecastDossierContribution = {
  id: string;
  segment: "signed" | "pipeline";
  startMonthKey: string;
  courtageNetEur: number;
  monthlyCommissionEur: number;
  monthlyPremiumEur: number;
};

const MONTH_LABELS = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
];

export function toMonthKey(isoOrYmd: string): string {
  const d = new Date(isoOrYmd.includes("T") ? isoOrYmd : `${isoOrYmd}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-");
  const mi = Number(m) - 1;
  if (!y || mi < 0 || mi > 11) return monthKey;
  return `${MONTH_LABELS[mi]} ${y.slice(2)}`;
}

export function buildMonthKeyRange(monthsPast: number, monthsFuture: number, now = new Date()): string[] {
  const keys: string[] = [];
  const start = new Date(now.getFullYear(), now.getMonth() - monthsPast, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + monthsFuture, 1);
  const cursor = new Date(start);
  while (cursor <= end) {
    keys.push(toMonthKey(cursor.toISOString()));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys;
}

export function nextMonthKey(from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  return toMonthKey(d.toISOString());
}

export function buildClubRevenueForecastFromContributions(
  contributions: ForecastDossierContribution[],
  options?: { monthsPast?: number; monthsFuture?: number; now?: Date },
): ClubRevenueForecast {
  const monthsPast = Math.max(0, Math.min(24, options?.monthsPast ?? 6));
  const monthsFuture = Math.max(1, Math.min(24, options?.monthsFuture ?? 6));
  const now = options?.now ?? new Date();
  const monthKeys = buildMonthKeyRange(monthsPast, monthsFuture, now);
  const currentKey = toMonthKey(now.toISOString());

  const emptyPoint = (monthKey: string): ClubRevenueMonthPoint => ({
    monthKey,
    label: formatMonthLabel(monthKey),
    courtageNetEur: 0,
    monthlyCommissionEur: 0,
    monthlyPremiumEur: 0,
    totalNetClubEur: 0,
    projectedCourtageNetEur: 0,
    projectedMonthlyCommissionEur: 0,
    projectedMonthlyPremiumEur: 0,
    projectedTotalEur: 0,
    signedContributors: 0,
    pipelineContributors: 0,
  });

  const byMonth = new Map(monthKeys.map((k) => [k, emptyPoint(k)]));

  let signedCount = 0;
  let pipelineCount = 0;

  for (const c of contributions) {
    if (c.segment === "signed") signedCount += 1;
    else pipelineCount += 1;

    const startIdx = monthKeys.indexOf(c.startMonthKey);
    if (startIdx < 0) continue;

    for (let i = startIdx; i < monthKeys.length; i++) {
      const key = monthKeys[i];
      const point = byMonth.get(key);
      if (!point) continue;

      if (c.segment === "signed") {
        if (i === startIdx) {
          point.courtageNetEur += c.courtageNetEur;
          point.signedContributors += 1;
        }
        point.monthlyCommissionEur += c.monthlyCommissionEur;
        point.monthlyPremiumEur += c.monthlyPremiumEur;
        point.totalNetClubEur =
          point.courtageNetEur + point.monthlyCommissionEur;
      } else {
        if (i === startIdx) {
          point.projectedCourtageNetEur += c.courtageNetEur;
          point.pipelineContributors += 1;
        }
        point.projectedMonthlyCommissionEur += c.monthlyCommissionEur;
        point.projectedMonthlyPremiumEur += c.monthlyPremiumEur;
        point.projectedTotalEur =
          point.projectedCourtageNetEur + point.projectedMonthlyCommissionEur;
      }
    }
  }

  const current = byMonth.get(currentKey);
  const summary: ClubRevenueForecastSummary = {
    currentMrrCommissionEur: current?.monthlyCommissionEur ?? 0,
    currentMonthlyPremiumEur: current?.monthlyPremiumEur ?? 0,
    projectedMrrCommissionEur:
      (current?.monthlyCommissionEur ?? 0) + (current?.projectedMonthlyCommissionEur ?? 0),
    signedDossiers: signedCount,
    pipelineDossiers: pipelineCount,
  };

  return {
    months: monthKeys.map((k) => byMonth.get(k)!),
    summary,
    generatedAt: now.toISOString(),
  };
}
