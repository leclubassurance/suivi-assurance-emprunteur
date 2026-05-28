import { addEvent, type Dossier } from "./dossierModel";

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

export function isStaffActivelyHandling(dossier: Dossier, withinHours = 72): boolean {
  const until = dossier.camilleStaffHandledUntil;
  if (until && new Date(until).getTime() > Date.now()) return true;

  const cutoff = Date.now() - withinHours * 3600 * 1000;
  for (const c of dossier.communications || []) {
    if (c.direction !== "outbound") continue;
    const t = new Date(c.date || 0).getTime();
    if (t < cutoff) continue;
    const from = String(c.from || "").toLowerCase();
    if (from.includes("camille (ia)")) continue;
    if (isStaffMailbox(from) || from.includes("leclub")) return true;
  }
  return false;
}

/**
 * Rémi / équipe a répondu au client : clôturer l'escalade, reprendre le dossier, laisser Camille en soutien léger.
 */
export function acknowledgeStaffOutboundToClient(
  dossier: Dossier,
  meta?: { gmailId?: string; source?: string; subject?: string },
) {
  const now = new Date().toISOString();
  const pauseHours = Number(process.env.CAMILLE_PAUSE_AFTER_STAFF_HOURS || "48");
  const pauseMs =
    Number.isFinite(pauseHours) && pauseHours > 0 ? pauseHours * 3600 * 1000 : 48 * 3600 * 1000;

  dossier.camilleStaffHandledUntil = new Date(Date.now() + pauseMs).toISOString();
  if (dossier.camilleEscalation) {
    dossier.camilleEscalation = {
      ...dossier.camilleEscalation,
      resolvedAt: now,
      resolvedBy: meta?.source || "staff_gmail",
    } as any;
  }

  for (const t of dossier.tasks || []) {
    if (
      t.status === "PENDING" &&
      t.type === "INTERNAL_ALERT" &&
      t.payload?.kind === "ESCALATION_FOLLOWUP"
    ) {
      t.status = "CANCELLED";
    }
  }

  if (dossier.status === "EN_ATTENTE_CLIENT") {
    dossier.status = "EN_COURS";
  }

  addEvent(dossier, {
    type: "AI_DECISION",
    actor: { kind: "ADMIN", label: "Équipe" },
    message: "Réponse équipe enregistrée — escalade close, dossier repris.",
    meta: { ...meta, camillePausedUntil: dossier.camilleStaffHandledUntil },
  });
}
