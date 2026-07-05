import { addEvent, scheduleTask, type Dossier } from "./dossierModel";
import { wrapCamilleHtmlReply } from "./camilleMail";
import { resolveLoanDocPresence } from "./loanDocPresence";
import { hasStudyBeenSent } from "./dossierLifecycle";

async function sendGmail(
  accessToken: string | null,
  to: string,
  subject: string,
  body: string,
  options?: { cc?: string[]; dossier?: Dossier },
) {
  const { sendEmailReplyWithGmailAPI } = await import("./mailAutomation");
  return sendEmailReplyWithGmailAPI(accessToken, to, subject, body, options);
}

export type CamilleEscalationState = {
  lastAt: string;
  lastGmailId?: string;
  reason?: string;
  remiNotifiedAt?: string;
  clientNotifiedAt?: string;
  followUpScheduledAt?: string;
};

const DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const DEFAULT_REMINDER_HOURS = 24;

function escalationCooldownMs() {
  const h = Number(process.env.AI_ESCALATION_COOLDOWN_HOURS || "6");
  return Number.isFinite(h) && h > 0 ? h * 60 * 60 * 1000 : DEFAULT_COOLDOWN_MS;
}

function reminderDelayMs() {
  const h = Number(process.env.AI_ESCALATION_REMINDER_HOURS || String(DEFAULT_REMINDER_HOURS));
  return Number.isFinite(h) && h > 0 ? h * 60 * 60 * 1000 : DEFAULT_REMINDER_HOURS * 60 * 60 * 1000;
}

export function getAiEscalationEmail(): string | null {
  const raw = String(process.env.AI_ESCALATION_EMAIL || "remi@leclubimmobilier.fr").trim();
  return raw && raw.includes("@") ? raw : null;
}

export function getEscalationState(dossier: Dossier): CamilleEscalationState | null {
  const s = dossier.camilleEscalation;
  return s && typeof s === "object" ? (s as CamilleEscalationState) : null;
}

function isEscalationCooldownActive(dossier: Dossier, now = Date.now()): boolean {
  const prev = getEscalationState(dossier);
  if (!prev?.lastAt) return false;
  const t = new Date(prev.lastAt).getTime();
  return now - t < escalationCooldownMs();
}

function buildClientHandoffBody(prenom: string, dossier?: Dossier) {
  if (dossier && hasStudyBeenSent(dossier)) {
    return [
      `Merci pour votre message, nous avons bien pris note.`,
      ``,
      `Votre étude personnalisée vous a déjà été communiquée par email.`,
      `Charles, votre conseiller en assurance emprunteur, reviendra vers vous personnellement pour la suite de votre dossier (mise en place du changement d'assurance et prochaines étapes).`,
      ``,
      `Nous vous recontacterons très prochainement par email.`,
    ].join("\n");
  }

  const loan = dossier ? resolveLoanDocPresence(dossier) : null;
  const docLine = loan?.filesPresent
    ? `Charles, votre conseiller en assurance emprunteur, reviendra vers vous personnellement pour finaliser l'analyse de votre dossier et vous présenter les économies possibles.`
    : `Charles, votre conseiller en assurance emprunteur, reviendra vers vous personnellement pour vérifier que nous disposons des bons documents (offre de prêt et tableau d'amortissement complets en PDF depuis votre espace bancaire) afin de poursuivre votre étude.`;
  return [
    `Merci pour votre message, nous avons bien pris note.`,
    ``,
    docLine,
    ``,
    `Nous vous recontacterons très prochainement par email.`,
  ].join("\n");
}

function buildRemiAlertHtml(params: {
  dossierId: string;
  clientEmail: string;
  reason: string;
  excerpt: string;
  reminder?: boolean;
}) {
  const title = params.reminder
    ? "Rappel — escalade Camille non traitée"
    : "Intervention requise — escalade Camille";
  return [
    `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#0f172a">`,
    `<p><strong>${title}</strong></p>`,
    `<p><strong>Dossier :</strong> ${params.dossierId}</p>`,
    `<p><strong>Client :</strong> ${params.clientEmail}</p>`,
    `<p><strong>Raison :</strong> ${params.reason || "Escalade"}</p>`,
    `<p><strong>Action attendue :</strong> vérifier les documents / répondre au client si besoin.</p>`,
    `<p><strong>Extrait du dernier email client :</strong></p>`,
    `<pre style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;padding:12px;border-radius:8px">${params.excerpt}</pre>`,
    `</div>`,
  ].join("");
}

/**
 * Une seule escalade « active » par dossier (cooldown) :
 * - 1 mail client (passage à Charles)
 * - 1 mail Rémi
 * - tâche de rappel INTERNAL_ALERT si pas de reprise
 */
export async function handleCamilleEscalation(params: {
  dossier: Dossier;
  accessToken: string | null;
  clientEmail: string;
  clientPrenom?: string;
  subject: string;
  reason: string;
  clientMessageText: string;
  gmailId: string;
}): Promise<{ notifiedClient: boolean; notifiedRemi: boolean; skippedCooldown: boolean }> {
  const { dossier, accessToken, clientEmail, subject, reason, clientMessageText, gmailId } = params;
  const prenom = String(params.clientPrenom || "").trim();
  const nowIso = new Date().toISOString();

  if (isEscalationCooldownActive(dossier)) {
    addEvent(dossier, {
      type: "AI_DECISION",
      actor: { kind: "AI", label: "Camille" },
      message: "Escalade déjà notifiée récemment — pas de nouvel email.",
      meta: { gmailId, reason, cooldown: true },
    });
    return { notifiedClient: false, notifiedRemi: false, skippedCooldown: true };
  }

  const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
  let notifiedClient = false;
  let notifiedRemi = false;

  const { isTelegramEnabled, sendTelegramEscalationAlert } = await import("./telegramCamille");
  const telegramFirst = isTelegramEnabled();

  if (!telegramFirst) {
    const nom = String(dossier.formData?.assures?.[0]?.nom || "").trim();
    const clientHtml = wrapCamilleHtmlReply(
      buildClientHandoffBody(prenom, dossier),
      prenom,
      nom,
      dossier,
    );
    const clientSend = await sendGmail(accessToken, clientEmail, replySubject, clientHtml, { dossier });
    if (clientSend?.ok) {
      notifiedClient = true;
      addEvent(dossier, {
        type: "EMAIL_SENT",
        actor: { kind: "AI", label: "Camille" },
        message: "Escalade : passage à Charles communiqué au client.",
        meta: { template: "CAMILLE_ESCALATION_CLIENT", to: clientEmail, gmailId },
      });
    } else {
      addEvent(dossier, {
        type: "EMAIL_FAILED",
        actor: { kind: "AI", label: "Camille" },
        message: "Échec envoi mail client (escalade).",
        meta: { template: "CAMILLE_ESCALATION_CLIENT", error: clientSend?.error },
      });
    }
  } else {
    addEvent(dossier, {
      type: "AI_DECISION",
      actor: { kind: "AI", label: "Camille" },
      message: "Escalade : en attente de consigne équipe (Telegram) avant mail client.",
      meta: { telegramFirst: true, gmailId },
    });
  }

  if (telegramFirst) {
    await sendTelegramEscalationAlert({
      dossier,
      clientEmail,
      reason: reason || "Escalade",
      excerpt: String(clientMessageText || "").slice(0, 1500),
      gmailId,
    });
  }

  const remiTo = getAiEscalationEmail();
  if (remiTo) {
    const subjectEsc = `ALERTE Camille — ${dossier.id} (${clientEmail})`;
    const remiSend = await sendGmail(
      null,
      remiTo,
      subjectEsc,
      buildRemiAlertHtml({
        dossierId: dossier.id,
        clientEmail,
        reason: reason || "Escalade",
        excerpt: String(clientMessageText || "").slice(0, 1500),
      }),
    );
    if (remiSend?.ok) {
      notifiedRemi = true;
      const { notifyEscalationSideChannels } = await import("./escalationAlerts");
      void notifyEscalationSideChannels({
        dossierId: dossier.id,
        clientEmail,
        reason: reason || "Escalade",
        excerpt: String(clientMessageText || "").slice(0, 1500),
      });
      addEvent(dossier, {
        type: "EMAIL_SENT",
        actor: { kind: "AI", label: "Camille" },
        message: "Escalade : alerte envoyée à Rémi.",
        meta: { template: "CAMILLE_ESCALATION_REMI", to: remiTo, gmailId },
      });
    }
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

  const followUpAt = new Date(Date.now() + reminderDelayMs()).toISOString();
  scheduleTask(dossier, {
    type: "INTERNAL_ALERT",
    dueAt: followUpAt,
    payload: {
      kind: "ESCALATION_FOLLOWUP",
      escalationAt: nowIso,
      gmailId,
      reason,
    },
  });

  dossier.camilleEscalation = {
    lastAt: nowIso,
    lastGmailId: gmailId,
    reason,
    remiNotifiedAt: notifiedRemi ? nowIso : undefined,
    clientNotifiedAt: notifiedClient ? nowIso : undefined,
    followUpScheduledAt: followUpAt,
  };
  dossier.status = "EN_ATTENTE_CLIENT";

  addEvent(dossier, {
    type: "AI_DECISION",
    actor: { kind: "AI", label: "Camille" },
    message: "Escalade traitée (client + Rémi, rappel programmé).",
    meta: { reason, gmailId, notifiedClient, notifiedRemi },
  });

  return { notifiedClient, notifiedRemi, skippedCooldown: false };
}

export async function sendEscalationReminderToRemi(dossier: Dossier, payload: Record<string, any>) {
  const remiTo = getAiEscalationEmail();
  if (!remiTo) return { ok: false as const, error: "AI_ESCALATION_EMAIL manquant" };

  const clientEmail =
    String(dossier.formData?.assures?.[0]?.email || "").trim() || "client inconnu";
  const reason = String(payload?.reason || getEscalationState(dossier)?.reason || "Escalade");

  const subject = `Rappel — dossier ${dossier.id} (escalade Camille)`;
  const html = buildRemiAlertHtml({
    dossierId: dossier.id,
    clientEmail,
    reason,
    excerpt: String(payload?.excerpt || "—"),
    reminder: true,
  });

  const send = await sendGmail(null, remiTo, subject, html);
  if (send?.ok) {
    const { notifyEscalationSideChannels } = await import("./escalationAlerts");
    const { isTelegramEnabled, sendTelegramEscalationAlert } = await import("./telegramCamille");
    void notifyEscalationSideChannels({
      dossierId: dossier.id,
      clientEmail,
      reason,
      excerpt: String(payload?.excerpt || "—"),
      reminder: true,
    });
    if (isTelegramEnabled()) {
      const esc = getEscalationState(dossier) as CamilleEscalationState & {
        telegramReminderAt?: string;
      };
      const lastTg = esc?.telegramReminderAt
        ? new Date(esc.telegramReminderAt).getTime()
        : 0;
      const minGap = 24 * 60 * 60 * 1000;
      if (!lastTg || Date.now() - lastTg >= minGap) {
        await sendTelegramEscalationAlert({
          dossier,
          clientEmail,
          reason,
          excerpt: String(payload?.excerpt || "—"),
          reminder: true,
          gmailId: String(payload?.gmailId || esc?.lastGmailId || ""),
        });
        if (dossier.camilleEscalation) {
          (dossier.camilleEscalation as any).telegramReminderAt = new Date().toISOString();
        }
      }
    }
    addEvent(dossier, {
      type: "EMAIL_SENT",
      actor: { kind: "SYSTEM" },
      message: "Rappel escalade envoyé à Rémi.",
      meta: { template: "CAMILLE_ESCALATION_REMI_REMINDER", to: remiTo },
    });
    return { ok: true as const };
  }
  return { ok: false as const, error: send?.error || "unknown" };
}
