/** Point mensuel agrégé — réalisé + projection pipeline. */
export type ClubRevenueMonthPoint = {
  monthKey: string;
  label: string;
  /** Courtage net club encaissé ce mois (ponctuel). */
  courtageNetEur: number;
  /** Courtage brut (avant rétro) encaissé ce mois. */
  courtageGrossEur: number;
  /** Commissions linéaires Kereis ce mois (contrats actifs). */
  monthlyCommissionEur: number;
  /** Primes clients ce mois (somme primes annuelles / 12). */
  monthlyPremiumEur: number;
  /** Total net club réalisé = courtage net + commissions du mois. */
  totalNetClubEur: number;
  /** Projection : courtage brut si dossiers pipeline signent ce mois. */
  projectedCourtageGrossEur: number;
  /** Projection : courtage net club si dossiers pipeline signent ce mois. */
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
  /** Somme des courtages bruts des dossiers en pipeline (ponctuel à la signature). */
  projectedPipelineCourtageGrossEur: number;
  projectedPipelineCourtageNetEur: number;
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
  courtageGrossEur: number;
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

/** Clé mois locale AAAA-MM (évite les décalages UTC). */
export function toMonthKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function toMonthKey(isoOrYmd: string): string {
  if (!isoOrYmd) return "";
  if (/^\d{4}-\d{2}$/.test(isoOrYmd.trim())) return isoOrYmd.trim();
  const d = new Date(isoOrYmd.includes("T") ? isoOrYmd : `${isoOrYmd}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return "";
  return toMonthKeyFromDate(d);
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
    keys.push(toMonthKeyFromDate(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys;
}

export function nextMonthKey(from = new Date()): string {
  return toMonthKeyFromDate(new Date(from.getFullYear(), from.getMonth() + 1, 1));
}

export function clampMonthKeyToRange(key: string, monthKeys: string[]): string {
  if (!monthKeys.length) return key;
  if (monthKeys.includes(key)) return key;
  if (!key) return monthKeys[monthKeys.length - 1];
  if (key < monthKeys[0]) return monthKeys[0];
  if (key > monthKeys[monthKeys.length - 1]) return monthKeys[monthKeys.length - 1];
  return monthKeys[monthKeys.length - 1];
}

export function buildClubRevenueForecastFromContributions(
  contributions: ForecastDossierContribution[],
  options?: { monthsPast?: number; monthsFuture?: number; now?: Date },
): ClubRevenueForecast {
  const monthsPast = Math.max(0, Math.min(24, options?.monthsPast ?? 6));
  const monthsFuture = Math.max(1, Math.min(24, options?.monthsFuture ?? 6));
  const now = options?.now ?? new Date();
  const monthKeys = buildMonthKeyRange(monthsPast, monthsFuture, now);
  const currentKey = toMonthKeyFromDate(now);

  const emptyPoint = (monthKey: string): ClubRevenueMonthPoint => ({
    monthKey,
    label: formatMonthLabel(monthKey),
    courtageNetEur: 0,
    courtageGrossEur: 0,
    monthlyCommissionEur: 0,
    monthlyPremiumEur: 0,
    totalNetClubEur: 0,
    projectedCourtageGrossEur: 0,
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
  let projectedPipelineCourtageGrossEur = 0;
  let projectedPipelineCourtageNetEur = 0;
  let projectedPipelineMrrCommissionEur = 0;

  for (const c of contributions) {
    const startMonthKey = clampMonthKeyToRange(c.startMonthKey, monthKeys);
    const startIdx = monthKeys.indexOf(startMonthKey);
    if (startIdx < 0) continue;

    if (c.segment === "signed") signedCount += 1;
    else {
      pipelineCount += 1;
      projectedPipelineCourtageGrossEur += c.courtageGrossEur;
      projectedPipelineCourtageNetEur += c.courtageNetEur;
      projectedPipelineMrrCommissionEur += c.monthlyCommissionEur;
    }

    for (let i = startIdx; i < monthKeys.length; i++) {
      const key = monthKeys[i];
      const point = byMonth.get(key);
      if (!point) continue;

      if (c.segment === "signed") {
        if (i === startIdx) {
          point.courtageGrossEur += c.courtageGrossEur;
          point.courtageNetEur += c.courtageNetEur;
          point.signedContributors += 1;
        }
        point.monthlyCommissionEur += c.monthlyCommissionEur;
        point.monthlyPremiumEur += c.monthlyPremiumEur;
        point.totalNetClubEur = point.courtageNetEur + point.monthlyCommissionEur;
      } else {
        if (i === startIdx) {
          point.projectedCourtageGrossEur += c.courtageGrossEur;
          point.projectedCourtageNetEur += c.courtageNetEur;
          point.pipelineContributors += 1;
        }
        point.projectedMonthlyCommissionEur += c.monthlyCommissionEur;
        point.projectedMonthlyPremiumEur += c.monthlyPremiumEur;
        point.projectedTotalEur =
          point.projectedCourtageGrossEur + point.projectedMonthlyCommissionEur;
      }
    }
  }

  const current = byMonth.get(currentKey);
  const summary: ClubRevenueForecastSummary = {
    currentMrrCommissionEur: current?.monthlyCommissionEur ?? 0,
    currentMonthlyPremiumEur: current?.monthlyPremiumEur ?? 0,
    projectedMrrCommissionEur:
      (current?.monthlyCommissionEur ?? 0) + projectedPipelineMrrCommissionEur,
    projectedPipelineCourtageGrossEur,
    projectedPipelineCourtageNetEur,
    signedDossiers: signedCount,
    pipelineDossiers: pipelineCount,
  };

  return {
    months: monthKeys.map((k) => byMonth.get(k)!),
    summary,
    generatedAt: now.toISOString(),
  };
}
