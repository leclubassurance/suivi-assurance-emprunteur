import type { Request } from "express";

/** Pays ISO-3166 alpha-2 si l'hébergeur ou le CDN l'expose (sans IP brute). */
export function resolveReferralClickCountry(req: Pick<Request, "headers">): string | undefined {
  const headers = req.headers;
  const candidates = [
    headers["cf-ipcountry"],
    headers["x-vercel-ip-country"],
    headers["cloudfront-viewer-country"],
    headers["x-country-code"],
  ];
  for (const raw of candidates) {
    const code = String(raw || "")
      .trim()
      .toUpperCase();
    if (code.length === 2 && code !== "XX" && code !== "T1") return code;
  }
  return undefined;
}
