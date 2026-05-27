/**
 * Charge les identifiants du compte de service Google depuis Railway.
 * - GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 : JSON encodé en base64 (recommandé)
 * - GOOGLE_SERVICE_ACCOUNT_JSON : JSON brut sur une ligne
 */

export type ServiceAccountLoadResult = {
  credentials: Record<string, unknown> | null;
  clientEmail: string | null;
  source: "base64" | "json" | "json_auto_decoded_base64" | null;
  parseError?: string;
};

function stripWrappingQuotes(value: string): string {
  let v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

function looksLikeBase64(value: string): boolean {
  const compact = value.replace(/\s/g, "");
  if (compact.length < 40) return false;
  return /^[A-Za-z0-9+/]+=*$/.test(compact);
}

function parseJsonText(text: string): Record<string, unknown> | null {
  const normalized = stripWrappingQuotes(text);
  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function parseFromEnvText(text: string): ServiceAccountLoadResult {
  const direct = parseJsonText(text);
  if (direct) {
    const email = typeof direct.client_email === "string" ? direct.client_email : null;
    return { credentials: direct, clientEmail: email, source: "json" };
  }

  if (looksLikeBase64(text)) {
    try {
      const decoded = Buffer.from(text.replace(/\s/g, ""), "base64").toString("utf8");
      const fromB64 = parseJsonText(decoded);
      if (fromB64) {
        const email = typeof fromB64.client_email === "string" ? fromB64.client_email : null;
        return {
          credentials: fromB64,
          clientEmail: email,
          source: "json_auto_decoded_base64",
        };
      }
    } catch {
      // fall through
    }
  }

  return {
    credentials: null,
    clientEmail: null,
    source: null,
    parseError:
      "JSON invalide dans GOOGLE_SERVICE_ACCOUNT_JSON. Utilisez le fichier .json tel quel (une ligne) " +
      "ou GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 avec : base64 -i fichier.json | tr -d '\\n'",
  };
}

export function loadServiceAccountCredentials(): Record<string, unknown> | null {
  return loadServiceAccountDetails().credentials;
}

export function loadServiceAccountDetails(): ServiceAccountLoadResult {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();

  if (b64) {
    try {
      const decoded = Buffer.from(b64.replace(/\s/g, ""), "base64").toString("utf8");
      const parsed = parseJsonText(decoded);
      if (parsed) {
        const email = typeof parsed.client_email === "string" ? parsed.client_email : null;
        return { credentials: parsed, clientEmail: email, source: "base64" };
      }
      return {
        credentials: null,
        clientEmail: null,
        source: null,
        parseError: "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 décodé mais JSON invalide.",
      };
    } catch (err) {
      console.error("[ServiceAccount] GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 invalide", err);
      return {
        credentials: null,
        clientEmail: null,
        source: null,
        parseError: "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 : décodage base64 impossible.",
      };
    }
  }

  if (raw) {
    const result = parseFromEnvText(raw);
    if (!result.credentials) {
      console.error("[ServiceAccount]", result.parseError || "JSON invalide");
    }
    return result;
  }

  return { credentials: null, clientEmail: null, source: null };
}

export function hasServiceAccountConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() ||
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim(),
  );
}

export function hasServiceAccountReady(): boolean {
  return Boolean(loadServiceAccountDetails().credentials);
}

export function getServiceAccountClientEmail(): string | null {
  return loadServiceAccountDetails().clientEmail;
}
