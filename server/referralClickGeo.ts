import type { Request } from "express";
import geoip from "geoip-lite";

export type ReferralClickGeo = {
  countryCode?: string;
  region?: string;
};

function normalizeCountryCode(raw: unknown): string | undefined {
  const code = String(raw || "")
    .trim()
    .toUpperCase();
  if (code.length === 2 && code !== "XX" && code !== "T1") return code;
  return undefined;
}

/** IP client (proxy Railway / CDN) — non stockée, lookup GeoIP uniquement. */
export function getClientIp(req: Pick<Request, "headers" | "ip" | "socket">): string | undefined {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  const candidates = [forwarded, String(req.ip || ""), req.socket?.remoteAddress || ""].filter(Boolean);

  for (const raw of candidates) {
    const ip = raw.replace(/^::ffff:/, "").trim();
    if (!ip || ip === "::1" || ip === "127.0.0.1") continue;
    return ip;
  }
  return undefined;
}

function countryFromHeaders(req: Pick<Request, "headers">): string | undefined {
  const headers = req.headers;
  const candidates = [
    headers["cf-ipcountry"],
    headers["x-vercel-ip-country"],
    headers["cloudfront-viewer-country"],
    headers["x-country-code"],
  ];
  for (const raw of candidates) {
    const code = normalizeCountryCode(raw);
    if (code) return code;
  }
  return undefined;
}

/** Pays (+ région MaxMind) : en-tête CDN en priorité, sinon geoip-lite (gratuit, local). */
export function resolveReferralClickGeo(req: Pick<Request, "headers" | "ip" | "socket">): ReferralClickGeo {
  const fromHeader = countryFromHeaders(req);
  if (fromHeader) return { countryCode: fromHeader };

  const ip = getClientIp(req);
  if (!ip) return {};

  const lookup = geoip.lookup(ip);
  if (!lookup?.country) return {};

  return {
    countryCode: normalizeCountryCode(lookup.country),
    region: lookup.region ? String(lookup.region).trim().slice(0, 12) : undefined,
  };
}

/** @deprecated Utiliser resolveReferralClickGeo */
export function resolveReferralClickCountry(req: Pick<Request, "headers" | "ip" | "socket">): string | undefined {
  return resolveReferralClickGeo(req).countryCode;
}
