import type { Referral, ReferralStatus } from "./apporteurTypes";

/** Segment rémunération club pour un dossier. */
export type ClubRevenueDossierSegment = "pipeline" | "signed" | "settled";

export type ClubRevenueDossierSegmentInput = {
  status?: string;
  subscriptionPhase?: string | null;
  clientAcceptedInsuranceAt?: string;
  clientAccepted?: boolean;
  studySent?: boolean;
  studyKpiExtracted?: boolean;
  referralStatus?: ReferralStatus;
  paymentStatus?: "pending" | "partial" | "received";
  hasEconomics?: boolean;
  feesCourtageEur?: number;
};

const CLOSED_REFERRAL: ReferralStatus[] = ["REFUSE", "PERDU"];

export function normalizeDossierStatus(status: unknown): string {
  return String(status || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/É/g, "E");
}

/** Dossier exclu du graphique (perdu, refusé, sans étude). */
export function isClubRevenueDossierExcluded(input: ClubRevenueDossierSegmentInput): boolean {
  const st = normalizeDossierStatus(input.status);
  if (st === "REFUSE") return true;
  if (input.referralStatus && CLOSED_REFERRAL.includes(input.referralStatus)) return true;
  if (st === "PROSPECT") return true;

  const hasStudy = Boolean(input.studySent || input.studyKpiExtracted);
  const hasEco =
    Boolean(input.hasEconomics) || (Number(input.feesCourtageEur) || 0) > 0;
  if (!hasStudy && !hasEco) return true;

  return false;
}

/**
 * Signé = engagement client ou souscription en cours (quasi assuré).
 * - ADHESION_EN_COURS
 * - accord client (mail ou date)
 * - reco apporteur SIGNE
 * - phases decision_received / adhesion_space_sent / completed
 */
export function isClubRevenueDossierSigned(input: ClubRevenueDossierSegmentInput): boolean {
  if (input.referralStatus === "SIGNE") return true;
  if (input.clientAccepted || input.clientAcceptedInsuranceAt) return true;

  const st = normalizeDossierStatus(input.status);
  if (st === "ADHESION_EN_COURS") return true;
  if (["TRAITE", "CLOS"].includes(st)) return true;

  const phase = String(input.subscriptionPhase || "").trim();
  if (phase === "completed") return true;
  if (phase === "decision_received" || phase === "adhesion_space_sent") return true;

  return false;
}

/**
 * Traité = signé + dossier clos côté souscription ou paiement reçu.
 */
export function isClubRevenueDossierSettled(input: ClubRevenueDossierSegmentInput): boolean {
  if (!isClubRevenueDossierSigned(input)) return false;
  if (input.paymentStatus === "received") return true;

  const st = normalizeDossierStatus(input.status);
  if (["TRAITE", "CLOS"].includes(st)) return true;
  if (input.subscriptionPhase === "completed") return true;

  return false;
}

/**
 * Théorique = étude envoyée, pas encore d'engagement client.
 * MAIL_ENVOYÉ, DECISION_EN_ATTENTE, EN_COURS avec étude…
 */
export function isClubRevenueDossierPipeline(input: ClubRevenueDossierSegmentInput): boolean {
  if (isClubRevenueDossierExcluded(input)) return false;
  if (isClubRevenueDossierSigned(input)) return false;

  const hasStudy = Boolean(input.studySent || input.studyKpiExtracted);
  const hasEco =
    Boolean(input.hasEconomics) || (Number(input.feesCourtageEur) || 0) > 0;
  if (!hasStudy && !hasEco) return false;

  const st = normalizeDossierStatus(input.status);
  if (
    [
      "MAIL_ENVOYE",
      "DECISION_EN_ATTENTE",
      "EN_COURS",
      "EN_ATTENTE_CLIENT",
      "NOUVEAU",
    ].includes(st)
  ) {
    return true;
  }

  return hasStudy;
}

export function resolveClubRevenueDossierSegment(
  input: ClubRevenueDossierSegmentInput,
): ClubRevenueDossierSegment | null {
  if (isClubRevenueDossierExcluded(input)) return null;
  if (isClubRevenueDossierSettled(input)) return "settled";
  if (isClubRevenueDossierSigned(input)) return "signed";
  if (isClubRevenueDossierPipeline(input)) return "pipeline";
  return null;
}

export const CLUB_REVENUE_SEGMENT_RULES = {
  settled: "TRAITÉ / CLOS / phase completed / paiement reçu",
  signed: "ADHESION_EN_COURS, accord client, reco SIGNE, phase adhésion",
  pipeline: "MAIL_ENVOYÉ ou DECISION_EN_ATTENTE sans accord client",
} as const;
