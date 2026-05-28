import type { Dossier, ReminderTaskType } from "./dossierModel";

const COOLDOWN_DAYS: Partial<Record<string, number>> = {
  FOLLOWUP_MISSING_DOCS: 6,
  FOLLOWUP_NO_REPLY: 8,
  CAMILLE_DOC_FOLLOWUP: 14,
  CAMILLE_AUTO_REPLY: 1,
};

function daysSince(iso?: string) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / (24 * 3600 * 1000);
}

function lastEventMatching(dossier: Dossier, pred: (e: any) => boolean) {
  const events = [...(dossier.eventLog || [])].reverse();
  return events.find(pred);
}

export function getLastClientInboundAt(dossier: Dossier): string | null {
  const comms = [...(dossier.communications || [])].filter((c: any) => c.direction === "inbound");
  if (!comms.length) return null;
  comms.sort((a: any, b: any) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  return comms[0]?.date || null;
}

export function recentCamilleEmailToClient(dossier: Dossier, withinDays = 6): boolean {
  const hit = lastEventMatching(
    dossier,
    (e) =>
      (e.type === "EMAIL_SENT" || e.type === "AI_DECISION") &&
      (e.actor?.label === "Camille" || String(e.message || "").toLowerCase().includes("camille")) &&
      daysSince(e.at) < withinDays,
  );
  return Boolean(hit);
}

export function recentReminderSent(dossier: Dossier, template: string, withinDays: number): boolean {
  const hit = lastEventMatching(
    dossier,
    (e) =>
      (e.type === "EMAIL_SENT" || e.type === "REMINDER_SENT") &&
      (e.meta?.template === template || String(e.message || "").toLowerCase().includes("relance")) &&
      daysSince(e.at) < withinDays,
  );
  return Boolean(hit);
}

export function canScheduleClientReminder(
  dossier: Dossier,
  taskType: ReminderTaskType,
  meta?: { template?: string; stage?: number },
): { ok: boolean; reason?: string } {
  if (dossier.camilleStaffHandledUntil) {
    const until = new Date(dossier.camilleStaffHandledUntil).getTime();
    if (until > Date.now()) {
      return { ok: false, reason: "Prise en charge équipe — relance auto suspendue." };
    }
  }

  const esc = dossier.camilleEscalation;
  if (esc?.lastAt && !esc?.resolvedAt) {
    return { ok: false, reason: "Escalade ouverte — pas de relance auto client." };
  }

  if (taskType === "FOLLOWUP_MISSING_DOCS") {
    const cooldown = COOLDOWN_DAYS.FOLLOWUP_MISSING_DOCS || 6;
    if (recentReminderSent(dossier, "FOLLOWUP_MISSING_DOCS", cooldown)) {
      return { ok: false, reason: `Relance pièces déjà envoyée il y a moins de ${cooldown} j.` };
    }
    if (recentCamilleEmailToClient(dossier, COOLDOWN_DAYS.CAMILLE_AUTO_REPLY || 1)) {
      return { ok: false, reason: "Camille a déjà écrit au client récemment." };
    }
  }

  if (taskType === "FOLLOWUP_NO_REPLY") {
    const cooldown = COOLDOWN_DAYS.FOLLOWUP_NO_REPLY || 8;
    if (recentReminderSent(dossier, "FOLLOWUP_NO_REPLY", cooldown)) {
      return { ok: false, reason: `Relance sans réponse déjà faite (< ${cooldown} j).` };
    }
    const lastIn = getLastClientInboundAt(dossier);
    if (lastIn && daysSince(lastIn) < 3) {
      return { ok: false, reason: "Le client a écrit récemment — pas de relance." };
    }
    if (recentCamilleEmailToClient(dossier, 4)) {
      return { ok: false, reason: "Contact Camille récent — éviter le spam." };
    }
  }

  void meta;
  return { ok: true };
}

export function shouldSendScheduledReminder(dossier: Dossier, taskType: ReminderTaskType): { ok: boolean; reason?: string } {
  return canScheduleClientReminder(dossier, taskType);
}
