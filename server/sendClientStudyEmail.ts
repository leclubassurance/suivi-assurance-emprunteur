import type { Dossier } from "./dossierModel";
import { addEvent } from "./dossierModel";
import { sendEmail, isEmailConfigured } from "./emailProvider";
import { appendConseillerBccForDossier } from "./conseillerEmailCc";
import { validateStudyEmailRecipient } from "./studyEmailRecipient";
import { applyStudyKpiBestAvailable } from "./studyEmailKpi";
import { applyStudySentStatusIfNeeded, hasStudyBeenSent } from "./dossierLifecycle";
import { acknowledgeStaffOutboundToClient } from "./camilleStaffHandoff";
import { hasServerOAuthRefreshToken } from "./googleOAuthServer";
import { canUseDomainWideDelegation } from "./googleDelegatedAuth";

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
  const { sendEmailReplyWithGmailAPI } = await import("./mailAutomation");

  const tryGmail = async (token: string | null) => {
    const gmailResult = await sendEmailReplyWithGmailAPI(token, toEmail, subject, html, {
      cc: ccEmails,
      dossier,
    });
    if (gmailResult.ok) {
      providerId = gmailResult.messageId || null;
      channel = "gmail";
      return true;
    }
    addEvent(dossier, {
      type: "EMAIL_FAILED",
      actor: { kind: params.actorKind || "ADMIN", label: params.actorLabel || "Admin" },
      meta: { to: toEmail, subject, error: gmailResult.error, channel: "gmail" },
    });
    return false;
  };

  if (googleToken) {
    const sent = await tryGmail(googleToken);
    if (!sent) {
      return {
        ok: false,
        error: `Échec Gmail : reconnectez-vous à Google dans l'admin (Déconnexion puis connexion).`,
        status: 500,
      };
    }
  } else if (hasServerOAuthRefreshToken() || canUseDomainWideDelegation()) {
    const sent = await tryGmail(null);
    if (!sent) {
      return {
        ok: false,
        error: "Échec envoi Gmail serveur — vérifiez GOOGLE_OAUTH_REFRESH_TOKEN sur Railway.",
        status: 500,
      };
    }
  } else if (isEmailConfigured()) {
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
    channel = "smtp";
  } else {
    return {
      ok: false,
      error:
        "Email non envoyé : configurez Gmail serveur (GOOGLE_OAUTH_REFRESH_TOKEN) ou SMTP sur Railway.",
      status: 400,
    };
  }

  if (channel === "simulated") {
    return {
      ok: false,
      error:
        "Email non envoyé : configurez Gmail serveur (GOOGLE_OAUTH_REFRESH_TOKEN) ou SMTP sur Railway.",
      status: 400,
    };
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

  try {
    const { maybeNotifyConseillerStudySent } = await import("./conseillerStudyNotify");
    await maybeNotifyConseillerStudySent(dossier, {
      subject,
      excerpt: html.replace(/<[^>]+>/g, " ").slice(0, 1200),
    });
  } catch {
    /* non bloquant */
  }

  return { ok: true, providerId, channel };
}
