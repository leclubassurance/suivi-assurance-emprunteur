import type { Dossier } from "./dossierModel";
import { getStudySentAtMs } from "./dossierLifecycle";

/** Accord explicite du client pour activer le changement d'assurance (souscription). */
export const INSURANCE_CHANGE_ACCEPTANCE_RE =
  /d.accord|je\s+suis\s+d.accord|ok\s+pour|j.?accepte|accepte|changement\s+d.assurance|faire\s+le\s+changement|activer\s+le\s+changement|souhaite\s+activer|oui\s+pour\s+(le\s+)?changement|je\s+confirme|on\s+part\s+l[aà]-dessus/i;

export function textSignalsInsuranceChangeAcceptance(text: string): boolean {
  return INSURANCE_CHANGE_ACCEPTANCE_RE.test(String(text || ""));
}

/** Le client a confirmé vouloir poursuivre le changement d'assurance (pas seulement reçu l'étude). */
export function clientHasAcceptedInsuranceChange(dossier: {
  clientAcceptedInsuranceAt?: string;
  communications?: { direction?: string; subject?: string; text?: string; snippet?: string; date?: string }[];
}): boolean {
  if (dossier.clientAcceptedInsuranceAt) return true;

  const studySentAt = getStudySentAtMs(dossier as Dossier);
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

/** CNI / RIB : uniquement après accord client pour la souscription. */
export function mayRequestIdentityDocuments(dossier: Parameters<typeof clientHasAcceptedInsuranceChange>[0]): boolean {
  return clientHasAcceptedInsuranceChange(dossier);
}
