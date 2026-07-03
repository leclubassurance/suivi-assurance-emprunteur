import type { Referral } from "./apporteurTypes";

export const CONSEILLER_IMMO_CLUB_TYPE = "conseiller_immo_club" as const;

/** Dossiers clients effectivement signés (changement d'assurance) — seuil autonomie. */
export const CONSEILLER_AUTONOMY_SIGNED_THRESHOLD = 10;

/** Cotisation annuelle espace (TTC) à partir du 1er janvier 2027. */
export const CONSEILLER_ANNUAL_PLATFORM_FEE_EUR_TTC = 390;

/** Franchise cotisation plateforme (inclus dans le contrat). */
export const CONSEILLER_PLATFORM_FEE_WAIVER_UNTIL = "2026-12-31";

export type ConseillerOperatingPhase = "assisted" | "autonomous";

export function isConseillerImmoClubType(type: unknown): boolean {
  return String(type || "") === CONSEILLER_IMMO_CLUB_TYPE;
}

export function countSignedClientReferrals(referrals: Referral[] | undefined): number {
  return (referrals || []).filter((r) => r.status === "SIGNE").length;
}

export function resolveConseillerOperatingPhase(signedCount: number): ConseillerOperatingPhase {
  return signedCount >= CONSEILLER_AUTONOMY_SIGNED_THRESHOLD ? "autonomous" : "assisted";
}

export function isLcifStaffEmail(email: unknown): boolean {
  const e = String(email || "").trim().toLowerCase();
  return e.endsWith("@leclubimmobilier.fr");
}
