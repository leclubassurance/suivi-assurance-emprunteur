import type { Request } from "express";
import geoip from "geoip-lite";
import {
  formatCityLabel,
  geoFromVercelHeaders,
  mergeReferralClickGeo,
  sanitizeReferralClickGeoSlice,
  type ReferralClickGeoSlice,
} from "../shared/referralGeo";

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

/** Fallback local geoip-lite (base MaxMind embarquée, souvent moins précise). */
export function resolveReferralClickGeoFromIp(req: Pick<Request, "headers" | "ip" | "socket">): ReferralClickGeoSlice {
  const vercel = geoFromVercelHeaders(req.headers as Record<string, string | string[] | undefined>);
  if (vercel.countryCode && vercel.city) return vercel;

  const ip = getClientIp(req);
  const lookup = ip ? geoip.lookup(ip) : null;

  const countryCode =
    countryFromHeaders(req) || vercel.countryCode || normalizeCountryCode(lookup?.country) || undefined;

  if (!countryCode && !lookup) return vercel;

  return sanitizeReferralClickGeoSlice({
    countryCode,
    city: vercel.city || (lookup?.city ? formatCityLabel(String(lookup.city).trim().slice(0, 64)) : undefined),
  });
}

export function isTrustedRefClickProxy(req: Pick<Request, "headers">): boolean {
  const secret = String(process.env.REF_CLICK_PROXY_SECRET || "").trim();
  if (!secret) return false;
  const incoming = String(req.headers["x-lcif-ref-proxy"] || "").trim();
  return incoming.length > 0 && incoming === secret;
}

/** Géo finale : proxy Vercel (MaxMind récent) prioritaire, sinon geoip-lite. */
export function resolveReferralClickGeo(
  req: Pick<Request, "headers" | "ip" | "socket">,
  bodyGeo?: ReferralClickGeoSlice | null,
): ReferralClickGeoSlice {
  const fromIp = resolveReferralClickGeoFromIp(req);
  const sanitizedBody = sanitizeReferralClickGeoSlice(bodyGeo);
  const secret = String(process.env.REF_CLICK_PROXY_SECRET || "").trim();

  if (sanitizedBody.city) {
    if (!secret || isTrustedRefClickProxy(req)) {
      return mergeReferralClickGeo(sanitizedBody, fromIp);
    }
  }

  return fromIp;
}

/** @deprecated Utiliser resolveReferralClickGeo */
export function resolveReferralClickCountry(req: Pick<Request, "headers" | "ip" | "socket">): string | undefined {
  return resolveReferralClickGeo(req).countryCode;
}
