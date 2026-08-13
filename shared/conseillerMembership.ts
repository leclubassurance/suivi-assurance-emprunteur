import type { Apporteur } from "./apporteurTypes";
import { CONSEILLER_ANNUAL_PLATFORM_FEE_EUR_TTC } from "./conseillerImmoClub";

/** Statut cotisation plateforme (espace assurance conseiller). */
export type ConseillerMembershipPaymentStatus =
  | "none"
  | "pending_validation"
  | "validated"
  | "expired";

export const CONSEILLER_MEMBERSHIP_STATUS_LABELS: Record<
  ConseillerMembershipPaymentStatus,
  string
> = {
  none: "Non requis / non démarré",
  pending_validation: "Paiement en attente de validation",
  validated: "Cotisation validée",
  expired: "Cotisation expirée — renouvellement",
};

export type ConseillerPortalGate =
  | "contract"
  | "payment"
  | "pending_validation"
  | "expired"
  | "open";

export type ConseillerMembershipSnapshot = {
  contractSigned: boolean;
  membershipRequired: boolean;
  paymentStatus: ConseillerMembershipPaymentStatus;
  portalUnlocked: boolean;
  gate: ConseillerPortalGate;
  stripeCheckoutUrl: string | null;
  membershipValidUntil: string | null;
  membershipFeeEur: number;
  membershipValidatedAt: string | null;
  membershipPaymentDeclaredAt: string | null;
};

function trimUrl(raw: unknown): string {
  return String(raw || "").trim();
}

export function normalizeStripeCheckoutUrl(raw: unknown): string | undefined {
  const url = trimUrl(raw);
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("invalid");
    }
    return parsed.toString();
  } catch {
    throw new Error("Le lien Stripe doit être une URL http(s) valide.");
  }
}

/**
 * Cotisation / adhésion requise si un lien Stripe est configuré,
 * ou si un cycle de paiement a déjà démarré (conseillers ou apporteurs).
 */
export function isConseillerMembershipRequired(
  apporteur: Pick<
    Apporteur,
    "type" | "stripeCheckoutUrl" | "membershipPaymentStatus" | "membershipValidUntil"
  >,
): boolean {
  if (trimUrl(apporteur.stripeCheckoutUrl)) return true;
  const status = apporteur.membershipPaymentStatus || "none";
  if (status === "pending_validation" || status === "validated" || status === "expired") {
    return true;
  }
  return Boolean(String(apporteur.membershipValidUntil || "").trim());
}

/** Ajoute un an calendaire (jour pour jour) à partir d'une date. */
export function addOneCalendarYearIso(fromIso: string = new Date().toISOString()): string {
  const d = new Date(fromIso);
  if (Number.isNaN(d.getTime())) {
    return addOneCalendarYearIso(new Date().toISOString());
  }
  const out = new Date(d.getTime());
  out.setUTCFullYear(out.getUTCFullYear() + 1);
  return out.toISOString();
}

export function isMembershipPeriodActive(
  membershipValidUntil: string | undefined | null,
  now: Date = new Date(),
): boolean {
  const until = String(membershipValidUntil || "").trim();
  if (!until) return false;
  const end = new Date(until);
  if (Number.isNaN(end.getTime())) return false;
  return end.getTime() >= now.getTime();
}

export function resolveEffectiveMembershipPaymentStatus(
  apporteur: Pick<Apporteur, "membershipPaymentStatus" | "membershipValidUntil">,
  now: Date = new Date(),
): ConseillerMembershipPaymentStatus {
  const status = (apporteur.membershipPaymentStatus || "none") as ConseillerMembershipPaymentStatus;
  if (status === "validated" && !isMembershipPeriodActive(apporteur.membershipValidUntil, now)) {
    return "expired";
  }
  return status;
}

/**
 * Débloque l'espace partenaire / conseiller uniquement si :
 * - contrat signé, et
 * - soit aucune cotisation n'est requise (pas de lien Stripe),
 * - soit cotisation validée et encore dans la période d'1 an.
 */
export function resolveConseillerMembershipAccess(
  apporteur: Pick<
    Apporteur,
    | "type"
    | "contractStatus"
    | "stripeCheckoutUrl"
    | "membershipPaymentStatus"
    | "membershipValidUntil"
    | "membershipFeeEur"
    | "membershipValidatedAt"
    | "membershipPaymentDeclaredAt"
  >,
  now: Date = new Date(),
): ConseillerMembershipSnapshot {
  const contractSigned = (apporteur.contractStatus || "none") === "signed";
  const membershipRequired = isConseillerMembershipRequired(apporteur);
  const fee =
    typeof apporteur.membershipFeeEur === "number" && Number.isFinite(apporteur.membershipFeeEur)
      ? apporteur.membershipFeeEur
      : CONSEILLER_ANNUAL_PLATFORM_FEE_EUR_TTC;
  const stripeCheckoutUrl = trimUrl(apporteur.stripeCheckoutUrl) || null;
  const membershipValidUntil = String(apporteur.membershipValidUntil || "").trim() || null;

  const base = {
    contractSigned,
    membershipRequired,
    stripeCheckoutUrl,
    membershipValidUntil,
    membershipFeeEur: fee,
    membershipValidatedAt: String(apporteur.membershipValidatedAt || "").trim() || null,
    membershipPaymentDeclaredAt:
      String(apporteur.membershipPaymentDeclaredAt || "").trim() || null,
  };

  if (!contractSigned) {
    return {
      ...base,
      paymentStatus: resolveEffectiveMembershipPaymentStatus(apporteur, now),
      portalUnlocked: false,
      gate: "contract",
    };
  }

  if (!membershipRequired) {
    return {
      ...base,
      paymentStatus: "none",
      portalUnlocked: true,
      gate: "open",
    };
  }

  const paymentStatus = resolveEffectiveMembershipPaymentStatus(apporteur, now);

  if (paymentStatus === "validated" && isMembershipPeriodActive(membershipValidUntil, now)) {
    return {
      ...base,
      paymentStatus,
      portalUnlocked: true,
      gate: "open",
    };
  }

  if (paymentStatus === "pending_validation") {
    return {
      ...base,
      paymentStatus,
      portalUnlocked: false,
      gate: "pending_validation",
    };
  }

  if (paymentStatus === "expired") {
    return {
      ...base,
      paymentStatus,
      portalUnlocked: false,
      gate: "expired",
    };
  }

  return {
    ...base,
    paymentStatus: "none",
    portalUnlocked: false,
    gate: "payment",
  };
}

/** Accès portail : contrat signé + adhésion Stripe validée si un lien est configuré. */
export function isApporteurPortalUnlocked(
  apporteur: Pick<
    Apporteur,
    | "type"
    | "contractStatus"
    | "stripeCheckoutUrl"
    | "membershipPaymentStatus"
    | "membershipValidUntil"
  >,
  now: Date = new Date(),
): boolean {
  return resolveConseillerMembershipAccess(apporteur, now).portalUnlocked;
}
