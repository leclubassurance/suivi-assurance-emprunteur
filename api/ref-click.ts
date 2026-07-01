import { geoFromVercelHeaders, type ReferralClickGeoSlice } from "../shared/referralGeo";

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

/** Ville + pays uniquement (région IP trop imprécise, stack 100 % gratuite Vercel MaxMind). */
function geoForFreeStack(headers: Record<string, string | string[] | undefined>): ReferralClickGeoSlice {
  const { countryCode, city } = geoFromVercelHeaders(headers);
  return { countryCode, city };
}

/** Proxy Vercel → Railway avec géo edge gratuite (MaxMind via en-têtes Vercel). */
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

  const geo = geoForFreeStack(req.headers);
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
