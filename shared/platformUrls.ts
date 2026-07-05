/** URL publique officielle du frontend assurance (formulaire, suivi client, admin). */
export const ASSURANCE_PLATFORM_PRODUCTION_URL = "https://assurance.leclubimmofrancais.com";

function normalizeOrigin(url: string): string {
  return String(url || "").trim().replace(/\/$/, "");
}

/** Origines autorisées pour CORS (frontend → API Railway). */
export function resolveCorsOrigins(): string[] | true {
  if (process.env.NODE_ENV !== "production") return true;

  const fromEnv = String(process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => normalizeOrigin(s))
    .filter(Boolean);

  const candidates = [
    ASSURANCE_PLATFORM_PRODUCTION_URL,
    process.env.APP_URL,
    process.env.PUBLIC_APP_URL,
    process.env.CLIENT_FORM_PUBLIC_URL,
    process.env.VITE_PUBLIC_SITE_URL,
    ...fromEnv,
    // Transition : anciens hôtes encore actifs le temps du basculement DNS
    "https://assurance-emprunteur.up.railway.app",
  ]
    .map((u) => normalizeOrigin(String(u || "")))
    .filter((u) => u.startsWith("http"));

  return [...new Set(candidates)];
}

/** URL du site client (liens formulaire / suivi) — env d'abord, sinon prod officielle. */
export function resolveAssurancePublicSiteUrl(): string {
  for (const key of [
    "CLIENT_FORM_PUBLIC_URL",
    "PUBLIC_APP_URL",
    "VITE_PUBLIC_SITE_URL",
    "APP_URL",
  ] as const) {
    const v = normalizeOrigin(process.env[key] || "");
    if (v.startsWith("http") && !v.includes("vercel.app")) return v;
  }
  if (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_PUBLIC_SITE_URL) {
    const v = normalizeOrigin(String((import.meta as any).env.VITE_PUBLIC_SITE_URL));
    if (v.startsWith("http")) return v;
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return ASSURANCE_PLATFORM_PRODUCTION_URL;
}
