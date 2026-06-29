import type { Request, Response, NextFunction } from "express";

const DEFAULT_ALLOWED = "assurance@leclubimmobilier.fr,remi@leclubimmobilier.fr";

export function isAdminAuthRequired(): boolean {
  const override = String(process.env.ADMIN_AUTH_REQUIRED ?? "").toLowerCase();
  if (override === "false" || override === "0") return false;
  if (override === "true" || override === "1") return true;
  if (process.env.USE_LOCAL_DB === "true") return false;
  return (
    process.env.FIREBASE_REQUIRED === "true" ||
    Boolean(process.env.RAILWAY_ENVIRONMENT) ||
    process.env.NODE_ENV === "production"
  );
}

function getAllowedAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_ALLOWED_EMAILS || DEFAULT_ALLOWED;
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isPublicApiRoute(method: string, path: string): boolean {
  if (!path.startsWith("/api/")) return true;
  const m = method.toUpperCase();
  if (path === "/api/health" && m === "GET") return true;
  if (path === "/api/dossiers" && m === "POST") return true;
  if (path === "/api/public/help" && m === "POST") return true;
  if (path.startsWith("/api/public/apporteur-ref/") && m === "GET") return true;
  if (path.startsWith("/api/apporteur-portal/") && (m === "GET" || m === "POST")) return true;
  if (path.startsWith("/api/portail/") && m === "GET") return true;
  if (path === "/api/telegram/webhook" && m === "POST") return true;
  if (path.startsWith("/api/telegram/") && m === "GET") return true;
  return false;
}

async function verifyBearerToken(token: string): Promise<string | null> {
  const trimmed = String(token || "").trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("mock-gdrive-access-token-") && !isAdminAuthRequired()) {
    return "assurance@leclubimmobilier.fr";
  }

  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(trimmed)}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string; error?: string };
    if (data.error || !data.email) return null;
    return String(data.email).toLowerCase();
  } catch {
    return null;
  }
}

export async function adminAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.method === "OPTIONS") {
    next();
    return;
  }
  if (!isAdminAuthRequired() || isPublicApiRoute(req.method, req.path)) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentification admin requise." });
    return;
  }

  const email = await verifyBearerToken(authHeader.slice(7));
  if (!email || !getAllowedAdminEmails().has(email)) {
    res.status(403).json({ error: "Accès admin refusé pour ce compte." });
    return;
  }

  (req as Request & { adminEmail?: string }).adminEmail = email;
  next();
}
