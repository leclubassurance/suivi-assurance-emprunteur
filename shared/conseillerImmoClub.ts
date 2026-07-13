import type { Referral } from "./apporteurTypes";

export const CONSEILLER_IMMO_CLUB_TYPE = "conseiller_immo_club" as const;

/** Dossiers clients effectivement signés (changement d'assurance) — seuil autonomie. */
export const CONSEILLER_AUTONOMY_SIGNED_THRESHOLD = 10;

/** Cotisation annuelle espace (TTC) à partir du 1er janvier 2027. */
export const CONSEILLER_ANNUAL_PLATFORM_FEE_EUR_TTC = 390;

/** Franchise cotisation plateforme (inclus dans le contrat). */
export const CONSEILLER_PLATFORM_FEE_WAIVER_UNTIL = "2026-12-31";

/** Kit communication conseillers (réseaux sociaux, visuels, modèles). */
export const CONSEILLER_COMMUNICATION_DRIVE_URL =
  "https://drive.google.com/drive/folders/1MNz_To7CuVc7CV9LNv88bKZn8jdkkCWx";

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

/** Segmentation admin : apporteurs d'affaires vs conseillers immo LCIF. */
export type AdminPartnersSegment = "business" | "conseiller_club";

export function matchesAdminPartnersSegment(
  apporteurType: unknown,
  segment: AdminPartnersSegment,
): boolean {
  const isConseiller = isConseillerImmoClubType(apporteurType);
  return segment === "conseiller_club" ? isConseiller : !isConseiller;
}

export function parseAdminPartnersSegment(raw: unknown): AdminPartnersSegment | null {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "business" || s === "apporteurs" || s === "reseau") return "business";
  if (s === "conseiller_club" || s === "conseillers" || s === "conseillers-club") return "conseiller_club";
  return null;
}
