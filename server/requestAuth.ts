import type { Request } from "express";
import { canUseDomainWideDelegation } from "./googleDelegatedAuth";
import { getServerAccessToken, hasServerOAuthRefreshToken } from "./googleOAuthServer";

/** Bearer token from the current HTTP request only (never a stale global). */
export function getBearerTokenFromRequest(req: Request): string {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.split(" ")[1] || "";
  }
  return "";
}

/** OAuth access token for autonomous server actions (form submit, scripts). */
export async function resolveAutonomousGoogleAccessToken(): Promise<string | null> {
  if (hasServerOAuthRefreshToken()) {
    try {
      return await getServerAccessToken();
    } catch {
      return null;
    }
  }
  if (canUseDomainWideDelegation()) {
    return null;
  }
  return null;
}

export function canAutonomousGoogleMailOrDrive(): boolean {
  return hasServerOAuthRefreshToken() || canUseDomainWideDelegation();
}
