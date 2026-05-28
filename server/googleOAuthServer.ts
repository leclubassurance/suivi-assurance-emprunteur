import { google } from "googleapis";

function getEnv(name: string): string | undefined {
  return (process.env as any)[name] as string | undefined;
}

export function hasServerOAuthRefreshToken(): boolean {
  return Boolean(getEnv("GOOGLE_OAUTH_CLIENT_ID") && getEnv("GOOGLE_OAUTH_CLIENT_SECRET") && getEnv("GOOGLE_OAUTH_REFRESH_TOKEN"));
}

export function createServerOAuthClient() {
  const clientId = getEnv("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = getEnv("GOOGLE_OAUTH_CLIENT_SECRET");
  const refreshToken = getEnv("GOOGLE_OAUTH_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("OAuth serveur non configuré: GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN manquants.");
  }
  const oauth2 = new google.auth.OAuth2({ clientId, clientSecret });
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

export async function getServerAccessToken(): Promise<string> {
  const client = createServerOAuthClient();
  try {
    const token = await client.getAccessToken();
    const accessToken = typeof token === "string" ? token : token?.token;
    if (!accessToken) throw new Error("access_token vide");
    return accessToken;
  } catch (err: any) {
    const msg = err?.message || String(err);
    // unauthorized_client / invalid_grant usually means the refresh token is tied to a different OAuth client,
    // or scopes are missing / consent not granted.
    throw new Error(
      `OAuth serveur: échec refresh_token (${msg}). Vérifiez GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN sur Railway, et regénérez le refresh token avec les scopes Gmail+Drive si besoin.`,
    );
  }
}

