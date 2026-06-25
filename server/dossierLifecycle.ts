import type { Dossier } from "./dossierModel";
import { resolveEffectiveSubscriptionPhase } from "./subscriptionProgress";

const STUDY_SUBJECT_RE =
  /\b(étude|etude)(\s+personnalisée|\s+personnalisee)?\b|économies|economies|votre étude/i;
const CONFIRMATION_RE = /confirmation de réception|accusé de réception|nous avons bien reçu/i;

export function isOutboundConfirmation(subject: string, text?: string) {
  const blob = `${subject} ${String(text || "").slice(0, 300)}`;
  return CONFIRMATION_RE.test(blob);
}

/** Mail d'étude / proposition d'économies déjà envoyé au client (historique réel). */
export function hasStudyBeenSent(dossier: Dossier): boolean {
  const st = String(dossier.status || "");
  if (["MAIL_ENVOYÉ", "MAIL_ENVOYE", "TRAITÉ", "TRAITE", "CLOS"].includes(st)) return true;
  if (dossier.studyDraft?.html || dossier.studyDraft?.subject) return true;

  for (const c of dossier.communications || []) {
    if (c.direction !== "outbound") continue;
    const subject = String(c.subject || "");
    if (isOutboundConfirmation(subject, c.text)) continue;
    if (STUDY_SUBJECT_RE.test(subject)) return true;
    if (/assurance emprunteur/i.test(subject) && /personnalisée|personnalisee|économies|economies/i.test(subject)) {
      return true;
    }
  }

  for (const e of dossier.eventLog || []) {
    if (e.type !== "EMAIL_SENT") continue;
    const blob = `${e.message || ""} ${JSON.stringify(e.meta || {})}`;
    if (/étude|STUDY|personnalisée|personnalisee|économies/i.test(blob)) return true;
  }

  for (const em of dossier.emails || []) {
    if (em.status !== "SENT") continue;
    if (STUDY_SUBJECT_RE.test(String(em.subject || ""))) return true;
  }

  return false;
}

export function getLastStudyOutbound(dossier: Dossier): { subject: string; date: string } | null {
  const out = [...(dossier.communications || [])]
    .filter((c) => c.direction === "outbound")
    .filter((c) => {
      const s = String(c.subject || "");
      return !isOutboundConfirmation(s, c.text) && STUDY_SUBJECT_RE.test(s);
    })
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  if (out[0]) {
    return { subject: String(out[0].subject || "Étude envoyée"), date: String(out[0].date || "") };
  }

  for (const em of dossier.emails || []) {
    if (em.status !== "SENT") continue;
    const subject = String(em.subject || "");
    if (!STUDY_SUBJECT_RE.test(subject)) continue;
    return {
      subject,
      date: String(em.sentAt || em.createdAt || dossier.updatedAt || dossier.createdAt),
    };
  }

  for (const e of [...(dossier.eventLog || [])].reverse()) {
    if (e.type !== "EMAIL_SENT") continue;
    const blob = `${e.message || ""} ${JSON.stringify(e.meta || {})}`;
    if (!/étude|STUDY|personnalisée|personnalisee|économies/i.test(blob)) continue;
    const date = String((e as any).at || (e as any).date || dossier.updatedAt || "");
    if (date) return { subject: "Étude personnalisée envoyée", date };
  }

  if (dossier.studyKpi?.extractedAt) {
    return {
      subject: String(dossier.studyKpi.subject || "Étude personnalisée"),
      date: dossier.studyKpi.extractedAt,
    };
  }

  if (hasStudyBeenSent(dossier)) {
    return { subject: "Étude personnalisée envoyée", date: dossier.updatedAt || dossier.createdAt };
  }
  return null;
}

export function needsStatusStudySent(dossier: Dossier): boolean {
  return hasStudyBeenSent(dossier) && !["MAIL_ENVOYÉ", "MAIL_ENVOYE", "TRAITÉ", "TRAITE", "CLOS"].includes(String(dossier.status));
}

export function getLastClientInbound(dossier: Dossier) {
  const inbound = [...(dossier.communications || [])]
    .filter((c) => c.direction === "inbound")
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  return inbound[0] || null;
}

export function getLastOutbound(dossier: Dossier) {
  const out = [...(dossier.communications || [])]
    .filter((c) => c.direction === "outbound")
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  return out[0] || null;
}

export type ClientPortalStatusKey =
  | "NOUVEAU"
  | "EN_COURS"
  | "EN_ATTENTE_CLIENT"
  | "MAIL_ENVOYÉ"
  | "DECISION_EN_ATTENTE"
  | "ADHESION_EN_COURS"
  | "TRAITÉ";

/** Statut client déduit (étude, décision, parcours Kereis). */
export function resolveClientPortalStatusKey(dossier: Dossier): ClientPortalStatusKey {
  const st = String(dossier.status || "NOUVEAU");
  if (st === "TRAITÉ" || st === "TRAITE" || st === "CLOS") return "TRAITÉ";

  const sub = resolveEffectiveSubscriptionPhase(dossier);
  if (sub === "completed") return "TRAITÉ";
  if (sub === "adhesion_space_sent" || sub === "decision_received") return "ADHESION_EN_COURS";
  if (hasStudyBeenSent(dossier) || sub === "awaiting_decision") return "DECISION_EN_ATTENTE";

  if (st === "MAIL_ENVOYÉ" || st === "MAIL_ENVOYE") return "MAIL_ENVOYÉ";
  if (st === "EN_ATTENTE_CLIENT") return "EN_ATTENTE_CLIENT";
  if (st === "NOUVEAU") return "NOUVEAU";
  return "EN_COURS";
}
