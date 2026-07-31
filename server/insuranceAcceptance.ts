import type { Dossier } from "./dossierModel";
import { getStudySentAtMs } from "./dossierLifecycle";

/**
 * Signaux de REFUS — prioritaires sur tout motif d'accord.
 * Évite les faux positifs du type « je n'accepte pas » / citation d'un mail LCIF.
 */
export const INSURANCE_CHANGE_REFUSAL_RE =
  /ne\s+(souhaite|souhaitons|veux|veut|voulons)\s+(toutefois\s+)?pas|pas\s+donner\s+suite|donner\s+suite\s+[àa]\s+votre\s+proposition|conserver\s+(notre|mon|l['']?)\s*assureur|n['’]accepte\s+pas|pas\s+d['’]accord|je\s+refuse|nous\s+refusons|sans\s+suite|d[eé]cline|ne\s+donnerai\s+pas\s+suite|pr[eé]f[eè]re(?:nt)?\s+finalement\s+conserver/i;

/**
 * Accord explicite uniquement — pas de motif trop large (« accepte », « changement d'assurance »)
 * qui matchent les citations de nos propres mails.
 */
export const INSURANCE_CHANGE_ACCEPTANCE_RE =
  /(?:^|[^\wàâäéèêëïîôùûüç])(?:je\s+suis\s+d['’]accord|nous\s+sommes\s+d['’]accord|ok\s+pour\s+(?:le\s+)?changement|j['’]accepte(?:\s+(?:votre|la|le|cette|pour))?(?:\s+(?:proposition|offre|changement))?|accepte(?:\s+(?:votre|la|le|cette))?\s+(?:proposition|offre|changement)|faire\s+le\s+changement|activer\s+le\s+changement|souhaite(?:nt)?\s+(?:activer|proc[eé]der|avancer)|oui\s+pour\s+(?:le\s+)?changement|je\s+confirme\s+(?:le\s+)?changement|nous\s+confirmons\s+(?:le\s+)?changement|on\s+part\s+l[aà]-dessus|go\s+pour\s+(?:le\s+)?changement)(?:$|[^\wàâäéèêëïîôùûüç])/i;

export type ClientAcceptanceSource = "mail" | "admin" | "conseiller" | "system";

/** Isole le message client en retirant la citation du mail LCIF. */
export function extractClientAuthoredEmailText(raw: string): string {
  let text = String(raw || "").replace(/\r\n/g, "\n");
  if (!text.trim()) return "";

  const cutMarkers = [
    /\n[-–_]{2,}\s*\n/,
    /\nOn\s.+wrote:\s*\n/i,
    /\nLe\s.+a\s+[eé]crit\s*:\s*\n/i,
    /\nFrom:\s*.+\nSent:/i,
    /\nDe\s*:\s*.+\nEnvoy[eé]\s*:/i,
    /\n_{5,}\s*\n/,
  ];
  for (const re of cutMarkers) {
    const idx = text.search(re);
    if (idx > 40) {
      text = text.slice(0, idx);
      break;
    }
  }

  const lines = text.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) continue;
    if (/^\s*\|/.test(line) && kept.length > 3) continue;
    kept.push(line);
  }
  return kept.join("\n").trim();
}

export function textSignalsInsuranceChangeRefusal(text: string): boolean {
  return INSURANCE_CHANGE_REFUSAL_RE.test(String(text || ""));
}

export function textSignalsInsuranceChangeAcceptance(text: string): boolean {
  const authored = extractClientAuthoredEmailText(text);
  if (!authored) return false;
  if (textSignalsInsuranceChangeRefusal(authored)) return false;
  return INSURANCE_CHANGE_ACCEPTANCE_RE.test(authored);
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
    try {
      const { cancelConseillerDecisionFollowUps } = require("./conseillerDecisionFollowUp") as typeof import("./conseillerDecisionFollowUp");
      cancelConseillerDecisionFollowUps(dossier, "Accord client enregistré.");
    } catch {
      /* ignore circular / load */
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
