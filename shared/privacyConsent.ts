/** Versioning et libellé de la case consentement — source unique front + back + Sheets. */

export const PRIVACY_POLICY_LAST_UPDATED = "28 mai 2026";

/** Identifiant stable pour audit (à incrémenter à chaque révision substantielle de la politique). */
export const PRIVACY_POLICY_VERSION = "assurance-emprunteur-2026-05-28";

export const PRIVACY_CONSENT_CHECKBOX_TEXT =
  "J'ai lu la politique de confidentialité et j'accepte que mes données, y compris les pièces jointes, soient traitées pour l'étude de mon dossier d'assurance emprunteur.";

export type ClientPrivacyConsentPayload = {
  accepted: boolean;
  acceptedAt: string;
  policyVersion: string;
  policyLastUpdated: string;
  labelText: string;
};

export function buildClientPrivacyConsentPayload(
  acceptedAt: string = new Date().toISOString(),
): ClientPrivacyConsentPayload {
  return {
    accepted: true,
    acceptedAt,
    policyVersion: PRIVACY_POLICY_VERSION,
    policyLastUpdated: PRIVACY_POLICY_LAST_UPDATED,
    labelText: PRIVACY_CONSENT_CHECKBOX_TEXT,
  };
}
