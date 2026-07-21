import type { Dossier } from "./dossierModel";
import { getStudySentAtMs } from "./dossierLifecycle";

/** Accord explicite du client pour activer le changement d'assurance (souscription). */
export const INSURANCE_CHANGE_ACCEPTANCE_RE =
  /d.accord|je\s+suis\s+d.accord|ok\s+pour|j.?accepte|accepte|changement\s+d.assurance|faire\s+le\s+changement|activer\s+le\s+changement|souhaite\s+activer|oui\s+pour\s+(le\s+)?changement|je\s+confirme|on\s+part\s+l[aà]-dessus/i;

export type ClientAcceptanceSource = "mail" | "admin" | "conseiller" | "system";

export function textSignalsInsuranceChangeAcceptance(text: string): boolean {
  return INSURANCE_CHANGE_ACCEPTANCE_RE.test(String(text || ""));
}

/** Détecte un accord explicite dans les mails reçus après l'étude. */
export function detectInsuranceChangeAcceptanceInComms(dossier: Dossier): boolean {
  const studySentAt = getStudySentAtMs(dossier);
  if (!studySentAt) return false;

  for (const c of dossier.communications || []) {
    if (c.direction !== "inbound") continue;
    const msgTime = c.date ? new Date(c.date).getTime() : 0;
    if (msgTime > 0 && msgTime < studySentAt - 120_000) continue;

    const blob = `${c.subject || ""}\n${c.text || c.snippet || ""}`;
    if (textSignalsInsuranceChangeAcceptance(blob)) return true;
  }
  return false;
}

/** Le client a confirmé vouloir poursuivre le changement d'assurance (pas seulement reçu l'étude). */
export function clientHasAcceptedInsuranceChange(dossier: {
  clientAcceptedInsuranceAt?: string;
  communications?: { direction?: string; subject?: string; text?: string; snippet?: string; date?: string }[];
}): boolean {
  if (dossier.clientAcceptedInsuranceAt) return true;
  return detectInsuranceChangeAcceptanceInComms(dossier as Dossier);
}

/**
 * Persiste l'accord client (mail, admin, conseiller).
 * Retourne true si un nouvel enregistrement a été créé.
 */
export function recordClientInsuranceAcceptance(
  dossier: Dossier,
  meta?: { source?: ClientAcceptanceSource; note?: string; actor?: string; at?: string },
): boolean {
  const now = meta?.at || new Date().toISOString();
  const already = Boolean(dossier.clientAcceptedInsuranceAt);
  if (!already) {
    dossier.clientAcceptedInsuranceAt = now;
    dossier.clientAcceptedInsuranceSource = meta?.source || "admin";
    if (meta?.note?.trim()) {
      dossier.clientAcceptedInsuranceNote = meta.note.trim().slice(0, 500);
    }
    return true;
  }
  if (meta?.note?.trim() && !dossier.clientAcceptedInsuranceNote) {
    dossier.clientAcceptedInsuranceNote = meta.note.trim().slice(0, 500);
  }
  return false;
}

export function clearClientInsuranceAcceptance(dossier: Dossier): boolean {
  const hadValue = Boolean(
    dossier.clientAcceptedInsuranceAt ||
      dossier.clientAcceptedInsuranceSource ||
      dossier.clientAcceptedInsuranceNote,
  );
  delete dossier.clientAcceptedInsuranceAt;
  delete dossier.clientAcceptedInsuranceSource;
  delete dossier.clientAcceptedInsuranceNote;
  return hadValue;
}

/** CNI / RIB : uniquement après accord client pour la souscription. */
export function mayRequestIdentityDocuments(dossier: Parameters<typeof clientHasAcceptedInsuranceChange>[0]): boolean {
  return clientHasAcceptedInsuranceChange(dossier);
}

/** Tente de détecter et persister l'accord depuis les mails (Camille / sync Gmail). */
export function syncClientInsuranceAcceptanceFromMail(dossier: Dossier): boolean {
  if (dossier.clientAcceptedInsuranceAt) return false;
  if (!detectInsuranceChangeAcceptanceInComms(dossier)) return false;
  recordClientInsuranceAcceptance(dossier, {
    source: "mail",
    note: "Accord détecté dans un email client après l'étude.",
  });
  return true;
}
