/**
 * Réseau Option A — commission directe + override parrain N1.
 * Frais courtage LCIF = 10 % économies (200–500 € / assuré).
 * Membre : 50 % du courtage sur ses dossiers.
 * Parrain : 10 % du courtage sur les dossiers signés de ses filleuls directs.
 */
import type { RemunerationConfig } from "./apporteurRemuneration";
import { getRemunerationConfig, computeBrokerageFeeEur } from "./apporteurRemuneration";

export type NetworkRemunerationConfig = RemunerationConfig & {
  sponsorOverrideShareOfBrokerage: number;
};

export function getNetworkRemunerationConfig(): NetworkRemunerationConfig {
  return {
    ...getRemunerationConfig(),
    sponsorOverrideShareOfBrokerage: 0.1,
    disclaimer:
      "Montants indicatifs TTC : 50 % des frais de courtage sur vos dossiers signés ; 10 % des frais de courtage sur les dossiers signés de vos filleuls directs. Paiement à réception de la commission assureur.",
  };
}

export function computeMemberDirectPayoutEur(params: {
  annualSavingsEur: number;
  assuredCount: number;
  config?: NetworkRemunerationConfig;
}): number {
  const config = params.config || getNetworkRemunerationConfig();
  const brokerage = computeBrokerageFeeEur({
    annualSavingsEur: params.annualSavingsEur,
    assuredCount: params.assuredCount,
    config,
  });
  return Math.round(brokerage * config.apporteurShareOfBrokerage);
}

export function computeSponsorOverridePayoutEur(params: {
  annualSavingsEur: number;
  assuredCount: number;
  config?: NetworkRemunerationConfig;
}): number {
  const config = params.config || getNetworkRemunerationConfig();
  const brokerage = computeBrokerageFeeEur({
    annualSavingsEur: params.annualSavingsEur,
    assuredCount: params.assuredCount,
    config,
  });
  return Math.round(brokerage * config.sponsorOverrideShareOfBrokerage);
}

export function computeNetworkMemberEarnings(params: {
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
  totalEarnedEur: number;
  pipelinePersonalEur: number;
  pipelineTeamEur: number;
  totalPipelineEur: number;
} {
  const personalEarnedEur = params.personalSigned * params.payoutPerDirectEur;
  const teamEarnedEur = params.teamSigned * params.payoutPerOverrideEur;
  const pipelinePersonalEur = Math.round(params.openPersonal * params.conversionRate * params.payoutPerDirectEur);
  const pipelineTeamEur = Math.round(params.openTeam * params.conversionRate * params.payoutPerOverrideEur);
  return {
    personalEarnedEur,
    teamEarnedEur,
    totalEarnedEur: personalEarnedEur + teamEarnedEur,
    pipelinePersonalEur,
    pipelineTeamEur,
    totalPipelineEur: pipelinePersonalEur + pipelineTeamEur,
  };
}
