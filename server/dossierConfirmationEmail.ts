import type { Dossier } from "./dossierModel";
import { addEvent } from "./dossierModel";
import { LCIF_EMAIL_LOGO_HEADER_IMG } from "../shared/emailBrand";
import {
  buildClientPortalEmailCtaHtml,
  ensureClientPortalToken,
  getClientPortalAbsoluteUrl,
  resolvePublicAppBaseUrl,
} from "./clientPortal";
import { sendEmailReplyWithGmailAPI } from "./mailAutomation";
import { isEmailConfigured, sendEmail } from "./emailProvider";
import { canUseDomainWideDelegation } from "./googleDelegatedAuth";
import { hasServerOAuthRefreshToken } from "./googleOAuthServer";

export type ConfirmationSendChannel =
  | "GMAIL_ADMIN"
  | "GMAIL_REFRESH_TOKEN"
  | "GMAIL_DWD"
  | "SMTP"
  | "SKIPPED";

export function buildDossierConfirmationEmail(dossier: Dossier, portalBaseUrl?: string) {
  const formData = dossier.formData || {};
  const toEmail = String(formData.assures?.[0]?.email || "").trim();
  const ccEmails = Array.isArray(formData.assures)
    ? formData.assures
        .map((a: any) => String(a?.email || "").trim().toLowerCase())
        .filter((e: string) => e && e !== toEmail.toLowerCase())
    : [];
  const clientName = formData.assures?.[0]?.prenom || "Cher client";
  const portalToken = ensureClientPortalToken(dossier);
  const portalUrl = getClientPortalAbsoluteUrl(portalToken, resolvePublicAppBaseUrl(portalBaseUrl));
  const portalCtaHtml = buildClientPortalEmailCtaHtml(portalUrl);
  const subject = `Confirmation de réception - Dossier N° ${dossier.id}`;
  const html = `
<div style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background-color:#F8FAFC;color:#1F2937;line-height:1.6;">
  <div style="max-width:640px;margin:0 auto;background-color:#FFFFFF;border:1px solid #E5E7EB;">
    <div style="background-color:#1E3A8A;padding:24px 20px;text-align:center;">
      ${LCIF_EMAIL_LOGO_HEADER_IMG}
    </div>
    <div style="padding:24px 22px;">
      <p style="font-size:16px;margin:0 0 14px 0;color:#111827;"><strong>Bonjour ${clientName},</strong></p>
      <p style="font-size:14px;margin:0 0 12px 0;color:#374151;">
        Nous avons bien reçu votre dossier d'assurance emprunteur sous le numéro <strong>${dossier.id}</strong>.
      </p>
      <p style="font-size:14px;margin:0 0 18px 0;color:#374151;">
        Notre équipe vous revient sous 48h ouvrées.
      </p>
      ${portalCtaHtml}
      <p style="font-size:14px;margin:18px 0 0 0;color:#111827;">Bien cordialement,<br/>
        <strong>Charles Victor</strong><br/>
        <span style="color:#6B7280;">Le Club Immobilier Français</span>
      </p>
    </div>
    <div style="background-color:#F8FAFC;padding:16px 22px;border-top:1px solid #E5E7EB;">
      <p style="font-size:11px;margin:0;color:#9CA3AF;line-height:1.5;">
        Le Club Immobilier Français — 17 Passage Leroy, 44000 Nantes<br/>
        N° ORIAS : 24002253
      </p>
    </div>
  </div>
</div>`;

  return { toEmail, ccEmails, subject, html, portalUrl, portalCtaHtml };
}

export async function sendDossierConfirmationEmail(
  dossier: Dossier,
  options?: {
    adminAccessToken?: string | null;
    portalBaseUrl?: string;
    log?: (message: string) => void;
  },
): Promise<{ ok: boolean; channel: ConfirmationSendChannel; error?: string }> {
  const log = options?.log || ((msg: string) => console.log(msg));
  const built = buildDossierConfirmationEmail(dossier, options?.portalBaseUrl);
  const { toEmail, ccEmails, subject, html } = built;

  if (!toEmail) {
    return { ok: false, channel: "SKIPPED", error: "Email client manquant" };
  }

  const recordOutcome = (ok: boolean, channel: ConfirmationSendChannel, error?: string) => {
    if (ok) {
      addEvent(dossier, {
        type: "EMAIL_SENT",
        actor: { kind: "SYSTEM" },
        meta: { template: "CONFIRMATION", to: toEmail, cc: ccEmails.join(", "), subject, channel },
      });
      log(`[Email] Mail de confirmation envoyé (${channel}) à ${toEmail} pour ${dossier.id}`);
    } else {
      addEvent(dossier, {
        type: "EMAIL_FAILED",
        actor: { kind: "SYSTEM" },
        meta: {
          template: "CONFIRMATION",
          to: toEmail,
          cc: ccEmails.join(", "),
          subject,
          channel,
          error: error || "unknown",
        },
      });
      log(`[Email Warning] Échec confirmation (${channel}) à ${toEmail}: ${error || "unknown"}`);
    }
    return { ok, channel, error };
  };

  const adminToken = String(options?.adminAccessToken || "").trim();
  const { appendConseillerCcForDossier } = await import("./conseillerEmailCc");
  const ccFinal = await appendConseillerCcForDossier(dossier, ccEmails);
  if (adminToken) {
    const sendResult = await sendEmailReplyWithGmailAPI(adminToken, toEmail, subject, html, { cc: ccFinal, dossier });
    return recordOutcome(Boolean(sendResult?.ok), "GMAIL_ADMIN", sendResult?.error);
  }

  if (hasServerOAuthRefreshToken() || canUseDomainWideDelegation()) {
    const channel: ConfirmationSendChannel = hasServerOAuthRefreshToken()
      ? "GMAIL_REFRESH_TOKEN"
      : "GMAIL_DWD";
    const sendResult = await sendEmailReplyWithGmailAPI(null, toEmail, subject, html, { cc: ccFinal, dossier });
    return recordOutcome(Boolean(sendResult?.ok), channel, sendResult?.error);
  }

  if (isEmailConfigured()) {
    const smtpResult = await sendEmail({ to: toEmail, cc: ccFinal, subject, html });
    if (smtpResult.ok) {
      return recordOutcome(true, "SMTP");
    }
    return recordOutcome(false, "SMTP", smtpResult.ok === false ? smtpResult.error : "unknown");
  }

  log(`[Email Skipped] Aucun canal disponible pour confirmation ${dossier.id}`);
  addEvent(dossier, {
    type: "EMAIL_FAILED",
    actor: { kind: "SYSTEM" },
    meta: {
      template: "CONFIRMATION",
      to: toEmail,
      cc: ccEmails.join(", "),
      subject,
      channel: "SKIPPED",
      error: "Aucun canal email configuré",
    },
  });
  return { ok: false, channel: "SKIPPED", error: "Aucun canal email configuré" };
}
