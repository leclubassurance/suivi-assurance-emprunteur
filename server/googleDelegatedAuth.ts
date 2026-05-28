import { google } from "googleapis";
import { hasServiceAccountReady, loadServiceAccountDetails } from "./serviceAccount";

function getEnv(name: string): string | undefined {
  return (process.env as any)[name] as string | undefined;
}

export function getDelegationSubjectEmail(): string | null {
  const raw = (getEnv("GOOGLE_DELEGATION_SUBJECT") || getEnv("GMAIL_USER") || "").trim();
  return raw || null;
}

export function canUseDomainWideDelegation(): boolean {
  return hasServiceAccountReady() && Boolean(getDelegationSubjectEmail());
}

export function createDelegatedJwt(scopes: string[], subjectEmail?: string | null) {
  const sa = loadServiceAccountDetails();
  if (!sa.credentials) {
    throw new Error(sa.parseError || "Service account JSON introuvable ou invalide.");
  }
  const clientEmail = typeof sa.credentials.client_email === "string" ? sa.credentials.client_email : null;
  const privateKey = typeof sa.credentials.private_key === "string" ? sa.credentials.private_key : null;
  if (!clientEmail || !privateKey) {
    throw new Error("Service account invalide: client_email/private_key manquants.");
  }

  const subject = (subjectEmail || getDelegationSubjectEmail() || "").trim() || undefined;
  if (!subject) {
    throw new Error("GOOGLE_DELEGATION_SUBJECT (ou GMAIL_USER) manquant pour la délégation.");
  }

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes,
    subject,
  });
}

export async function getDelegatedAccessToken(scopes: string[], subjectEmail?: string | null): Promise<string> {
  const jwt = createDelegatedJwt(scopes, subjectEmail);
  const token = await jwt.getAccessToken();
  const accessToken = typeof token === "string" ? token : token?.token;
  if (!accessToken) throw new Error("Impossible d'obtenir un access_token via service account.");
  return accessToken;
}

