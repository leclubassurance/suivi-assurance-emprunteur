/** Segment dossier pour la projection rémunération club. */
export type ClubRevenueSegment = "pipeline" | "signed" | "settled";

/** Point mensuel agrégé — réalisé + signé + théorique. */
export type ClubRevenueMonthPoint = {
  monthKey: string;
  label: string;
  /** Dossiers traités — courtage net club encaissé ce mois (ponctuel). */
  settledCourtageNetEur: number;
  settledCourtageGrossEur: number;
  /** Commission linéaire Kereis — dossiers traités. */
  settledMonthlyCommissionEur: number;
  /** Dossiers signés, pas encore traités — courtage net club attendu à la signature. */
  signedCourtageNetEur: number;
  signedCourtageGrossEur: number;
  /** Commission linéaire — dossiers signés en cours. */
  signedMonthlyCommissionEur: number;
  /** Pipeline (théorique) — courtage net club si signature ce mois. */
  pipelineCourtageNetEur: number;
  pipelineCourtageGrossEur: number;
  /** Commission linéaire projetée — dossiers en cours de signature. */
  pipelineMonthlyCommissionEur: number;
  settledContributors: number;
  signedContributors: number;
  pipelineContributors: number;
};

export type ClubRevenueForecastSummary = {
  /** MRR commission linéaire — dossiers traités (réalisé). */
  settledMrrCommissionEur: number;
  /** MRR commission linéaire — signés en cours (quasi assuré). */
  signedMrrCommissionEur: number;
  /** MRR commission linéaire — pipeline théorique. */
  pipelineMrrCommissionEur: number;
  /** Courtage net club — somme pipeline (théorique, ponctuel à la signature). */
  pipelineCourtageNetEur: number;
  pipelineCourtageGrossEur: number;
  /** Courtage net club — signés en attente de traitement (ponctuel). */
  signedCourtageNetEur: number;
  signedCourtageGrossEur: number;
  /** Courtage net club — dossiers traités (déjà encaissé ou en cours de règlement). */
  settledCourtageNetEur: number;
  settledCourtageGrossEur: number;
  settledDossiers: number;
  signedDossiers: number;
  pipelineDossiers: number;
  /** Détail par dossier pour contrôle. */
  contributions?: Array<{
    id: string;
    segment: ClubRevenueSegment;
    courtageGrossEur: number;
    courtageNetEur: number;
    monthlyCommissionEur: number;
    startMonthKey: string;
  }>;
};

export type ClubRevenueForecast = {
  months: ClubRevenueMonthPoint[];
  summary: ClubRevenueForecastSummary;
  generatedAt: string;
};

export type ForecastDossierContribution = {
  id: string;
  segment: ClubRevenueSegment;
  startMonthKey: string;
  courtageGrossEur: number;
  courtageNetEur: number;
  monthlyCommissionEur: number;
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

export function monthPointTotalNetClub(point: ClubRevenueMonthPoint): number {
  return (
    point.settledCourtageNetEur +
    point.settledMonthlyCommissionEur +
    point.signedCourtageNetEur +
    point.signedMonthlyCommissionEur +
    point.pipelineCourtageNetEur +
    point.pipelineMonthlyCommissionEur
  );
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
    settledCourtageNetEur: 0,
    settledCourtageGrossEur: 0,
    settledMonthlyCommissionEur: 0,
    signedCourtageNetEur: 0,
    signedCourtageGrossEur: 0,
    signedMonthlyCommissionEur: 0,
    pipelineCourtageNetEur: 0,
    pipelineCourtageGrossEur: 0,
    pipelineMonthlyCommissionEur: 0,
    settledContributors: 0,
    signedContributors: 0,
    pipelineContributors: 0,
  });

  const byMonth = new Map(monthKeys.map((k) => [k, emptyPoint(k)]));

  let settledCount = 0;
  let signedCount = 0;
  let pipelineCount = 0;
  let pipelineCourtageNetEur = 0;
  let pipelineCourtageGrossEur = 0;
  let pipelineMrrCommissionEur = 0;
  let signedCourtageNetTotal = 0;
  let signedCourtageGrossTotal = 0;
  let settledCourtageNetTotal = 0;
  let settledCourtageGrossTotal = 0;

  for (const c of contributions) {
    const startMonthKey = clampMonthKeyToRange(c.startMonthKey, monthKeys);
    const startIdx = monthKeys.indexOf(startMonthKey);
    if (startIdx < 0) continue;

    if (c.segment === "settled") {
      settledCount += 1;
      settledCourtageNetTotal += c.courtageNetEur;
      settledCourtageGrossTotal += c.courtageGrossEur;
    } else if (c.segment === "signed") {
      signedCount += 1;
      signedCourtageNetTotal += c.courtageNetEur;
      signedCourtageGrossTotal += c.courtageGrossEur;
    } else {
      pipelineCount += 1;
      pipelineCourtageNetEur += c.courtageNetEur;
      pipelineCourtageGrossEur += c.courtageGrossEur;
      pipelineMrrCommissionEur += c.monthlyCommissionEur;
    }

    for (let i = startIdx; i < monthKeys.length; i++) {
      const key = monthKeys[i];
      const point = byMonth.get(key);
      if (!point) continue;

      if (c.segment === "settled") {
        if (i === startIdx) {
          point.settledCourtageGrossEur += c.courtageGrossEur;
          point.settledCourtageNetEur += c.courtageNetEur;
          point.settledContributors += 1;
        }
        point.settledMonthlyCommissionEur += c.monthlyCommissionEur;
      } else if (c.segment === "signed") {
        if (i === startIdx) {
          point.signedCourtageGrossEur += c.courtageGrossEur;
          point.signedCourtageNetEur += c.courtageNetEur;
          point.signedContributors += 1;
        }
        point.signedMonthlyCommissionEur += c.monthlyCommissionEur;
      } else {
        if (i === startIdx) {
          point.pipelineCourtageGrossEur += c.courtageGrossEur;
          point.pipelineCourtageNetEur += c.courtageNetEur;
          point.pipelineContributors += 1;
        }
        point.pipelineMonthlyCommissionEur += c.monthlyCommissionEur;
      }
    }
  }

  const current = byMonth.get(currentKey);

  const summary: ClubRevenueForecastSummary = {
    settledMrrCommissionEur: current?.settledMonthlyCommissionEur ?? 0,
    signedMrrCommissionEur: current?.signedMonthlyCommissionEur ?? 0,
    pipelineMrrCommissionEur: current?.pipelineMonthlyCommissionEur ?? 0,
    pipelineCourtageNetEur,
    pipelineCourtageGrossEur,
    signedCourtageNetEur: signedCourtageNetTotal,
    signedCourtageGrossEur: signedCourtageGrossTotal,
    settledCourtageNetEur: settledCourtageNetTotal,
    settledCourtageGrossEur: settledCourtageGrossTotal,
    settledDossiers: settledCount,
    signedDossiers: signedCount,
    pipelineDossiers: pipelineCount,
    contributions: contributions.map((c) => ({
      id: c.id,
      segment: c.segment,
      courtageGrossEur: c.courtageGrossEur,
      courtageNetEur: c.courtageNetEur,
      monthlyCommissionEur: c.monthlyCommissionEur,
      startMonthKey: clampMonthKeyToRange(c.startMonthKey, monthKeys),
    })),
  };

  return {
    months: monthKeys.map((k) => byMonth.get(k)!),
    summary,
    generatedAt: now.toISOString(),
  };
}
