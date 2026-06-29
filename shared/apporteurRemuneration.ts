/**
 * Barème apporteur LCIF (TTC, par assuré) :
 * - Frais de courtage = 10 % des économies annuelles réalisées
 * - Plancher 200 € / plafond 500 € par assuré
 * - Rémunération apporteur = 50 % des frais de courtage
 */
export type ApporteurRemunerationTier = "agent_immo" | "courtier" | "autre";

export type RemunerationConfig = {
  savingsSharePercent: number;
  minPerAssuredEur: number;
  maxPerAssuredEur: number;
  apporteurShareOfBrokerage: number;
  /** Override parrain N1 : part des frais de courtage sur dossiers signés des filleuls. */
  sponsorOverrideShareOfBrokerage: number;
  /** Hypothèse simulateur — économies annuelles moyennes par assuré. */
  defaultAnnualSavingsEur: number;
  defaultAssuredPerDossier: number;
  defaultConversionRate: number;
  disclaimer: string;
};

export function getRemunerationConfig(_tier: ApporteurRemunerationTier = "autre"): RemunerationConfig {
  return {
    savingsSharePercent: 10,
    minPerAssuredEur: 200,
    maxPerAssuredEur: 500,
    apporteurShareOfBrokerage: 0.5,
    sponsorOverrideShareOfBrokerage: 0.1,
    defaultAnnualSavingsEur: 3600,
    defaultAssuredPerDossier: 1.5,
    defaultConversionRate: 0.28,
    disclaimer:
      "Montants indicatifs TTC : 50 % des frais de courtage sur vos dossiers signés ; 10 % des frais de courtage sur les dossiers signés de vos filleuls directs (niveau 1). Paiement à réception de la commission assureur.",
  };
}

/** Frais de courtage LCIF pour un dossier (avant part apporteur). */
export function computeBrokerageFeeEur(params: {
  annualSavingsEur: number;
  assuredCount: number;
  config: Pick<RemunerationConfig, "savingsSharePercent" | "minPerAssuredEur" | "maxPerAssuredEur">;
}): number {
  const perAssured = Math.min(
    params.config.maxPerAssuredEur,
    Math.max(
      params.config.minPerAssuredEur,
      (params.annualSavingsEur * params.config.savingsSharePercent) / 100,
    ),
  );
  return Math.round(perAssured * Math.max(1, params.assuredCount));
}

/** Rémunération apporteur pour un dossier signé. */
export function computeApporteurPayoutEur(params: {
  annualSavingsEur: number;
  assuredCount: number;
  config: RemunerationConfig;
}): number {
  const brokerage = computeBrokerageFeeEur({
    annualSavingsEur: params.annualSavingsEur,
    assuredCount: params.assuredCount,
    config: params.config,
  });
  return Math.round(brokerage * params.config.apporteurShareOfBrokerage);
}

export type EarningsEstimate = {
  dossiersPerMonth: number;
  conversionRate: number;
  payoutPerSignatureEur: number;
  expectedSignatures: number;
  expectedMonthlyEur: number;
  optimisticMonthlyEur: number;
  conservativeMonthlyEur: number;
};

export function estimatePartnerEarnings(params: {
  dossiersPerMonth: number;
  conversionRate: number;
  payoutPerSignatureEur: number;
}): EarningsEstimate {
  const n = Math.max(0, Math.min(50, params.dossiersPerMonth));
  const rate = Math.max(0.05, Math.min(0.9, params.conversionRate));
  const payout = Math.max(0, params.payoutPerSignatureEur);
  const expectedSignatures = Math.round(n * rate * 10) / 10;
  const expectedMonthlyEur = Math.round(expectedSignatures * payout);
  const optimisticMonthlyEur = Math.round(n * Math.min(rate + 0.12, 0.85) * payout);
  const conservativeMonthlyEur = Math.round(n * Math.max(rate - 0.1, 0.08) * payout);

  return {
    dossiersPerMonth: n,
    conversionRate: rate,
    payoutPerSignatureEur: payout,
    expectedSignatures,
    expectedMonthlyEur,
    optimisticMonthlyEur,
    conservativeMonthlyEur,
  };
}

export function computeEarnedAndPipelineEur(
  signedCount: number,
  openCount: number,
  payoutPerSignatureEur: number,
  conversionRate: number,
): { earnedEur: number; pipelineEur: number; totalIndicatifEur: number } {
  const earnedEur = signedCount * payoutPerSignatureEur;
  const pipelineEur = Math.round(openCount * conversionRate * payoutPerSignatureEur);
  return { earnedEur, pipelineEur, totalIndicatifEur: earnedEur + pipelineEur };
}

export function computeSponsorOverridePayoutEur(params: {
  annualSavingsEur: number;
  assuredCount: number;
  config: RemunerationConfig;
}): number {
  const brokerage = computeBrokerageFeeEur({
    annualSavingsEur: params.annualSavingsEur,
    assuredCount: params.assuredCount,
    config: params.config,
  });
  return Math.round(brokerage * params.config.sponsorOverrideShareOfBrokerage);
}

export function computeApporteurEarningsWithTeam(params: {
  personalSigned: number;
  teamSigned: number;
  payoutPerDirectEur: number;
  payoutPerOverrideEur: number;
  openPersonal: number;
  openTeam: number;
  conversionRate: number;
}): {
  personalEarnedEur: number;
  teamEarnedEur: number;
  earnedEur: number;
  pipelineEur: number;
  totalIndicatifEur: number;
} {
  const personalEarnedEur = params.personalSigned * params.payoutPerDirectEur;
  const teamEarnedEur = params.teamSigned * params.payoutPerOverrideEur;
  const pipelinePersonalEur = Math.round(params.openPersonal * params.conversionRate * params.payoutPerDirectEur);
  const pipelineTeamEur = Math.round(params.openTeam * params.conversionRate * params.payoutPerOverrideEur);
  const earnedEur = personalEarnedEur + teamEarnedEur;
  const pipelineEur = pipelinePersonalEur + pipelineTeamEur;
  return { personalEarnedEur, teamEarnedEur, earnedEur, pipelineEur, totalIndicatifEur: earnedEur + pipelineEur };
}
