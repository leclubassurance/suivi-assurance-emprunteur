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

export type ClientEmailKind = "study" | "message";

export async function sendClientStudyEmail(params: {
  dossier: Dossier;
  subject: string;
  html: string;
  to?: string;
  googleToken?: string | null;
  actorLabel?: string;
  actorKind?: "ADMIN" | "SYSTEM";
  /** study = étude économique (KPI, statut, courtage). message = texte libre tel quel. */
  emailKind?: ClientEmailKind;
  /** Forcer ou désactiver la PJ PDF d'étude (défaut: auto si fichier présent et emailKind=study). */
  attachStudyPdf?: boolean;
  /** Répertoire uploads (rematérialisation PDF après redéploiement). */
  uploadsDir?: string;
}): Promise<SendClientStudyEmailResult> {
  const { dossier, subject, html } = params;
  const emailKind: ClientEmailKind = params.emailKind === "message" ? "message" : "study";
  const toEmail = String(params.to || dossier.formData?.assures?.[0]?.email || "").trim();
  if (!toEmail) return { ok: false, error: "Missing recipient email", status: 400 };

  const recipientCheck = validateStudyEmailRecipient(dossier, String(subject || ""));
  if (!recipientCheck.ok) {
    return { ok: false, error: recipientCheck.error || "Destinataire invalide", status: 400 };
  }

  const ccEmails = ((dossier.formData?.assures || []) as any[])
    .map((a: any) => String(a?.email || "").trim())
    .filter((e: string) => e && e.toLowerCase() !== toEmail.toLowerCase());

  let studyAttachments: Array<{ filename: string; mimeType: string; content: Buffer }> = [];
  if (emailKind === "study" && params.attachStudyPdf !== false) {
    try {
      const fs = await import("fs");
      const path = await import("path");
      const { ensureStudyPdfDurable, getStudyPdfPath, hasStudyPdfMeta } = await import("./studyPdfFlow");
      const uploadsDir =
        params.uploadsDir ||
        path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "uploads");
      const expectPdf = hasStudyPdfMeta(dossier);
      const durable = await ensureStudyPdfDurable(dossier, uploadsDir);
      const pdfPath = (durable.ok && durable.localPath) || getStudyPdfPath(dossier);
      if (pdfPath && fs.existsSync(pdfPath)) {
        const fileName =
          String((dossier as any).studyPdf?.fileName || path.basename(pdfPath) || "etude-economies.pdf").trim() ||
          "etude-economies.pdf";
        studyAttachments = [
          {
            filename: fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`,
            mimeType: "application/pdf",
            content: fs.readFileSync(pdfPath),
          },
        ];
      } else if (expectPdf) {
        return {
          ok: false,
          error:
            "Le PDF d'étude est référencé sur ce dossier mais introuvable (disque/Drive). Réimportez le PDF avant d'envoyer le mail.",
          status: 409,
        };
      }
    } catch (attErr: any) {
      console.warn(`[send-study] PJ PDF: ${attErr?.message || attErr}`);
      return {
        ok: false,
        error: `Impossible de joindre le PDF d'étude : ${attErr?.message || attErr}`,
        status: 500,
      };
    }
  }

  let providerId: string | null = null;
  let channel: "gmail" | "smtp" | "simulated" = "simulated";
  const googleToken = params.googleToken ?? null;
  const { sendEmailReplyWithGmailAPI } = await import("./mailAutomation");

  const tryGmail = async (token: string | null) => {
    const gmailResult = await sendEmailReplyWithGmailAPI(token, toEmail, subject, html, {
      cc: ccEmails,
      dossier,
      attachments: studyAttachments,
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
    const result = await sendEmail({
      to: toEmail,
      cc: ccEmails,
      bcc: bccFinal,
      subject,
      html,
      attachments: studyAttachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.mimeType,
      })),
    });
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
    meta: {
      to: toEmail,
      subject,
      providerId,
      channel,
      emailKind,
      studyPdfAttached: studyAttachments.length > 0,
    },
    message:
      emailKind === "message"
        ? `Message libre envoyé au client (${channel}).`
        : studyAttachments.length
          ? `Étude envoyée au client avec PDF joint (${channel}).`
          : `Étude envoyée au client (${channel}).`,
  });
  acknowledgeStaffOutboundToClient(dossier, {
    source: params.actorLabel || "admin_send_email",
    subject,
  });

  if (emailKind === "study") {
    try {
      applyStudyKpiBestAvailable(dossier, {
        subject,
        html,
        text: html,
        gmailId: providerId || `study_send_${dossier.id}_${Date.now()}`,
        date: sentAt,
      });
      const { materializeStudyEconomics } = await import("./materializeStudyEconomics");
      materializeStudyEconomics(dossier);
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
  }

  return { ok: true, providerId, channel };
}
