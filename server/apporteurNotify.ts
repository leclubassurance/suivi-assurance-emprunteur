import crypto from "crypto";
import type { Apporteur, Referral, ReferralStatus } from "../shared/apporteurTypes";
import { APPORTEUR_TYPE_LABELS, REFERRAL_STATUS_LABELS } from "../shared/apporteurTypes";
import { LCIF_EMAIL_LOGO_HEADER_IMG } from "../shared/emailBrand";
import { resolvePublicAppBaseUrl } from "./clientPortal";
import { sendEmail } from "./emailProvider";
import { sendEmailReplyWithGmailAPI } from "./mailAutomation";
import { hasServerOAuthRefreshToken, getServerAccessToken } from "./googleOAuthServer";

export function generatePortalToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

export function buildApporteurPortalPath(portalToken: string): string {
  return `/apporteur/${encodeURIComponent(portalToken)}`;
}

export function buildApporteurPortalUrl(baseUrl: string, portalToken: string): string {
  const base = String(baseUrl || "").replace(/\/$/, "");
  return `${base}${buildApporteurPortalPath(portalToken)}`;
}

function referralContactLabel(referral: Referral): string {
  const name = [referral.contact.prenom, referral.contact.nom].filter(Boolean).join(" ").trim();
  if (name) return name;
  if (referral.contact.email) return referral.contact.email;
  if (referral.contact.phone) return referral.contact.phone;
  return "Votre contact recommandé";
}

function statusMessage(status: ReferralStatus): string {
  switch (status) {
    case "NOUVEAU":
      return "Nous avons bien enregistré votre recommandation. Notre équipe va prendre contact.";
    case "CONTACTE":
      return "Nous avons contacté votre recommandation.";
    case "DOSSIER_OUVERT":
      return "Un dossier d'étude a été ouvert pour ce contact.";
    case "ETUDE_ENVOYEE":
      return "L'étude personnalisée a été envoyée au client.";
    case "SIGNE":
      return "Le changement d'assurance emprunteur a été finalisé.";
    case "REFUSE":
      return "Le contact a décliné ou le dossier a été refusé.";
    case "PERDU":
      return "Le dossier n'a pas abouti.";
    default:
      return REFERRAL_STATUS_LABELS[status] || status;
  }
}

export function buildApporteurReferralStatusEmail(params: {
  apporteur: Apporteur;
  referral: Referral;
  status: ReferralStatus;
  portalUrl?: string;
}): { subject: string; html: string } {
  const contact = referralContactLabel(params.referral);
  const statusLabel = REFERRAL_STATUS_LABELS[params.status] || params.status;
  const body = statusMessage(params.status);
  const portalBlock = params.portalUrl
    ? `<p style="margin:18px 0 0 0;"><a href="${params.portalUrl}" style="display:inline-block;background:#1E3A8A;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;font-size:14px;">Voir mon espace apporteur</a></p>`
    : "";

  const html = `
<div style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#F8FAFC;color:#1F2937;line-height:1.6;">
  <div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E5E7EB;">
    <div style="background-color:#1E3A8A;padding:24px 20px;text-align:center;">
      ${LCIF_EMAIL_LOGO_HEADER_IMG}
    </div>
    <div style="padding:24px 22px;">
      <p style="font-size:16px;margin:0 0 14px 0;color:#111827;"><strong>Bonjour ${params.apporteur.contactName || params.apporteur.companyName},</strong></p>
      <p style="font-size:14px;margin:0 0 12px 0;color:#374151;">
        Mise à jour concernant votre recommandation <strong>${contact}</strong> :
      </p>
      <p style="font-size:14px;margin:0 0 8px 0;padding:12px 16px;background:#EFF6FF;border-radius:8px;color:#1E3A8A;">
        <strong>${statusLabel}</strong> — ${body}
      </p>
      ${portalBlock}
      <p style="font-size:13px;margin:20px 0 0 0;color:#6B7280;">
        Vous recevez cet email car vous collaborez avec Le Club Immobilier Français en tant qu'apporteur d'affaires.
      </p>
      <p style="font-size:14px;margin:18px 0 0 0;color:#111827;">Bien cordialement,<br/>
        <strong>L'équipe Le Club Immobilier Français</strong>
      </p>
    </div>
    <div style="background:#F8FAFC;padding:16px 22px;border-top:1px solid #E5E7EB;">
      <p style="font-size:11px;margin:0;color:#9CA3AF;">Le Club Immobilier Français — ORIAS 24002253</p>
    </div>
  </div>
</div>`;

  return {
    subject: `[LCIF] Recommandation — ${statusLabel} (${contact})`,
    html,
  };
}

export function buildApporteurPortalInviteEmail(params: {
  apporteur: Apporteur;
  portalUrl: string;
  referralLink: string;
}): { subject: string; html: string } {
  const html = `
<div style="margin:0;padding:0;font-family:Arial,sans-serif;background:#F8FAFC;color:#1F2937;line-height:1.6;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;">
    <div style="background:#1E3A8A;padding:24px;text-align:center;">${LCIF_EMAIL_LOGO_HEADER_IMG}</div>
    <div style="padding:24px 22px;">
      <p style="font-size:16px;margin:0 0 12px 0;"><strong>Bonjour ${params.apporteur.contactName},</strong></p>
      <p style="font-size:14px;margin:0 0 16px 0;">Votre espace apporteur Le Club Immobilier Français est prêt.</p>
      <p style="font-size:14px;margin:0 0 8px 0;"><strong>1. Suivre vos recommandations</strong></p>
      <p style="margin:0 0 16px 0;"><a href="${params.portalUrl}" style="color:#1E3A8A;font-weight:bold;">${params.portalUrl}</a></p>
      <p style="font-size:14px;margin:0 0 8px 0;"><strong>2. Lien à partager à vos clients</strong> (formulaire en ligne)</p>
      <p style="margin:0 0 16px 0;"><a href="${params.referralLink}" style="color:#1E3A8A;">${params.referralLink}</a></p>
      <p style="font-size:13px;color:#6B7280;">Conservez ce lien privé — il donne accès à vos recommandations uniquement.</p>
    </div>
  </div>
</div>`;
  return { subject: "Votre espace apporteur — Le Club Immobilier Français", html };
}

export function buildApporteurContractSigningInviteEmail(params: {
  apporteur: Apporteur;
  portalUrl: string;
}): { subject: string; html: string } {
  const html = `
<div style="margin:0;padding:0;font-family:Arial,sans-serif;background:#F8FAFC;color:#1F2937;line-height:1.6;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;">
    <div style="background:#1E3A8A;padding:24px;text-align:center;">${LCIF_EMAIL_LOGO_HEADER_IMG}</div>
    <div style="padding:24px 22px;">
      <p style="font-size:16px;margin:0 0 12px 0;"><strong>Bonjour ${params.apporteur.contactName},</strong></p>
      <p style="font-size:14px;margin:0 0 16px 0;">
        Votre candidature partenaire Le Club Immobilier Français est validée. Il ne reste plus qu'à
        <strong>signer votre contrat d'apporteur en ligne</strong> pour débloquer votre espace.
      </p>
      <p style="margin:0 0 20px 0;text-align:center;">
        <a href="${params.portalUrl}" style="display:inline-block;background:#1E3A8A;color:#fff;text-decoration:none;padding:14px 24px;border-radius:8px;font-weight:bold;font-size:15px;">
          Signer mon contrat et accéder à mon espace
        </a>
      </p>
      <p style="font-size:13px;color:#6B7280;margin:0;">
        Lien direct : <a href="${params.portalUrl}" style="color:#1E3A8A;">${params.portalUrl}</a><br/>
        La signature prend environ 2 minutes. Conservez ce lien privé.
      </p>
    </div>
  </div>
</div>`;
  return { subject: "Signez votre contrat partenaire — Le Club Immobilier Français", html };
}

async function sendApporteurHtmlEmail(
  to: string,
  subject: string,
  html: string,
  attachments?: Array<{ filename: string; content: Buffer; mimeType?: string }>,
): Promise<boolean> {
  if (!to.includes("@")) return false;
  try {
    if (hasServerOAuthRefreshToken()) {
      const token = await getServerAccessToken();
      const res = await sendEmailReplyWithGmailAPI(token, to, subject, html, {
        attachments: (attachments || []).map((a) => ({
          filename: a.filename,
          mimeType: a.mimeType || "application/octet-stream",
          content: a.content,
        })),
      });
      return res.ok;
    }
    const smtp = await sendEmail({
      to,
      subject,
      html,
      attachments: (attachments || []).map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.mimeType || "application/octet-stream",
      })),
    });
    return smtp.ok && smtp.providerId !== "SIMULATED";
  } catch (err: any) {
    console.warn(`[Apporteur] Email ${to}:`, err?.message || err);
    return false;
  }
}

export async function sendApporteurContractOtpEmail(email: string, code: string): Promise<boolean> {
  const { buildApporteurContractOtpEmailHtml } = await import("./apporteurContractOtp");
  return sendApporteurHtmlEmail(
    email,
    "Code de signature — contrat partenaire LCIF",
    buildApporteurContractOtpEmailHtml(code),
  );
}

export async function notifyApporteurReferralStatusChange(params: {
  apporteur: Apporteur;
  referral: Referral;
  previousStatus?: ReferralStatus;
  portalBaseUrl?: string;
}): Promise<boolean> {
  if (params.apporteur.notifyEmailEnabled === false) return false;
  if (!params.apporteur.email) return false;
  if (params.referral.lastNotifiedStatus === params.referral.status) return false;
  if (params.previousStatus === params.referral.status) return false;

  const portalUrl = params.apporteur.portalToken
    ? buildApporteurPortalUrl(resolvePublicAppBaseUrl(params.portalBaseUrl), params.apporteur.portalToken)
    : undefined;

  const { subject, html } = buildApporteurReferralStatusEmail({
    apporteur: params.apporteur,
    referral: params.referral,
    status: params.referral.status,
    portalUrl,
  });

  const sent = await sendApporteurHtmlEmail(params.apporteur.email, subject, html);
  if (sent) {
    params.referral.lastNotifiedStatus = params.referral.status;
    params.referral.lastNotifiedAt = new Date().toISOString();
  }
  return sent;
}

export async function sendApporteurPortalInvite(
  apporteur: Apporteur,
  portalBaseUrl?: string,
): Promise<boolean> {
  if (!apporteur.portalToken || !apporteur.email) return false;
  if ((apporteur.contractStatus || "none") !== "signed") {
    return sendApporteurContractSigningInvite(apporteur, portalBaseUrl);
  }
  const base = resolvePublicAppBaseUrl(portalBaseUrl);
  const portalUrl = buildApporteurPortalUrl(base, apporteur.portalToken);
  const referralLink = `${base.replace(/\/$/, "")}/?ref=${encodeURIComponent(apporteur.referralToken)}`;
  const { subject, html } = buildApporteurPortalInviteEmail({ apporteur, portalUrl, referralLink });
  return sendApporteurHtmlEmail(apporteur.email, subject, html);
}

export async function sendApporteurContractSigningInvite(
  apporteur: Apporteur,
  portalBaseUrl?: string,
): Promise<boolean> {
  if (!apporteur.portalToken || !apporteur.email) return false;
  const base = resolvePublicAppBaseUrl(portalBaseUrl);
  const portalUrl = buildApporteurPortalUrl(base, apporteur.portalToken);
  const { subject, html } = buildApporteurContractSigningInviteEmail({ apporteur, portalUrl });
  return sendApporteurHtmlEmail(apporteur.email, subject, html);
}

export function buildApporteurContractSignedEmail(params: {
  apporteur: Apporteur;
  portalUrl: string;
}): { subject: string; html: string } {
  const html = `
<div style="margin:0;padding:0;font-family:Arial,sans-serif;background:#F8FAFC;color:#1F2937;line-height:1.6;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;">
    <div style="background:#1E3A8A;padding:24px;text-align:center;">${LCIF_EMAIL_LOGO_HEADER_IMG}</div>
    <div style="padding:24px 22px;">
      <p style="font-size:16px;margin:0 0 12px 0;"><strong>Bonjour ${params.apporteur.contactName},</strong></p>
      <p style="font-size:14px;margin:0 0 16px 0;">
        Votre contrat d'apporteur d'affaires Le Club Immobilier Français est signé.
        Vous trouverez en <strong>pièce jointe</strong> une copie PDF pour vos archives.
      </p>
      <p style="margin:0 0 16px 0;text-align:center;">
        <a href="${params.portalUrl}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:14px 24px;border-radius:8px;font-weight:bold;font-size:15px;">
          Accéder à mon espace partenaire
        </a>
      </p>
      <p style="font-size:13px;color:#6B7280;margin:16px 0 0 0;">
        Vous pouvez aussi retélécharger le PDF depuis votre espace à tout moment.
      </p>
    </div>
  </div>
</div>`;
  return { subject: "Votre contrat partenaire signé — copie PDF", html };
}

export async function sendApporteurContractSignedEmail(
  apporteur: Apporteur,
  pdfBuffer: Buffer,
  pdfFilename: string,
  portalBaseUrl?: string,
): Promise<boolean> {
  if (!apporteur.email || !pdfBuffer.length) return false;
  const base = resolvePublicAppBaseUrl(portalBaseUrl);
  const portalUrl = apporteur.portalToken
    ? buildApporteurPortalUrl(base, apporteur.portalToken)
    : base;
  const { subject, html } = buildApporteurContractSignedEmail({
    apporteur,
    portalUrl,
  });
  return sendApporteurHtmlEmail(apporteur.email, subject, html, [
    { filename: pdfFilename, content: pdfBuffer, mimeType: "application/pdf" },
  ]);
}

function apporteurRecommendationLabel(apporteur: Apporteur): string {
  const name = [apporteur.contactName, apporteur.companyName].filter(Boolean).join(" — ");
  const typeLabel = APPORTEUR_TYPE_LABELS[apporteur.type] || "partenaire";
  return `${name} (${typeLabel})`;
}

export function buildReferredClientInviteEmail(params: {
  apporteur: Apporteur;
  referral: Referral;
  formUrl: string;
}): { subject: string; html: string } {
  const prenom = String(params.referral.contact.prenom || "").trim() || "Bonjour";
  const greeting = params.referral.contact.prenom ? `Bonjour ${params.referral.contact.prenom},` : "Bonjour,";
  const partnerName = String(params.apporteur.contactName || "").trim() || "votre contact";

  const html = `
<div style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#F8FAFC;color:#1F2937;line-height:1.6;">
  <div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E5E7EB;">
    <div style="background-color:#1E3A8A;padding:24px 20px;text-align:center;">
      ${LCIF_EMAIL_LOGO_HEADER_IMG}
    </div>
    <div style="padding:24px 22px;">
      <p style="font-size:16px;margin:0 0 14px 0;color:#111827;"><strong>${greeting}</strong></p>
      <p style="font-size:14px;margin:0 0 12px 0;color:#374151;">
        <strong>${partnerName}</strong> vous oriente vers le <strong>Club Immobilier Français</strong>
        pour une <strong>étude gratuite des économies</strong> sur votre assurance emprunteur.
      </p>
      <p style="font-size:14px;margin:0 0 16px 0;color:#374151;">
        En quelques minutes, déposez votre dossier en ligne : nous analysons votre contrat actuel
        et vous proposons une étude personnalisée si des économies sont possibles.
      </p>
      <p style="margin:0 0 20px 0;text-align:center;">
        <a href="${params.formUrl}" style="display:inline-block;background:#1E3A8A;color:#fff;text-decoration:none;padding:14px 24px;border-radius:10px;font-weight:bold;font-size:15px;">
          Démarrer mon étude d'économies
        </a>
      </p>
      <p style="font-size:12px;margin:0 0 8px 0;color:#6B7280;word-break:break-all;">
        Ou copiez ce lien : <a href="${params.formUrl}" style="color:#1E3A8A;">${params.formUrl}</a>
      </p>
      <p style="font-size:13px;margin:18px 0 0 0;color:#6B7280;">
        Une question ? Répondez à ce mail ou écrivez-nous à
        <a href="mailto:assurance@leclubimmobilier.fr" style="color:#1E3A8A;">assurance@leclubimmobilier.fr</a>.
      </p>
      <p style="font-size:14px;margin:18px 0 0 0;color:#111827;">Bien cordialement,<br/>
        <strong>L'équipe Le Club Immobilier Français</strong>
      </p>
    </div>
    <div style="background:#F8FAFC;padding:16px 22px;border-top:1px solid #E5E7EB;">
      <p style="font-size:11px;margin:0;color:#9CA3AF;">Le Club Immobilier Français — ORIAS 24002253</p>
      <p style="font-size:10px;margin:8px 0 0 0;color:#CBD5E1;line-height:1.45;">
        Informations sur le parcours recommandation partenaire : voir la politique de confidentialité (section 2 bis) sur notre site.
      </p>
    </div>
  </div>
</div>`;

  return {
    subject: `${prenom !== "Bonjour" ? prenom + ", votre" : "Votre"} étude assurance emprunteur — recommandation LCIF`,
    html,
  };
}

export async function notifyReferredClientNewReferral(params: {
  apporteur: Apporteur;
  referral: Referral;
  portalBaseUrl?: string;
}): Promise<boolean> {
  const email = String(params.referral.contact.email || "").trim().toLowerCase();
  if (!email.includes("@")) return false;
  if (params.referral.clientInviteSentAt) return false;

  const base = resolvePublicAppBaseUrl(params.portalBaseUrl);
  const formUrl = `${base.replace(/\/$/, "")}/?ref=${encodeURIComponent(params.apporteur.referralToken)}`;
  const { subject, html } = buildReferredClientInviteEmail({
    apporteur: params.apporteur,
    referral: params.referral,
    formUrl,
  });

  const sent = await sendApporteurHtmlEmail(email, subject, html);
  if (sent) {
    params.referral.clientInviteSentAt = new Date().toISOString();
  }
  return sent;
}
