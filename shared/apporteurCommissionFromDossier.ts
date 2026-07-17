import type { Referral, ReferralStatus } from "./apporteurTypes";
import {
  computeApporteurPayoutEur,
  computeBrokerageFeeEur,
  computeSponsorOverridePayoutEur,
  type RemunerationConfig,
} from "./apporteurRemuneration";

/** Données dossier minimales pour calculer la commission apporteur. */
export type DossierEconomicsSlice = {
  studyKpi?: {
    grossSavingsEur?: number;
    feesCourtageEur?: number;
    source?: string;
  };
  studyDraft?: {
    economySummary?: {
      grossSavingsEur?: number;
      feesCourtageEur?: number;
    };
  };
  formData?: {
    assures?: unknown[];
  };
};

export type CommissionSource = "manual" | "auto" | "estimate" | "pending_validation";

export type DossierCommissionBreakdown = {
  feesCourtageEur: number;
  apporteurPayoutEur: number;
  sponsorOverridePayoutEur: number;
  source: CommissionSource;
  /** True si frais de courtage issus d'une étude (mail ou brouillon), pas du barème par défaut. */
  hasStudyFees: boolean;
};

const CLOSED_UNSIGNED: ReferralStatus[] = ["REFUSE", "PERDU"];

export function countAssuredFromDossier(
  dossier: DossierEconomicsSlice,
  fallback: number,
): number {
  const n = Array.isArray(dossier.formData?.assures) ? dossier.formData.assures.length : 0;
  return n >= 1 ? n : Math.max(1, fallback);
}

/** Résout frais de courtage LCIF + parts apporteur / parrain pour un dossier. */
export function resolveDossierCommission(
  dossier: DossierEconomicsSlice,
  config: RemunerationConfig,
): DossierCommissionBreakdown {
  const assuredCount = countAssuredFromDossier(dossier, config.defaultAssuredPerDossier);
  const kpi = dossier.studyKpi;
  const draftFees = dossier.studyDraft?.economySummary?.feesCourtageEur;

  let feesCourtageEur = 0;
  let source: CommissionSource = "estimate";
  let hasStudyFees = false;

  if (kpi?.feesCourtageEur != null && Number(kpi.feesCourtageEur) > 0) {
    feesCourtageEur = Math.round(Number(kpi.feesCourtageEur));
    source = kpi.source === "manual" ? "manual" : "auto";
    hasStudyFees = true;
  } else if (draftFees != null && Number(draftFees) > 0) {
    feesCourtageEur = Math.round(Number(draftFees));
    source = "auto";
    hasStudyFees = true;
  } else {
    feesCourtageEur = computeBrokerageFeeEur({
      annualSavingsEur: config.defaultAnnualSavingsEur,
      assuredCount,
      config,
    });
    source = "estimate";
  }

  const apporteurPayoutEur = Math.round(feesCourtageEur * config.apporteurShareOfBrokerage);
  const sponsorOverridePayoutEur = Math.round(
    feesCourtageEur * config.sponsorOverrideShareOfBrokerage,
  );

  return {
    feesCourtageEur,
    apporteurPayoutEur,
    sponsorOverridePayoutEur,
    source,
    hasStudyFees,
  };
}

export type PortalEarningsBreakdown = {
  personalEarnedEur: number;
  teamEarnedEur: number;
  earnedEur: number;
  pipelineEur: number;
  totalIndicatifEur: number;
  payoutPerDirect: number;
  payoutPerOverride: number;
  /** Dossiers avec frais réels (mail ou saisie manuelle). */
  studyBasedSignedCount: number;
  estimatedSignedCount: number;
  earningsBasis: "study" | "mixed" | "estimate";
};

function sumReferralPayouts(
  referrals: Pick<Referral, "status" | "dossierId">[],
  dossierById: Map<string, DossierEconomicsSlice>,
  config: RemunerationConfig,
  payoutKey: "apporteurPayoutEur" | "sponsorOverridePayoutEur",
): { signedTotal: number; openTotal: number; studySigned: number; estimatedSigned: number } {
  let signedTotal = 0;
  let openTotal = 0;
  let studySigned = 0;
  let estimatedSigned = 0;

  for (const r of referrals) {
    const dossier = r.dossierId ? dossierById.get(r.dossierId) : undefined;
    const breakdown = resolveDossierCommission(dossier || {}, config);
    const payout =
      payoutKey === "apporteurPayoutEur"
        ? breakdown.apporteurPayoutEur
        : breakdown.sponsorOverridePayoutEur;

    if (r.status === "SIGNE") {
      signedTotal += payout;
      if (breakdown.hasStudyFees) studySigned += 1;
      else estimatedSigned += 1;
    } else if (!CLOSED_UNSIGNED.includes(r.status)) {
      openTotal += payout;
    }
  }

  return { signedTotal, openTotal, studySigned, estimatedSigned };
}

/** Agrège gains réels (signés) + pipeline (en cours × taux conversion) à partir des dossiers liés. */
export function computePortalEarningsFromReferrals(params: {
  personalReferrals: Pick<Referral, "status" | "dossierId">[];
  teamReferrals: Pick<Referral, "status" | "dossierId">[];
  dossierById: Map<string, DossierEconomicsSlice>;
  config: RemunerationConfig;
  conversionRate: number;
  /** Valeurs par défaut affichées si aucun dossier signé. */
  defaultPayoutDirect: number;
  defaultPayoutOverride: number;
}): PortalEarningsBreakdown {
  const rate = Math.max(0, Math.min(1, params.conversionRate));
  const personal = sumReferralPayouts(
    params.personalReferrals,
    params.dossierById,
    params.config,
    "apporteurPayoutEur",
  );
  const team = sumReferralPayouts(
    params.teamReferrals,
    params.dossierById,
    params.config,
    "sponsorOverridePayoutEur",
  );

  const personalEarnedEur = personal.signedTotal;
  const teamEarnedEur = team.signedTotal;
  const pipelineEur = Math.round(personal.openTotal * rate + team.openTotal * rate);
  const earnedEur = personalEarnedEur + teamEarnedEur;
  const studyBasedSignedCount = personal.studySigned + team.studySigned;
  const estimatedSignedCount = personal.estimatedSigned + team.estimatedSigned;
  const signedTotal = studyBasedSignedCount + estimatedSignedCount;

  let earningsBasis: PortalEarningsBreakdown["earningsBasis"] = "estimate";
  if (signedTotal > 0) {
    if (estimatedSignedCount === 0) earningsBasis = "study";
    else if (studyBasedSignedCount > 0) earningsBasis = "mixed";
  }

  const personalSigned = params.personalReferrals.filter((r) => r.status === "SIGNE").length;
  const teamSigned = params.teamReferrals.filter((r) => r.status === "SIGNE").length;

  return {
    personalEarnedEur,
    teamEarnedEur,
    earnedEur,
    pipelineEur,
    totalIndicatifEur: earnedEur + pipelineEur,
    payoutPerDirect:
      personalSigned > 0
        ? Math.round(personalEarnedEur / personalSigned)
        : params.defaultPayoutDirect,
    payoutPerOverride:
      teamSigned > 0 ? Math.round(teamEarnedEur / teamSigned) : params.defaultPayoutOverride,
    studyBasedSignedCount,
    estimatedSignedCount,
    earningsBasis,
  };
}

/** Payout indicatif par signature (simulateur) — inchangé pour le barème par défaut. */
export function defaultPayoutPerSignature(config: RemunerationConfig): number {
  return computeApporteurPayoutEur({
    annualSavingsEur: config.defaultAnnualSavingsEur,
    assuredCount: config.defaultAssuredPerDossier,
    config,
  });
}
