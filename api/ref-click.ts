import {
  geoFromVercelHeaders,
  mergeReferralClickGeo,
  type ReferralClickGeoSlice,
} from "../shared/referralGeo";
import { reverseGeocodeReferralGeo } from "../shared/referralGoogleGeo";

type Req = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: string | Record<string, unknown>;
};

type Res = {
  statusCode: number;
  setHeader: (key: string, value: string) => void;
  end: (body?: string) => void;
};

function readHeader(headers: Record<string, string | string[] | undefined>, name: string): string {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return String(value || "").trim();
}

function parseBody(req: Req): Record<string, unknown> {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function railwayApiBase(): string {
  const raw = String(process.env.VITE_API_URL || process.env.RAILWAY_API_URL || "").trim();
  return raw.replace(/\/$/, "");
}

async function resolveEdgeReferralGeo(
  headers: Record<string, string | string[] | undefined>,
): Promise<ReferralClickGeoSlice> {
  const vercelGeo = geoFromVercelHeaders(headers);
  const mapsKey = String(process.env.GOOGLE_MAPS_API_KEY || "").trim();
  const lat = Number(readHeader(headers, "x-vercel-ip-latitude"));
  const lng = Number(readHeader(headers, "x-vercel-ip-longitude"));

  if (mapsKey && Number.isFinite(lat) && Number.isFinite(lng)) {
    try {
      const googleGeo = await reverseGeocodeReferralGeo(lat, lng, mapsKey);
      if (googleGeo.city || googleGeo.region) {
        return mergeReferralClickGeo(googleGeo, vercelGeo);
      }
    } catch {
      /* fallback Vercel */
    }
  }

  return vercelGeo;
}

/** Proxy Vercel → Railway avec géo edge (Vercel MaxMind + option Google Geocoding). */
export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
    return;
  }

  const body = parseBody(req);
  const ref = String(body.ref || "").trim();
  const sessionId = String(body.sessionId || "").trim();
  if (!ref) {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "missing_ref" }));
    return;
  }

  const geo = await resolveEdgeReferralGeo(req.headers);
  const apiBase = railwayApiBase();

  if (!apiBase.startsWith("http")) {
    res.statusCode = 503;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "api_not_configured" }));
    return;
  }

  const proxySecret = String(process.env.REF_CLICK_PROXY_SECRET || "").trim();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (proxySecret) headers["x-lcif-ref-proxy"] = proxySecret;

  try {
    const upstream = await fetch(`${apiBase}/api/ref-click`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ref, sessionId, geo }),
    });
    const payload = await upstream.json().catch(() => ({ ok: false }));
    res.statusCode = upstream.ok ? 200 : upstream.status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
  } catch {
    res.statusCode = 502;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "upstream_failed" }));
  }
}
