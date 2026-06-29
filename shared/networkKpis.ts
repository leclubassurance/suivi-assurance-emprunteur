import type { NetworkMember, NetworkReferral } from "./networkTypes";
import { computeReferralKpis, type ReferralKpis } from "./apporteurKpis";

export type NetworkMemberKpis = ReferralKpis & {
  teamReferrals: number;
  teamSigned: number;
  teamOpen: number;
  downlineCount: number;
};

export type AdminNetworkKpis = ReferralKpis & {
  members: number;
  activeMembers: number;
  membersWithOpenReferrals: number;
  rootMembers: number;
};

export function computeNetworkMemberKpis(
  personalReferrals: Pick<NetworkReferral, "status" | "createdAt">[],
  teamReferrals: Pick<NetworkReferral, "status" | "createdAt">[],
  downlineCount: number,
): NetworkMemberKpis {
  const personal = computeReferralKpis(personalReferrals);
  const team = computeReferralKpis(teamReferrals);
  return {
    ...personal,
    teamReferrals: team.total,
    teamSigned: team.signed,
    teamOpen: team.open,
    downlineCount,
  };
}

export function computeAdminNetworkKpis(
  members: NetworkMember[],
  referrals: NetworkReferral[],
): AdminNetworkKpis {
  const base = computeReferralKpis(referrals);
  const openIds = new Set(
    referrals.filter((r) => !["SIGNE", "REFUSE", "PERDU"].includes(r.status)).map((r) => r.memberId),
  );
  return {
    ...base,
    members: members.length,
    activeMembers: members.filter((m) => m.active).length,
    membersWithOpenReferrals: openIds.size,
    rootMembers: members.filter((m) => !m.sponsorId).length,
  };
}
