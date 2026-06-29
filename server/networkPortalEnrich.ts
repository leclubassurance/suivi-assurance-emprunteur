import type { NetworkReferral } from "../shared/networkTypes";
import type { Referral } from "../shared/apporteurTypes";
import { enrichReferralsForApporteurPortal } from "./apporteurPortalEnrich";

export async function enrichReferralsForNetworkPortal(
  referrals: NetworkReferral[],
  publicBaseUrl: string,
) {
  const asApporteurShape: Referral[] = referrals.map((r) => ({
    ...r,
    apporteurId: r.memberId,
    source: r.source === "network_portal" ? "apporteur_portal" : r.source,
  }));
  return enrichReferralsForApporteurPortal(asApporteurShape, publicBaseUrl);
}
