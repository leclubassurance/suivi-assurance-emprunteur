import React from "react";
import ClientLandingPage from "../ClientLandingPage";
import type { LandingReferralProfile } from "../LandingReferralBanner";

/** Landing client publique (site principal + liens ?ref= conseiller / apporteur). */
export default function LandingStep({
  onStart,
  onAdminAccess,
  onLegalMentions,
  onLegalPrivacy,
  referralProfile,
}: {
  onStart: () => void;
  onAdminAccess: () => void;
  onLegalMentions?: () => void;
  onLegalPrivacy?: () => void;
  referralProfile?: LandingReferralProfile | null;
}) {
  return (
    <ClientLandingPage
      onStart={onStart}
      onAdminAccess={onAdminAccess}
      onLegalMentions={onLegalMentions}
      onLegalPrivacy={onLegalPrivacy}
      referralProfile={referralProfile}
    />
  );
}
