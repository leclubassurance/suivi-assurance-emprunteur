import type { Dossier } from "./dossierModel";
import { isStaffActivelyHandling } from "./camilleStaffHandoff";
import { hasUnansweredClientInbound } from "./gmailConversation";
import { isCamilleTestMode } from "./businessHours";

const inFlightDossierIds = new Set<string>();
const scheduledDocFollowUpTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function getCamilleClientEmailCooldownMs(): number {
  if (isCamilleTestMode()) {
    const minutes = Number(process.env.CAMILLE_TEST_COOLDOWN_MINUTES || "10");
    if (!Number.isFinite(minutes) || minutes <= 0) return 10 * 60 * 1000;
    return minutes * 60 * 1000;
  }
  const hours = Number(process.env.CAMILLE_CLIENT_EMAIL_COOLDOWN_HOURS || "4");
  if (!Number.isFinite(hours) || hours <= 0) return 4 * 3600 * 1000;
  return hours * 3600 * 1000;
}

/** Dernier email Camille → client (hors confirmation Charles). */
export function recentCamilleClientEmailWithinMs(dossier: Dossier | any, withinMs: number): boolean {
  const cutoff = Date.now() - withinMs;

  for (const e of [...(dossier.eventLog || [])].reverse()) {
    if (e.type !== "EMAIL_SENT" && e.type !== "AI_DECISION") continue;
    const at = new Date(e.at || 0).getTime();
    if (!Number.isFinite(at) || at < cutoff) continue;
    const actor = String(e.actor?.label || "");
    const isCamille =
      actor === "Camille" ||
      /camille/i.test(String(e.message || "")) ||
      e.meta?.template === "CAMILLE_DOC_FOLLOWUP";
    if (!isCamille) continue;
    if (e.meta?.template === "CONFIRMATION") continue;
    return true;
  }

  for (const c of dossier.communications || []) {
    if (c.direction !== "outbound") continue;
    const from = String(c.from || "");
    if (!/camille/i.test(from)) continue;
    const t = new Date(c.date || 0).getTime();
    if (Number.isFinite(t) && t >= cutoff) return true;
  }

  return false;
}

export function canCamilleEmailClient(
  dossier: Dossier | any,
  options?: { allowIfUnansweredInbound?: boolean; inboundGmailId?: string },
): { ok: boolean; reason?: string } {
  if (!dossier?.id) return { ok: false, reason: "no_dossier" };
  if (inFlightDossierIds.has(dossier.id)) {
    return { ok: false, reason: "in_flight" };
  }
  const unanswered =
    options?.allowIfUnansweredInbound &&
    hasUnansweredClientInbound(dossier, options.inboundGmailId);
  if (unanswered) return { ok: true };
  if (isStaffActivelyHandling(dossier)) {
    return { ok: false, reason: "staff_handling" };
  }
  const cooldown = getCamilleClientEmailCooldownMs();
  if (recentCamilleClientEmailWithinMs(dossier, cooldown)) {
    if (options?.inboundGmailId) {
      const processed = new Set(
        (dossier.processedGmailIds || []).map((id: string) => String(id)),
      );
      if (!processed.has(String(options.inboundGmailId))) {
        return { ok: true };
      }
    }
    return { ok: false, reason: "cooldown" };
  }
  return { ok: true };
}

export async function acquireCamilleClientEmailLock(dossierId: string): Promise<boolean> {
  if (inFlightDossierIds.has(dossierId)) return false;
  const { tryAcquireDistributedLock } = await import("./camilleDistributedLock");
  if (!(await tryAcquireDistributedLock(`camille_email_${dossierId}`))) return false;
  inFlightDossierIds.add(dossierId);
  return true;
}

export async function releaseCamilleClientEmailLock(dossierId: string): Promise<void> {
  inFlightDossierIds.delete(dossierId);
  const { releaseDistributedLock } = await import("./camilleDistributedLock");
  await releaseDistributedLock(`camille_email_${dossierId}`);
}

export function registerScheduledDocFollowUp(
  dossierId: string,
  timer: ReturnType<typeof setTimeout>,
) {
  cancelScheduledDocFollowUp(dossierId);
  scheduledDocFollowUpTimers.set(dossierId, timer);
}

export function cancelScheduledDocFollowUp(dossierId: string) {
  const existing = scheduledDocFollowUpTimers.get(dossierId);
  if (existing) clearTimeout(existing);
  scheduledDocFollowUpTimers.delete(dossierId);
}
