import type { ReferralContact, ReferralEvent, ReferralSource, ReferralStatus } from "./apporteurTypes";
export type { ReferralStatus, ReferralContact, ReferralEvent };
export { REFERRAL_STATUS_LABELS, REFERRAL_STATUS_ORDER } from "./apporteurTypes";

export type NetworkMember = {
  id: string;
  createdAt: string;
  updatedAt: string;
  active: boolean;
  contactName: string;
  email: string;
  phone?: string;
  /** Parrain (niveau 1). */
  sponsorId?: string;
  referralToken: string;
  joinToken: string;
  portalToken: string;
  notes?: string;
  notifyEmailEnabled?: boolean;
  contractStatus?: "none" | "pending" | "sent" | "signed" | "expired";
  contractSignedAt?: string;
};

export type NetworkReferral = {
  id: string;
  memberId: string;
  createdAt: string;
  updatedAt: string;
  status: ReferralStatus;
  source: ReferralSource | "network_portal";
  contact: ReferralContact;
  dossierId?: string;
  events: ReferralEvent[];
  lastNotifiedStatus?: ReferralStatus;
  lastNotifiedAt?: string;
  clientInviteSentAt?: string;
};
