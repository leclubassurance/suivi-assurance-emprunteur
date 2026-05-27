/**
 * Charge les identifiants du compte de service Google depuis Railway.
 * Préférer GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 (évite les problèmes de guillemets / retours ligne).
 */
export function loadServiceAccountCredentials(): Record<string, unknown> | null {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();

  let jsonText: string | null = null;
  if (b64) {
    try {
      jsonText = Buffer.from(b64, "base64").toString("utf8");
    } catch (err) {
      console.error("[ServiceAccount] GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 invalide", err);
      return null;
    }
  } else if (raw) {
    jsonText = raw;
  }

  if (!jsonText) return null;

  try {
    return JSON.parse(jsonText) as Record<string, unknown>;
  } catch (err) {
    console.error("[ServiceAccount] JSON invalide dans GOOGLE_SERVICE_ACCOUNT_JSON", err);
    return null;
  }
}

export function hasServiceAccountConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() ||
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim(),
  );
}

export function getServiceAccountClientEmail(): string | null {
  const creds = loadServiceAccountCredentials();
  const email = creds?.client_email;
  return typeof email === "string" ? email : null;
}
