import type { Dossier } from "./dossierModel";
import { addEvent } from "./dossierModel";
import { sendEmail } from "./emailProvider";
import { appendConseillerBccForDossier } from "./conseillerEmailCc";
import { validateStudyEmailRecipient } from "./studyEmailRecipient";
import { applyStudyKpiBestAvailable } from "./studyEmailKpi";
import { applyStudySentStatusIfNeeded, hasStudyBeenSent } from "./dossierLifecycle";
import { acknowledgeStaffOutboundToClient } from "./camilleStaffHandoff";

export type SendClientStudyEmailResult =
  | { ok: true; providerId: string | null; channel: "gmail" | "smtp" | "simulated" }
  | { ok: false; error: string; status?: number };

export async function sendClientStudyEmail(params: {
  dossier: Dossier;
  subject: string;
  html: string;
  to?: string;
  googleToken?: string | null;
  actorLabel?: string;
  actorKind?: "ADMIN" | "SYSTEM";
}): Promise<SendClientStudyEmailResult> {
  const { dossier, subject, html } = params;
  const toEmail = String(params.to || dossier.formData?.assures?.[0]?.email || "").trim();
  if (!toEmail) return { ok: false, error: "Missing recipient email", status: 400 };

  const recipientCheck = validateStudyEmailRecipient(dossier, String(subject || ""));
  if (!recipientCheck.ok) {
    return { ok: false, error: recipientCheck.error || "Destinataire invalide", status: 400 };
  }

  const ccEmails = ((dossier.formData?.assures || []) as any[])
    .map((a: any) => String(a?.email || "").trim())
    .filter((e: string) => e && e.toLowerCase() !== toEmail.toLowerCase());

  let providerId: string | null = null;
  let channel: "gmail" | "smtp" | "simulated" = "simulated";
  const googleToken = params.googleToken ?? null;

  if (googleToken) {
    const { sendEmailReplyWithGmailAPI } = await import("./mailAutomation");
    const gmailResult = await sendEmailReplyWithGmailAPI(googleToken, toEmail, subject, html, {
      cc: ccEmails,
      dossier,
    });
    if (!gmailResult.ok) {
      addEvent(dossier, {
        type: "EMAIL_FAILED",
        actor: { kind: params.actorKind || "ADMIN", label: params.actorLabel || "Admin" },
        meta: { to: toEmail, subject, error: gmailResult.error, channel: "gmail" },
      });
      return {
        ok: false,
        error: `Échec Gmail : ${gmailResult.error}. Reconnectez-vous à Google (Déconnexion puis connexion).`,
        status: 500,
      };
    }
    providerId = gmailResult.messageId || null;
    channel = "gmail";
  } else {
    const bccFinal = await appendConseillerBccForDossier(dossier);
    const result = await sendEmail({ to: toEmail, cc: ccEmails, bcc: bccFinal, subject, html });
    if ("error" in result) {
      addEvent(dossier, {
        type: "EMAIL_FAILED",
        actor: { kind: params.actorKind || "ADMIN", label: params.actorLabel || "Admin" },
        meta: { to: toEmail, subject, error: (result as any).error },
      });
      return { ok: false, error: (result as any).error, status: 500 };
    }
    providerId = (result as any).providerId || null;
    channel = providerId === "SIMULATED" ? "simulated" : "smtp";
    if (channel === "simulated") {
      return {
        ok: false,
        error:
          "Email non envoyé : connectez-vous avec Google dans l'admin (Gmail) ou configurez SMTP sur Railway.",
        status: 400,
      };
    }
  }

  const sentAt = new Date().toISOString();
  if (!dossier.communications) dossier.communications = [];
  dossier.communications.push({
    id: `msg_out_${Date.now()}`,
    direction: "outbound",
    to: toEmail,
    subject,
    text: html,
    html,
    gmailId: providerId || undefined,
    date: sentAt,
  });

  addEvent(dossier, {
    type: "EMAIL_SENT",
    actor: { kind: params.actorKind || "ADMIN", label: params.actorLabel || "Admin" },
    meta: { to: toEmail, subject, providerId, channel },
    message: `Email envoyé au client (${channel}).`,
  });
  acknowledgeStaffOutboundToClient(dossier, {
    source: params.actorLabel || "admin_send_email",
    subject,
  });

  try {
    applyStudyKpiBestAvailable(dossier, {
      subject,
      html,
      text: html,
      gmailId: providerId || `study_send_${dossier.id}_${Date.now()}`,
      date: sentAt,
    });
    if (hasStudyBeenSent(dossier)) {
      dossier.status = "MAIL_ENVOYÉ";
    } else {
      applyStudySentStatusIfNeeded(dossier);
    }
  } catch (kpiErr: any) {
    console.warn(`[KPI] Extraction étude à l'envoi: ${kpiErr?.message || kpiErr}`);
  }

  try {
    const { syncReferralFromDossier } = await import("./apporteurStore");
    const { syncNetworkReferralFromDossier } = await import("./networkStore");
    await syncNetworkReferralFromDossier(dossier, params.actorLabel || "send_study");
    await syncReferralFromDossier(dossier, params.actorLabel || "send_study");
  } catch {
    /* non bloquant */
  }

  return { ok: true, providerId, channel };
}
