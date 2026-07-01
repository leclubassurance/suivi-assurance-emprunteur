import type { Apporteur, Referral } from "./apporteurTypes";
import { computeReferralKpis } from "./apporteurKpis";
import {
  computePortalEarningsFromReferrals,
  type DossierEconomicsSlice,
} from "./apporteurCommissionFromDossier";
import { computeApporteurPayoutEur, getRemunerationConfig } from "./apporteurRemuneration";
import { countryCodeToLabel } from "./referralGeo";

export type ApporteurLeaderboardMetric = "clicks" | "signed" | "earned" | "referrals";

export type ApporteurLeaderboardRow = {
  rank: number;
  apporteurId: string;
  contactName: string;
  companyName: string;
  type: string;
  active: boolean;
  linkClicks: number;
  uniqueSessions: number;
  referralsTotal: number;
  signedCount: number;
  openCount: number;
  earnedEur: number;
  pipelineEur: number;
  conversionRate: number | null;
  topCountries: { code: string; label: string; count: number }[];
};

export function buildApporteurLeaderboard(params: {
  apporteurs: Apporteur[];
  referrals: Referral[];
  dossierById: Map<string, DossierEconomicsSlice>;
  metric?: ApporteurLeaderboardMetric;
  activeOnly?: boolean;
}): ApporteurLeaderboardRow[] {
  const metric = params.metric || "signed";
  const activeOnly = params.activeOnly !== false;

  const rows = params.apporteurs
    .filter((a) => !activeOnly || a.active)
    .map((apporteur) => {
      const personal = params.referrals.filter((r) => r.apporteurId === apporteur.id);
      const kpis = computeReferralKpis(personal);
      const config = getRemunerationConfig(apporteur.type);
      const defaultPayout = computeApporteurPayoutEur({
        annualSavingsEur: config.defaultAnnualSavingsEur,
        assuredCount: config.defaultAssuredPerDossier,
        config,
      });
      const earnings = computePortalEarningsFromReferrals({
        personalReferrals: personal,
        teamReferrals: [],
        dossierById: params.dossierById,
        config,
        conversionRate: kpis.conversionRate ?? config.defaultConversionRate,
        defaultPayoutDirect: defaultPayout,
        defaultPayoutOverride: 0,
      });

      const byCountry = apporteur.referralStats?.clicksByCountry || {};
      const topCountries = Object.entries(byCountry)
        .map(([code, count]) => ({
          code,
          label: countryCodeToLabel(code),
          count: Number(count) || 0,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      return {
        rank: 0,
        apporteurId: apporteur.id,
        contactName: apporteur.contactName,
        companyName: apporteur.companyName,
        type: apporteur.type,
        active: apporteur.active,
        linkClicks: apporteur.referralStats?.linkClicks ?? 0,
        uniqueSessions: apporteur.referralStats?.uniqueSessions ?? 0,
        referralsTotal: kpis.total,
        signedCount: kpis.signed,
        openCount: kpis.open,
        earnedEur: earnings.personalEarnedEur,
        pipelineEur: earnings.pipelineEur,
        conversionRate: kpis.conversionRate,
        topCountries,
      };
    });

  const score = (row: Omit<ApporteurLeaderboardRow, "rank">): number => {
    switch (metric) {
      case "clicks":
        return row.linkClicks;
      case "referrals":
        return row.referralsTotal;
      case "earned":
        return row.earnedEur;
      case "signed":
      default:
        return row.signedCount;
    }
  };

  rows.sort((a, b) => {
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    return b.linkClicks - a.linkClicks;
  });

  return rows.map((row, i) => ({ ...row, rank: i + 1 }));
}

export function findApporteurRank(
  leaderboard: ApporteurLeaderboardRow[],
  apporteurId: string,
): ApporteurLeaderboardRow | null {
  return leaderboard.find((r) => r.apporteurId === apporteurId) || null;
}
