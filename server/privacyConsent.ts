import type { Request } from "express";
import {
  PRIVACY_CONSENT_CHECKBOX_TEXT,
  PRIVACY_POLICY_LAST_UPDATED,
  PRIVACY_POLICY_VERSION,
} from "../shared/privacyConsent";

export interface PrivacyConsentRecord {
  acceptedAt: string;
  policyVersion: string;
  policyLastUpdated: string;
  labelText: string;
  ip?: string;
  userAgent?: string;
  sourceUrl?: string;
  sheetsLoggedAt?: string;
}

function clientIp(req: Request): string | undefined {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0]?.trim();
  if (Array.isArray(xf) && xf[0]) return String(xf[0]).trim();
  return req.ip || undefined;
}

export function parsePrivacyConsentFromForm(
  formData: any,
  req: Request,
): { ok: true; record: PrivacyConsentRecord } | { ok: false; error: string } {
  const raw = formData?.privacyConsent;
  if (!raw || typeof raw !== "object") {
    return {
      ok: false,
      error:
        "Consentement à la politique de confidentialité requis. Rechargez la page et cochez la case avant d'envoyer.",
    };
  }

  if (raw.accepted !== true) {
    return { ok: false, error: "Vous devez accepter la politique de confidentialité pour envoyer votre dossier." };
  }

  const acceptedAt = typeof raw.acceptedAt === "string" ? raw.acceptedAt : "";
  if (!acceptedAt || Number.isNaN(Date.parse(acceptedAt))) {
    return { ok: false, error: "Horodatage de consentement invalide." };
  }

  const policyVersion = String(raw.policyVersion || "").trim();
  if (policyVersion !== PRIVACY_POLICY_VERSION) {
    return {
      ok: false,
      error:
        "La politique de confidentialité a été mise à jour. Rechargez la page, relisez la politique et validez à nouveau.",
    };
  }

  const policyLastUpdated = String(raw.policyLastUpdated || "").trim();
  if (policyLastUpdated !== PRIVACY_POLICY_LAST_UPDATED) {
    return {
      ok: false,
      error:
        "La politique de confidentialité a été mise à jour. Rechargez la page, relisez la politique et validez à nouveau.",
    };
  }

  const labelText = String(raw.labelText || "").trim();
  if (!labelText || labelText !== PRIVACY_CONSENT_CHECKBOX_TEXT) {
    return {
      ok: false,
      error: "Libellé de consentement invalide. Rechargez la page et réessayez.",
    };
  }

  const referer = typeof req.headers.referer === "string" ? req.headers.referer : undefined;
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;

  return {
    ok: true,
    record: {
      acceptedAt,
      policyVersion,
      policyLastUpdated,
      labelText,
      ip: clientIp(req),
      userAgent:
        typeof req.headers["user-agent"] === "string"
          ? req.headers["user-agent"].slice(0, 500)
          : undefined,
      sourceUrl: referer || origin,
    },
  };
}
