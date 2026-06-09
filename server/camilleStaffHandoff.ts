import { addEvent, type Dossier } from "./dossierModel";
import { isOutboundConfirmation } from "./dossierLifecycle";

const STUDY_OUTBOUND_SUBJECT_RE =
  /\b(étude|etude)(\s+personnalisée|\s+personnalisee)?\b|économies|economies|votre étude/i;

const STAFF_EMAIL_SUFFIX = "@leclubimmobilier.fr";

export function isStaffMailbox(email: string): boolean {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return false;
  const gmailUser = String(process.env.GMAIL_USER || "assurance@leclubimmobilier.fr").toLowerCase();
  if (e === gmailUser) return true;
  return e.endsWith(STAFF_EMAIL_SUFFIX);
}

/** Dernier message sortant équipe vers le client (hors Camille auto si label fourni). */
export function getRecentStaffOutboundSummary(dossier: Dossier, maxAgeHours = 168): string {
  const cutoff = Date.now() - maxAgeHours * 3600 * 1000;
  const lines: string[] = [];
  for (const c of dossier.communications || []) {
    if (c.direction !== "outbound") continue;
    const t = new Date(c.date || 0).getTime();
    if (!Number.isFinite(t) || t < cutoff) continue;
    const from = String(c.from || "").toLowerCase();
    if (from.includes("camille (ia)")) continue;
    const preview = String(c.text || c.subject || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    lines.push(`${c.date || "?"} — ${preview}`);
  }
  return lines.slice(-3).join("\n") || "Aucun email équipe récent enregistré.";
}

/** Envoi équipe qui ne doit pas couper Camille (étude, accusé réception). */
export function isAutomatedTeamOutboundSubject(subject: string, text?: string): boolean {
  const s = String(subject || "");
  if (isOutboundConfirmation(s, text)) return true;
  if (STUDY_OUTBOUND_SUBJECT_RE.test(s)) return true;
  if (/assurance emprunteur/i.test(s) && /personnalisée|personnalisee|économies|economies/i.test(s)) {
    return true;
  }
  return false;
}

/**
 * Camille en pause uniquement si `camilleStaffHandledUntil` est actif.
 * (Plus de blocage 72h sur tout mail équipe — incompatible avec la prod auto.)
 */
export function isStaffActivelyHandling(dossier: Dossier): boolean {
  const until = dossier.camilleStaffHandledUntil;
  return Boolean(until && new Date(until).getTime() > Date.now());
}

export function resumeCamilleForDossier(dossier: Dossier, source = "admin_resume") {
  delete dossier.camilleStaffHandledUntil;
  addEvent(dossier, {
    type: "AI_DECISION",
    actor: { kind: "ADMIN", label: "Équipe" },
    message: "Camille réactivée sur ce dossier.",
    meta: { source },
  });
}

/**
 * Rémi / équipe a répondu au client : clôturer l'escalade, reprendre le dossier, laisser Camille en soutien léger.
 */
export function acknowledgeStaffOutboundToClient(
  dossier: Dossier,
  meta?: { gmailId?: string; source?: string; subject?: string },
): boolean {
  const gmailId = String(meta?.gmailId || "").trim();
  if (gmailId) {
    const seen = (dossier as any).acknowledgedStaffOutboundGmailIds as string[] | undefined;
    if (Array.isArray(seen) && seen.includes(gmailId)) return false;
  }

  const now = new Date().toISOString();
  const subject = String(meta?.subject || "");
  const skipPause = isAutomatedTeamOutboundSubject(subject);
  let changed = false;

  if (!skipPause) {
    const pauseHours = Number(process.env.CAMILLE_PAUSE_AFTER_STAFF_HOURS || "1");
    const pauseMs =
      Number.isFinite(pauseHours) && pauseHours > 0 ? pauseHours * 3600 * 1000 : 0;
    const nextUntil =
      pauseMs > 0 ? new Date(Date.now() + pauseMs).toISOString() : undefined;
    if (dossier.camilleStaffHandledUntil !== nextUntil) {
      if (nextUntil) dossier.camilleStaffHandledUntil = nextUntil;
      else delete dossier.camilleStaffHandledUntil;
      changed = true;
    }
  } else if (dossier.camilleStaffHandledUntil) {
    delete dossier.camilleStaffHandledUntil;
    changed = true;
  }
  if (dossier.camilleEscalation && !dossier.camilleEscalation.resolvedAt) {
    dossier.camilleEscalation = {
      ...dossier.camilleEscalation,
      resolvedAt: now,
      resolvedBy: meta?.source || "staff_gmail",
    } as any;
    changed = true;
  }

  for (const t of dossier.tasks || []) {
    if (
      t.status === "PENDING" &&
      t.type === "INTERNAL_ALERT" &&
      t.payload?.kind === "ESCALATION_FOLLOWUP"
    ) {
      t.status = "CANCELLED";
      changed = true;
    }
  }

  if (dossier.status === "EN_ATTENTE_CLIENT") {
    dossier.status = "EN_COURS";
    changed = true;
  }

  if (changed) {
    addEvent(dossier, {
      type: "AI_DECISION",
      actor: { kind: "ADMIN", label: "Équipe" },
      message: "Réponse équipe enregistrée — escalade close, dossier repris.",
      meta: { ...meta, camillePausedUntil: dossier.camilleStaffHandledUntil },
    });
    if (gmailId) {
      const list = ((dossier as any).acknowledgedStaffOutboundGmailIds ||= []) as string[];
      if (!list.includes(gmailId)) list.push(gmailId);
      if (list.length > 300) {
        (dossier as any).acknowledgedStaffOutboundGmailIds = list.slice(-300);
      }
    }
  }
  return changed;
}
