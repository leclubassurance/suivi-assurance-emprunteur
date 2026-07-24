/**
 * Verify conseiller membership unlock: contract → Stripe → admin validate → 1 year.
 * Run: npx tsx scripts/verify-conseiller-membership.ts
 */
import assert from "node:assert/strict";
import {
  addOneCalendarYearIso,
  isApporteurPortalUnlocked,
  isConseillerMembershipRequired,
  resolveConseillerMembershipAccess,
} from "../shared/conseillerMembership";
import type { Apporteur } from "../shared/apporteurTypes";

function base(partial: Partial<Apporteur> = {}): Apporteur {
  return {
    id: "AP-TEST",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    active: true,
    companyName: "Jean Dupont",
    contactName: "Jean Dupont",
    contactPrenom: "Jean",
    contactNom: "Dupont",
    email: "jean.dupont@leclubimmobilier.fr",
    type: "conseiller_immo_club",
    referralToken: "jean-dupont",
    portalToken: "tok",
    contractStatus: "none",
    ...partial,
  };
}

function main() {
  // No Stripe link → unlock after contract only
  assert.equal(isConseillerMembershipRequired(base({ contractStatus: "signed" })), false);
  assert.equal(isApporteurPortalUnlocked(base({ contractStatus: "signed" })), true);
  assert.equal(isApporteurPortalUnlocked(base({ contractStatus: "none" })), false);

  // Stripe link set → still locked after signature until validation
  const withStripe = base({
    contractStatus: "signed",
    stripeCheckoutUrl: "https://buy.stripe.com/test",
    membershipPaymentStatus: "none",
  });
  assert.equal(isConseillerMembershipRequired(withStripe), true);
  const payGate = resolveConseillerMembershipAccess(withStripe);
  assert.equal(payGate.gate, "payment");
  assert.equal(payGate.portalUnlocked, false);

  // Declared payment → pending validation
  const pending = base({
    contractStatus: "signed",
    stripeCheckoutUrl: "https://buy.stripe.com/test",
    membershipPaymentStatus: "pending_validation",
    membershipPaymentDeclaredAt: "2026-07-24T10:00:00.000Z",
  });
  const pendingGate = resolveConseillerMembershipAccess(pending);
  assert.equal(pendingGate.gate, "pending_validation");
  assert.equal(pendingGate.portalUnlocked, false);

  // Admin validated → unlocked for 1 year
  const validatedAt = "2026-07-24T12:00:00.000Z";
  const validUntil = addOneCalendarYearIso(validatedAt);
  assert.equal(validUntil.slice(0, 10), "2027-07-24");
  const validated = base({
    contractStatus: "signed",
    stripeCheckoutUrl: "https://buy.stripe.com/test",
    membershipPaymentStatus: "validated",
    membershipValidatedAt: validatedAt,
    membershipValidUntil: validUntil,
  });
  const openGate = resolveConseillerMembershipAccess(validated, new Date("2026-12-01T00:00:00.000Z"));
  assert.equal(openGate.gate, "open");
  assert.equal(openGate.portalUnlocked, true);

  // After expiry → locked again
  const expiredGate = resolveConseillerMembershipAccess(validated, new Date("2027-07-25T00:00:00.000Z"));
  assert.equal(expiredGate.paymentStatus, "expired");
  assert.equal(expiredGate.gate, "expired");
  assert.equal(expiredGate.portalUnlocked, false);

  // Business apporteur ignores membership fields
  const business = base({
    type: "apporteur_affaires",
    contractStatus: "signed",
    stripeCheckoutUrl: "https://buy.stripe.com/test",
  });
  assert.equal(isConseillerMembershipRequired(business), false);
  assert.equal(isApporteurPortalUnlocked(business), true);

  console.log("verify-conseiller-membership: OK");
}

main();
