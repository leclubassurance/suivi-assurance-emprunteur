import type { Dossier } from "./dossierModel";
import { resolveEffectiveSubscriptionPhase } from "./subscriptionProgress";

const STUDY_SUBJECT_RE =
  /\b(étude|etude)(\s+personnalisée|\s+personnalisee)?\b|économies|economies|votre étude/i;
const CONFIRMATION_RE = /confirmation de réception|accusé de réception|nous avons bien reçu/i;

export function isOutboundConfirmation(subject: string, text?: string) {
  const blob = `${subject} ${String(text || "").slice(0, 300)}`;
  return CONFIRMATION_RE.test(blob);
}

/** Étude soumise au conseiller, en attente de validation courtage (pas encore envoyée au client). */
export function isStudyPendingConseillerValidation(dossier: Dossier): boolean {
  return dossier.studyConseillerValidation?.status === "pending";
}

function isStudyLikeOutboundSubject(subject: string, text?: string): boolean {
  const s = String(subject || "");
  if (!s.trim()) return false;
  if (isOutboundConfirmation(s, text)) return false;
  if (STUDY_SUBJECT_RE.test(s)) return true;
  return (
    /assurance emprunteur/i.test(s) &&
    /personnalisée|personnalisee|économies|economies/i.test(s)
  );
}

/** EMAIL_SENT qui prouve un envoi d'étude au client (pas confirmation / copie conseiller / message libre). */
function isClientStudyOutboundEvent(meta: unknown, message?: string): boolean {
  const m = (meta || {}) as Record<string, unknown>;
  const template = String(m.template || "");
  if (
    /CONFIRMATION|STUDY_CONSEILLER|CONSEILLER_STUDY|REMINDER|DOC_|ESCALATION|STAFF|CAMILLE/i.test(
      template,
    )
  ) {
    return false;
  }
  const emailKind = String(m.emailKind || "").toLowerCase();
  if (emailKind === "message") return false;
  if (emailKind === "study") return true;

  const subject = String(m.subject || "");
  if (isStudyLikeOutboundSubject(subject)) return true;
  if (/Étude envoyée au client/i.test(String(message || ""))) return true;
  return false;
}

/** Mail d'étude / proposition d'économies déjà envoyé au client (historique réel). */
export function hasStudyBeenSent(dossier: Dossier): boolean {
  if (isStudyPendingConseillerValidation(dossier)) return false;

  // Ne jamais conclure depuis le seul statut CRM (MAIL_ENVOYÉ / TRAITÉ…) :
  // ce statut peut être posé manuellement ou après un mail non-étude.

  for (const c of dossier.communications || []) {
    if (c.direction !== "outbound") continue;
    if (isStudyLikeOutboundSubject(String(c.subject || ""), c.text)) return true;
  }

  for (const e of dossier.eventLog || []) {
    if (e.type !== "EMAIL_SENT") continue;
    if (!isClientStudyOutboundEvent(e.meta, e.message)) continue;
    return true;
  }

  for (const em of dossier.emails || []) {
    if (em.status !== "SENT") continue;
    if (isStudyLikeOutboundSubject(String(em.subject || ""))) return true;
  }

  return false;
}

export function getLastStudyOutbound(dossier: Dossier): { subject: string; date: string } | null {
  const out = [...(dossier.communications || [])]
    .filter((c) => c.direction === "outbound")
    .filter((c) => isStudyLikeOutboundSubject(String(c.subject || ""), c.text))
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  if (out[0]) {
    return { subject: String(out[0].subject || "Étude envoyée"), date: String(out[0].date || "") };
  }

  for (const em of dossier.emails || []) {
    if (em.status !== "SENT") continue;
    const subject = String(em.subject || "");
    if (!isStudyLikeOutboundSubject(subject)) continue;
    return {
      subject,
      date: String(em.sentAt || em.createdAt || dossier.updatedAt || dossier.createdAt),
    };
  }

  for (const e of [...(dossier.eventLog || [])].reverse()) {
    if (e.type !== "EMAIL_SENT") continue;
    if (!isClientStudyOutboundEvent(e.meta, e.message)) continue;
    const date = String((e as any).at || (e as any).date || dossier.updatedAt || "");
    if (date) {
      const subject = String((e.meta as any)?.subject || "Étude personnalisée envoyée");
      return { subject, date };
    }
  }

  if (dossier.studyKpi?.extractedAt && hasStudyBeenSent(dossier)) {
    return {
      subject: String(dossier.studyKpi.subject || "Étude personnalisée"),
      date: dossier.studyKpi.extractedAt,
    };
  }

  return null;
}

/** Horodatage du dernier envoi réel de l'étude au client (ms epoch). */
export function getStudySentAtMs(dossier: Dossier): number | null {
  const candidates: number[] = [];

  const last = getLastStudyOutbound(dossier);
  if (last?.date) candidates.push(new Date(last.date).getTime());

  for (const c of dossier.communications || []) {
    if (c.direction !== "outbound") continue;
    if (isStudyLikeOutboundSubject(String(c.subject || ""), c.text) && c.date) {
      candidates.push(new Date(c.date).getTime());
    }
  }

  for (const e of dossier.eventLog || []) {
    if (e.type !== "EMAIL_SENT") continue;
    if (!isClientStudyOutboundEvent(e.meta, e.message)) continue;
    const at = String((e as { at?: string; date?: string }).at || (e as { date?: string }).date || "");
    if (at) candidates.push(new Date(at).getTime());
  }

  const valid = candidates.filter((t) => Number.isFinite(t) && t > 0);
  if (!valid.length) return null;
  return Math.max(...valid);
}

export function needsStatusStudySent(dossier: Dossier): boolean {
  return (
    hasStudyBeenSent(dossier) &&
    !isDossierStatusLockedByAdmin(dossier) &&
    !["MAIL_ENVOYÉ", "MAIL_ENVOYE", "TRAITÉ", "TRAITE", "CLOS"].includes(String(dossier.status))
  );
}

/** Statut CRM modifié manuellement par l'admin — ne pas réécraser via synchro Gmail. */
export function isDossierStatusLockedByAdmin(dossier: Dossier): boolean {
  return Boolean(dossier.statusManualAt);
}

/** Met à jour le statut CRM seulement si l'admin ne l'a pas figé manuellement. */
export function setDossierStatusIfNotLocked(dossier: Dossier, status: string): boolean {
  if (isDossierStatusLockedByAdmin(dossier)) return false;
  if (String(dossier.status || "") === status) return false;
  dossier.status = status;
  return true;
}

/** Passe en MAIL ENVOYÉ si une étude a été détectée (sauf statut figé manuellement). */
export function applyStudySentStatusIfNeeded(dossier: Dossier): boolean {
  if (!needsStatusStudySent(dossier)) return false;
  dossier.status = "MAIL_ENVOYÉ";
  return true;
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
  if (hasStudyBeenSent(dossier) || (sub === "awaiting_decision" && hasStudyBeenSent(dossier))) {
    return "DECISION_EN_ATTENTE";
  }

  if (hasStudyBeenSent(dossier)) return "MAIL_ENVOYÉ";
  if (st === "EN_ATTENTE_CLIENT") return "EN_ATTENTE_CLIENT";
  if (st === "NOUVEAU") return "NOUVEAU";
  return "EN_COURS";
}
