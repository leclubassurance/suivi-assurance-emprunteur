import crypto from "crypto";
import type { Apporteur } from "../shared/apporteurTypes";
import { isConseillerImmoClubType, isLcifStaffEmail } from "../shared/conseillerImmoClub";
import { buildApporteurPortalPath } from "./apporteurNotify";
import { resolvePublicAppBaseUrl } from "./clientPortal";
import { sendEmail } from "./emailProvider";
import { sendEmailReplyWithGmailAPI } from "./mailAutomation";
import { hasServerOAuthRefreshToken, getServerAccessToken } from "./googleOAuthServer";
import { LCIF_EMAIL_LOGO_HEADER_IMG } from "../shared/emailBrand";

export type PortalLoginChallenge = {
  hash: string;
  expiresAt: number;
  sentAt: number;
};

const LOGIN_TTL_MS = 30 * 60 * 1000;
const LOGIN_COOLDOWN_MS = 60 * 1000;

function hashLoginToken(apporteurId: string, token: string): string {
  return crypto.createHash("sha256").update(`${apporteurId}:${token.trim()}`).digest("hex");
}

export async function findConseillerByStaffEmail(email: string): Promise<Apporteur | null> {
  const normalized = String(email || "").trim().toLowerCase();
  if (!isLcifStaffEmail(normalized)) return null;
  const { loadApporteurStore } = await import("./apporteurStore");
  const store = await loadApporteurStore();
  return (
    store.apporteurs.find(
      (a) => a.active && a.email === normalized && isConseillerImmoClubType(a.type),
    ) || null
  );
}

async function writeLoginChallenge(apporteurId: string, challenge: PortalLoginChallenge | null): Promise<void> {
  const { loadApporteurStore, persistApporteurStoreMutation } = await import("./apporteurStore");
  await loadApporteurStore();
  await persistApporteurStoreMutation((store) => {
    const apporteur = store.apporteurs.find((a) => a.id === apporteurId);
    if (!apporteur) return false;
    if (challenge) {
      (apporteur as Apporteur).portalLoginChallenge = challenge;
    } else {
      delete (apporteur as Apporteur).portalLoginChallenge;
    }
    return true;
  });
}

export function buildConseillerPortalLoginPath(loginToken: string): string {
  return `/conseiller/connexion/${encodeURIComponent(loginToken)}`;
}

export function buildConseillerPortalLoginUrl(baseUrl: string, loginToken: string): string {
  const base = String(baseUrl || "").replace(/\/$/, "");
  return `${base}${buildConseillerPortalLoginPath(loginToken)}`;
}

export function buildConseillerPortalEntryUrl(baseUrl: string): string {
  return `${String(baseUrl || "").replace(/\/$/, "")}/conseiller`;
}

export function buildConseillerLoginEmailHtml(params: {
  prenom: string;
  loginUrl: string;
  portalEntryUrl: string;
}): string {
  return `
<div style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#F8FAFC;color:#1F2937;line-height:1.6;">
  <div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E5E7EB;">
    <div style="background-color:#1E3A8A;padding:24px 20px;text-align:center;">
      ${LCIF_EMAIL_LOGO_HEADER_IMG}
    </div>
    <div style="padding:24px 22px;">
      <p style="font-size:16px;margin:0 0 14px 0;color:#111827;"><strong>Bonjour ${params.prenom},</strong></p>
      <p style="font-size:14px;margin:0 0 16px 0;color:#374151;">
        Voici votre lien de connexion sécurisé à l'espace conseiller immobilier Le Club Immobilier Français.
      </p>
      <p style="margin:0 0 20px 0;text-align:center;">
        <a href="${params.loginUrl}" style="display:inline-block;background:#1E3A8A;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:bold;font-size:15px;">
          Accéder à mon espace conseiller
        </a>
      </p>
      <p style="font-size:13px;margin:0 0 8px 0;color:#6B7280;">
        Ce lien est valable <strong>30 minutes</strong> et à usage personnel. Pour vos prochaines connexions :
        <a href="${params.portalEntryUrl}" style="color:#1E3A8A;font-weight:bold;">${params.portalEntryUrl}</a>
      </p>
      <p style="font-size:12px;margin:16px 0 0 0;color:#9CA3AF;">
        Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.
      </p>
    </div>
    <div style="background:#F8FAFC;padding:16px 22px;border-top:1px solid #E5E7EB;">
      <p style="font-size:11px;margin:0;color:#9CA3AF;">Le Club Immobilier Français — ORIAS 24002253</p>
    </div>
  </div>
</div>`;
}

async function sendLoginEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!to.includes("@")) return false;
  try {
    if (hasServerOAuthRefreshToken()) {
      const token = await getServerAccessToken();
      const res = await sendEmailReplyWithGmailAPI(token, to, subject, html);
      return res.ok;
    }
    const smtp = await sendEmail({ to, subject, html });
    return smtp.ok && smtp.providerId !== "SIMULATED";
  } catch {
    return false;
  }
}

export async function requestConseillerPortalLogin(params: {
  email: string;
  publicBaseUrl: string;
}): Promise<
  | { ok: true; maskedEmail: string }
  | { ok: false; error: string; cooldownSeconds?: number }
> {
  const apporteur = await findConseillerByStaffEmail(params.email);
  if (!apporteur?.portalToken) {
    return { ok: true, maskedEmail: maskEmail(params.email) };
  }

  const existing = apporteur.portalLoginChallenge;
  if (existing && Date.now() - existing.sentAt < LOGIN_COOLDOWN_MS) {
    const cooldownSeconds = Math.ceil((LOGIN_COOLDOWN_MS - (Date.now() - existing.sentAt)) / 1000);
    return { ok: false, error: "cooldown", cooldownSeconds };
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  await writeLoginChallenge(apporteur.id, {
    hash: hashLoginToken(apporteur.id, rawToken),
    expiresAt: now + LOGIN_TTL_MS,
    sentAt: now,
  });

  const base = resolvePublicAppBaseUrl(params.publicBaseUrl);
  const loginUrl = buildConseillerPortalLoginUrl(base, rawToken);
  const portalEntryUrl = buildConseillerPortalEntryUrl(base);
  const prenom =
    String(apporteur.contactPrenom || apporteur.contactName || "").split(" ")[0] || "Conseiller";
  const html = buildConseillerLoginEmailHtml({ prenom, loginUrl, portalEntryUrl });
  const sent = await sendLoginEmail(
    apporteur.email,
    "Connexion à votre espace conseiller — Le Club Immobilier Français",
    html,
  );
  if (!sent) {
    await writeLoginChallenge(apporteur.id, null);
    return { ok: false, error: "send_failed" };
  }

  return { ok: true, maskedEmail: maskEmail(apporteur.email) };
}

export async function verifyConseillerPortalLogin(
  loginToken: string,
): Promise<{ ok: true; portalToken: string } | { ok: false; error: string }> {
  const token = String(loginToken || "").trim();
  if (!token || token.length < 32) return { ok: false, error: "invalid_token" };

  const { loadApporteurStore } = await import("./apporteurStore");
  const store = await loadApporteurStore();
  for (const apporteur of store.apporteurs) {
    if (!apporteur.active || !isConseillerImmoClubType(apporteur.type)) continue;
    const challenge = apporteur.portalLoginChallenge;
    if (!challenge) continue;
    if (Date.now() > challenge.expiresAt) {
      await writeLoginChallenge(apporteur.id, null);
      continue;
    }
    if (challenge.hash !== hashLoginToken(apporteur.id, token)) continue;
    if (!apporteur.portalToken) return { ok: false, error: "no_portal" };
    await writeLoginChallenge(apporteur.id, null);
    return { ok: true, portalToken: apporteur.portalToken };
  }
  return { ok: false, error: "invalid_or_expired" };
}

function maskEmail(email: string): string {
  const [local, domain] = String(email || "").split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

export function buildApporteurPortalRedirectPath(portalToken: string): string {
  return buildApporteurPortalPath(portalToken);
}
