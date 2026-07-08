import type { VercelRequest, VercelResponse } from "@vercel/node";
import { geoFromVercelHeaders, type ReferralClickGeoSlice } from "../shared/referralGeo";

const DEFAULT_RAILWAY_API = "https://assurance-emprunteur.up.railway.app";

function parseBody(req: VercelRequest): Record<string, unknown> {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body as Record<string, unknown>;
  try {
    return JSON.parse(String(req.body)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function railwayApiBase(): string {
  const raw = String(
    process.env.VITE_API_URL || process.env.RAILWAY_API_URL || DEFAULT_RAILWAY_API,
  ).trim();
  return raw.replace(/\/$/, "");
}

/** Ville + pays uniquement (région IP trop imprécise, stack 100 % gratuite Vercel MaxMind). */
function geoForFreeStack(headers: VercelRequest["headers"]): ReferralClickGeoSlice {
  const { countryCode, city } = geoFromVercelHeaders(
    headers as Record<string, string | string[] | undefined>,
  );
  return { countryCode, city };
}

/** Proxy Vercel → Railway avec géo edge gratuite (MaxMind via en-têtes Vercel). */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const body = parseBody(req);
  const ref = String(body.ref || "").trim();
  const sessionId = String(body.sessionId || "").trim();
  if (!ref) {
    res.status(400).json({ ok: false, error: "missing_ref" });
    return;
  }

  const geo = geoForFreeStack(req.headers);
  const apiBase = railwayApiBase();

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
    res.status(upstream.ok ? 200 : upstream.status).json(payload);
  } catch {
    res.status(502).json({ ok: false, error: "upstream_failed" });
  }
}
