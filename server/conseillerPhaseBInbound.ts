import {
  countSignedClientReferrals,
  isConseillerImmoClubType,
  resolveConseillerOperatingPhase,
} from "../shared/conseillerImmoClub";
import { formatApporteurDisplayName } from "../shared/apporteurProfile";
import { LCIF_EMAIL_LOGO_HEADER_IMG } from "../shared/emailBrand";
import { sendEmail } from "./emailProvider";
import { sendEmailReplyWithGmailAPI } from "./mailAutomation";
import { addEvent } from "./dossierModel";
import { findApporteurById, listReferrals } from "./apporteurStore";

export type ConseillerPhaseBContext = {
  apporteurId: string;
  conseillerEmail: string;
  conseillerName: string;
  conseillerPrenom: string;
};

const LCIF_NAVY = "#1E3A8A";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function resolveConseillerPhaseBContext(dossier: any): Promise<ConseillerPhaseBContext | null> {
  const apporteurId = String(dossier?.apporteur?.apporteurId || "").trim();
  if (!apporteurId) return null;

  const apporteur = await findApporteurById(apporteurId);
  if (!apporteur || !isConseillerImmoClubType(apporteur.type)) return null;

  const referrals = await listReferrals({ apporteurId: apporteur.id });
  const signedCount = countSignedClientReferrals(referrals);
  if (resolveConseillerOperatingPhase(signedCount) !== "autonomous") return null;

  const conseillerEmail = String(apporteur.email || "").trim().toLowerCase();
  if (!conseillerEmail.includes("@")) return null;

  const conseillerName = formatApporteurDisplayName(apporteur);
  const conseillerPrenom =
    String(apporteur.contactPrenom || "").trim() ||
    conseillerName.split(/\s+/).filter(Boolean)[0] ||
    "Votre conseiller";

  return {
    apporteurId: apporteur.id,
    conseillerEmail,
    conseillerName,
    conseillerPrenom,
  };
}

export function buildConseillerPhaseBClientReplyPlain(params: {
  clientPrenom?: string;
  conseillerPrenom: string;
  conseillerName: string;
}): string {
  const greeting = params.clientPrenom ? `Bonjour ${params.clientPrenom},` : "Bonjour,";
  return [
    greeting,
    "",
    `Nous avons bien reçu votre message et l'avons transmis à ${params.conseillerName}, votre conseiller au Club Immobilier Français.`,
    "",
    `${params.conseillerPrenom} reviendra vers vous personnellement pour vous répondre.`,
  ].join("\n");
}

/** Litige / contentieux : le Club reprend la main (escalade), pas le routage conseiller phase B. */
export function shouldClubEscalationOverridePhaseB(clientMessage: string): boolean {
  const blob = String(clientMessage || "").toLowerCase();
  return /litige|contentieux|avocat|tribunal|mise en demeure|plainte|menace|harc[eè]lement|judiciaire|poursuite|m[eé]diateur|signalement|dgccrf|cnil|juridique|arnaque|inadmissible|scandale|r[eé]clamation\s+(formelle|officielle|grave)/i.test(
    blob,
  );
}

export function wrapConseillerPhaseBClientReplyHtml(plain: string): string {
  const body = plain
    .split("\n")
    .map((line) =>
      line.trim()
        ? `<p style="margin:0 0 12px 0;">${escapeHtml(line)}</p>`
        : `<p style="margin:0 0 8px 0;">&nbsp;</p>`,
    )
    .join("");
  return `<div style="font-family: Arial, sans-serif; color: #334155; max-width: 600px; line-height: 1.55; font-size: 14px; margin: 0 auto;">
  <div style="background-color:${LCIF_NAVY};padding:28px 20px;text-align:center;">
    ${LCIF_EMAIL_LOGO_HEADER_IMG}
  </div>
  <div style="padding:24px 22px;background:#ffffff;">
    ${body}
    <div style="margin-top: 24px; padding-top: 14px; border-top: 1px solid #EFF6FF;">
      <p style="margin: 0; color: ${LCIF_NAVY}; font-weight: bold;">Le Club Immobilier Français</p>
      <p style="margin: 2px 0 0 0; font-size: 12px; color: #64748B;">Assurance emprunteur</p>
    </div>
  </div>
</div>`;
}

export async function forwardClientInboundToConseiller(params: {
  ctx: ConseillerPhaseBContext;
  dossier: any;
  clientEmail: string;
  subject: string;
  bodyText: string;
  attachmentNames?: string[];
}): Promise<{ ok: boolean; error?: string }> {
  const dossierRef = params.dossier.id;
  const clientName = [
    params.dossier.formData?.assures?.[0]?.prenom,
    params.dossier.formData?.assures?.[0]?.nom,
  ]
    .filter(Boolean)
    .join(" ");

  const fwdSubject = `[${dossierRef}] Message client — ${params.subject}`;
  const attLine = params.attachmentNames?.length
    ? `\n\nPièces jointes reçues : ${params.attachmentNames.join(", ")}\n(Les documents sont également enregistrés sur le dossier dans votre espace conseiller.)`
    : "";

  const body = [
    "Message client transféré automatiquement (phase autonome — relation client gérée par le conseiller).",
    "",
    `Dossier : ${dossierRef}`,
    `Client : ${clientName || "—"} <${params.clientEmail}>`,
    `Objet initial : ${params.subject}`,
    "",
    "--- Message client ---",
    params.bodyText,
    attLine,
  ].join("\n");

  const html = `<div style="font-family: Arial, sans-serif; color: #334155; line-height: 1.5; font-size: 14px;">
    <p style="margin:0 0 12px 0;">Bonjour ${escapeHtml(params.ctx.conseillerPrenom)},</p>
    <pre style="font-family: Arial, sans-serif; white-space: pre-wrap; margin:0;">${escapeHtml(body)}</pre>
    <p style="margin:16px 0 0 0; font-size:12px; color:#64748B;">Transfert automatique — Le Club Immobilier Français</p>
  </div>`;

  const result = await sendEmail({
    to: params.ctx.conseillerEmail,
    subject: fwdSubject,
    html,
  });
  if (!result.ok) return { ok: false, error: "error" in result ? result.error : "send_failed" };
  return { ok: true };
}

export async function handleConseillerPhaseBClientInbound(params: {
  dossier: any;
  accessToken: string | null;
  ctx: ConseillerPhaseBContext;
  clientEmail: string;
  subject: string;
  bodyText: string;
  replySubject: string;
  gmailId: string;
  attachmentNames?: string[];
  upsertCommunication?: (dossier: any, msg: any) => boolean;
}): Promise<{ ok: boolean; error?: string; replyPlain?: string }> {
  const clientPrenom = params.dossier.formData?.assures?.[0]?.prenom || "";
  const replyPlain = buildConseillerPhaseBClientReplyPlain({
    clientPrenom,
    conseillerPrenom: params.ctx.conseillerPrenom,
    conseillerName: params.ctx.conseillerName,
  });
  const replyHtml = wrapConseillerPhaseBClientReplyHtml(replyPlain);

  const fwd = await forwardClientInboundToConseiller({
    ctx: params.ctx,
    dossier: params.dossier,
    clientEmail: params.clientEmail,
    subject: params.subject,
    bodyText: params.bodyText,
    attachmentNames: params.attachmentNames,
  });
  if (!fwd.ok) {
    return { ok: false, error: fwd.error || "forward_failed" };
  }

  const sent = await sendEmailReplyWithGmailAPI(
    params.accessToken,
    params.clientEmail,
    params.replySubject,
    replyHtml,
  );
  if (!sent.ok) {
    return { ok: false, error: sent.error || "client_reply_failed", replyPlain };
  }

  params.upsertCommunication?.(params.dossier, {
    id: `msg_phaseb_${params.gmailId}`,
    gmailId: sent.messageId,
    direction: "outbound",
    from: "Le Club Immobilier Français",
    to: params.clientEmail,
    subject: params.replySubject,
    text: replyPlain,
    html: replyHtml,
    date: new Date().toISOString(),
  });

  addEvent(params.dossier, {
    type: "AI_DECISION",
    actor: { kind: "SYSTEM", label: "Phase B conseiller" },
    message: `Message client transféré à ${params.ctx.conseillerName} ; accusé envoyé au client (Camille désactivée).`,
    meta: {
      gmailId: params.gmailId,
      conseillerId: params.ctx.apporteurId,
      conseillerEmail: params.ctx.conseillerEmail,
    },
  });

  return { ok: true, replyPlain };
}
