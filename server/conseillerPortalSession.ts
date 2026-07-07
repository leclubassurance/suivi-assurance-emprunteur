import crypto from "crypto";
import type { Request, Response } from "express";
import type { Apporteur } from "../shared/apporteurTypes";
import { isConseillerImmoClubType } from "../shared/conseillerImmoClub";

export const CONSEILLER_SESSION_COOKIE = "lcif_conseiller_sess";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_SLIDE_MS = 12 * 60 * 60 * 1000;

export type ConseillerPortalSessionRecord = {
  hash: string;
  expiresAt: number;
  createdAt: number;
  lastSeenAt: number;
};

function hashSessionToken(apporteurId: string, token: string): string {
  return crypto.createHash("sha256").update(`${apporteurId}:${token.trim()}`).digest("hex");
}

function isSecureCookieEnv(): boolean {
  return process.env.FIREBASE_REQUIRED === "true" || Boolean(process.env.RAILWAY_ENVIRONMENT);
}

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export function setSessionCookie(res: Response, apporteurId: string, rawToken: string, maxAgeMs: number): void {
  const value = `${apporteurId}.${rawToken}`;
  const maxAgeSec = Math.max(0, Math.floor(maxAgeMs / 1000));
  const secure = isSecureCookieEnv();
  const flags = [
    `${CONSEILLER_SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${maxAgeSec}`,
    `SameSite=${secure ? "None" : "Lax"}`,
  ];
  if (secure) flags.push("Secure");
  res.setHeader("Set-Cookie", flags.join("; "));
}

export function clearSessionCookie(res: Response): void {
  const secure = isSecureCookieEnv();
  const flags = [
    `${CONSEILLER_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "Max-Age=0",
    `SameSite=${secure ? "None" : "Lax"}`,
  ];
  if (secure) flags.push("Secure");
  res.setHeader("Set-Cookie", flags.join("; "));
}

async function writeSession(apporteurId: string, session: ConseillerPortalSessionRecord | null): Promise<void> {
  const { loadApporteurStore, persistApporteurStoreMutation } = await import("./apporteurStore");
  await loadApporteurStore();
  await persistApporteurStoreMutation((store) => {
    const apporteur = store.apporteurs.find((a) => a.id === apporteurId);
    if (!apporteur) return false;
    if (session) {
      (apporteur as Apporteur).conseillerPortalSession = session;
    } else {
      delete (apporteur as Apporteur).conseillerPortalSession;
    }
    return true;
  });
}

export async function createConseillerPortalSession(apporteurId: string, res: Response): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  await writeSession(apporteurId, {
    hash: hashSessionToken(apporteurId, rawToken),
    expiresAt: now + SESSION_TTL_MS,
    createdAt: now,
    lastSeenAt: now,
  });
  const sessionValue = `${apporteurId}.${rawToken}`;
  setSessionCookie(res, apporteurId, rawToken, SESSION_TTL_MS);
  return sessionValue;
}

function readSessionValue(req: Request): string | null {
  const auth = String(req.headers.authorization || "").trim();
  if (auth.toLowerCase().startsWith("bearer ")) {
    const bearer = auth.slice(7).trim();
    if (bearer) return bearer;
  }
  return parseCookies(req)[CONSEILLER_SESSION_COOKIE] || null;
}

export async function resolveConseillerPortalSession(req: Request): Promise<Apporteur | null> {
  const cookie = readSessionValue(req);
  if (!cookie) return null;
  const dot = cookie.indexOf(".");
  if (dot < 1) return null;
  const apporteurId = cookie.slice(0, dot);
  const rawToken = cookie.slice(dot + 1);
  if (!rawToken || rawToken.length < 32) return null;

  const { loadApporteurStore } = await import("./apporteurStore");
  const store = await loadApporteurStore();
  const apporteur = store.apporteurs.find((a) => a.id === apporteurId);
  if (!apporteur?.active || !isConseillerImmoClubType(apporteur.type)) return null;

  const session = apporteur.conseillerPortalSession;
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    await writeSession(apporteurId, null);
    return null;
  }
  if (session.hash !== hashSessionToken(apporteurId, rawToken)) return null;
  return apporteur;
}

export async function touchConseillerPortalSession(apporteurId: string): Promise<void> {
  const { loadApporteurStore, persistApporteurStoreMutation } = await import("./apporteurStore");
  await loadApporteurStore();
  const now = Date.now();
  await persistApporteurStoreMutation((store) => {
    const apporteur = store.apporteurs.find((a) => a.id === apporteurId);
    const session = apporteur?.conseillerPortalSession;
    if (!apporteur || !session) return false;
    if (now > session.expiresAt) return false;
    if (now - session.lastSeenAt >= SESSION_SLIDE_MS) {
      session.lastSeenAt = now;
      session.expiresAt = now + SESSION_TTL_MS;
    }
    return true;
  });
}

export async function destroyConseillerPortalSession(req: Request, res: Response): Promise<void> {
  const apporteur = await resolveConseillerPortalSession(req);
  if (apporteur) await writeSession(apporteur.id, null);
  clearSessionCookie(res);
}

function hashAdminPreviewToken(apporteurId: string, rawToken: string): string {
  return crypto.createHash("sha256").update(`${apporteurId}:admin-preview:${rawToken.trim()}`).digest("hex");
}

function readAdminPreviewToken(req: Request): string | null {
  const fromQuery = String(req.query.lcif_preview || "").trim();
  return fromQuery || null;
}

/** Vérifie un jeton de prévisualisation admin (généré côté admin, envoyé par email au compte autorisé). */
export function resolveAdminPortalPreview(req: Request, apporteur: Apporteur): boolean {
  const raw = readAdminPreviewToken(req);
  if (!raw) return false;
  const preview = apporteur.adminPortalPreview;
  if (!preview) return false;
  if (Date.now() > preview.expiresAt) return false;
  return preview.hash === hashAdminPreviewToken(apporteur.id, raw);
}

/** Génère un jeton de prévisualisation admin (30 min) stocké sur le partenaire. */
export async function createAdminPortalPreview(apporteurId: string): Promise<{
  previewToken: string;
  portalToken: string;
  expiresAt: number;
}> {
  const { loadApporteurStore, persistApporteurStoreMutation } = await import("./apporteurStore");
  await loadApporteurStore();
  const rawToken = crypto.randomBytes(24).toString("hex");
  const now = Date.now();
  const expiresAt = now + 30 * 60 * 1000;
  let portalToken = "";
  await persistApporteurStoreMutation((store) => {
    const apporteur = store.apporteurs.find((a) => a.id === apporteurId);
    if (!apporteur?.portalToken) return false;
    portalToken = apporteur.portalToken;
    apporteur.adminPortalPreview = {
      hash: hashAdminPreviewToken(apporteurId, rawToken),
      expiresAt,
      createdAt: now,
    };
    return true;
  });
  if (!portalToken) throw new Error("Partenaire introuvable ou sans portail.");
  return { previewToken: rawToken, portalToken, expiresAt };
}

export async function gateApporteurPortalForConseiller(
  req: Request,
  res: Response,
  apporteur: Apporteur | null,
): Promise<Apporteur | null> {
  if (!apporteur) {
    res.status(404).json({ ok: false, error: "portal_invalid" });
    return null;
  }
  if (!isConseillerImmoClubType(apporteur.type)) return apporteur;
  const { resolveAdminEmailFromRequest } = await import("./adminAuth");
  if (await resolveAdminEmailFromRequest(req)) return apporteur;
  if (resolveAdminPortalPreview(req, apporteur)) return apporteur;
  const sessionApporteur = await resolveConseillerPortalSession(req);
  if (!sessionApporteur || sessionApporteur.id !== apporteur.id) {
    res.status(401).json({ ok: false, error: "session_required" });
    return null;
  }
  void touchConseillerPortalSession(apporteur.id);
  return apporteur;
}
