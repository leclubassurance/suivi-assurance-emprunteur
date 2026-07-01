export type ReferralClickGeoSlice = {
  countryCode?: string;
  region?: string;
  city?: string;
};

function tryDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Libellé ville lisible (Osny-sous-Bois, Saint-Étienne…). */
export function formatCityLabel(raw: string): string {
  const decoded = tryDecodeURIComponent(String(raw || "").trim());
  if (!decoded) return "";
  const lowerParticles = new Set(["de", "du", "des", "la", "le", "les", "en", "sur", "sous", "d", "l"]);
  return decoded
    .split(/(\s+|-)/)
    .map((part) => {
      if (part === "-" || /^\s+$/.test(part)) return part;
      const lower = part.toLowerCase();
      if (lowerParticles.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}

export function sanitizeReferralClickGeoSlice(geo?: ReferralClickGeoSlice | null): ReferralClickGeoSlice {
  if (!geo) return {};
  const countryCode = String(geo.countryCode || "")
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const city = geo.city ? formatCityLabel(String(geo.city).trim().slice(0, 64)) : undefined;
  const out: ReferralClickGeoSlice = {};
  if (countryCode && countryCode !== "XX" && countryCode !== "T1") out.countryCode = countryCode;
  if (city) out.city = city;
  return out;
}

/** En-têtes géo Vercel (MaxMind) — disponibles sur les fonctions edge, pas sur Railway direct. */
export function geoFromVercelHeaders(headers: Record<string, string | string[] | undefined>): ReferralClickGeoSlice {
  const read = (name: string) => {
    const raw = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(raw) ? raw[0] : raw;
  };
  return sanitizeReferralClickGeoSlice({
    countryCode: read("x-vercel-ip-country"),
    city: read("x-vercel-ip-city"),
  });
}

export function mergeReferralClickGeo(
  preferred?: ReferralClickGeoSlice | null,
  fallback?: ReferralClickGeoSlice | null,
): ReferralClickGeoSlice {
  const a = sanitizeReferralClickGeoSlice(preferred);
  const b = sanitizeReferralClickGeoSlice(fallback);
  return sanitizeReferralClickGeoSlice({
    countryCode: a.countryCode || b.countryCode,
    city: a.city || b.city,
  });
}

export function countryCodeToLabel(code: string): string {
  const c = code.toUpperCase();
  const fr: Record<string, string> = {
    FR: "France",
    BE: "Belgique",
    CH: "Suisse",
    LU: "Luxembourg",
    MC: "Monaco",
    ES: "Espagne",
    IT: "Italie",
    DE: "Allemagne",
    GB: "R.-U.",
    US: "États-Unis",
    CA: "Canada",
    MA: "Maroc",
    TN: "Tunisie",
    DZ: "Algérie",
    GP: "Guadeloupe",
    MQ: "Martinique",
    RE: "La Réunion",
    GF: "Guyane",
    YT: "Mayotte",
    NC: "N.-Calédonie",
    PF: "Polynésie",
  };
  return fr[c] || c;
}

function bump(map: Record<string, number>, key: string) {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

/** Agrège pays / région / ville à partir d'un clic géolocalisé. */
export function applyReferralClickGeoToStats(
  stats: NonNullable<import("./apporteurTypes").Apporteur["referralStats"]>,
  geo: ReferralClickGeoSlice,
  at: string,
  sessionId?: string,
): void {
  const normalized = sanitizeReferralClickGeoSlice(geo);
  const cc = normalized.countryCode;
  const city = normalized.city;

  if (cc && cc !== "XX") {
    const byCountry = { ...(stats.clicksByCountry || {}) };
    bump(byCountry, cc);
    stats.clicksByCountry = byCountry;
  }

  if (cc && city) {
    const byCity = { ...(stats.clicksByCity || {}) };
    bump(byCity, `${cc}:${city}`);
    stats.clicksByCity = byCity;
  }

  const recent = [...(stats.recentClicks || [])];
  recent.push({
    at,
    sessionId: sessionId || undefined,
    countryCode: cc || undefined,
    city,
  });
  stats.recentClicks = recent.slice(-120);
}

export type GeoLocationSummary = { label: string; count: number; kind: "city" | "region" | "country" };

/** Résumé lisible pour l'admin : villes en priorité, sinon pays (gratuit, sans région IP). */
export function summarizeReferralClickGeo(stats?: {
  clicksByCity?: Record<string, number>;
  clicksByCountry?: Record<string, number>;
}): GeoLocationSummary[] {
  if (!stats) return [];

  const cities: GeoLocationSummary[] = [];
  for (const [key, count] of Object.entries(stats.clicksByCity || {})) {
    const [, ...cityParts] = key.split(":");
    const city = cityParts.join(":").trim();
    if (!city) continue;
    cities.push({ label: city, count: Number(count) || 0, kind: "city" });
  }
  if (cities.length) return cities.sort((a, b) => b.count - a.count).slice(0, 8);

  const countries: GeoLocationSummary[] = [];
  for (const [code, count] of Object.entries(stats.clicksByCountry || {})) {
    countries.push({
      label: countryCodeToLabel(code),
      count: Number(count) || 0,
      kind: "country",
    });
  }
  return countries.sort((a, b) => b.count - a.count).slice(0, 8);
}

export function formatGeoLocationSummaries(summaries: GeoLocationSummary[]): string {
  if (!summaries.length) return "—";
  return summaries.map((s) => `${s.label} (${s.count})`).join(" · ");
}

/** Détail pour la fiche apporteur admin (ville + pays). */
export function formatReferralGeoDetail(stats?: {
  clicksByCity?: Record<string, number>;
  clicksByCountry?: Record<string, number>;
}): { cities: string; countries: string } {
  const cities = Object.entries(stats?.clicksByCity || {})
    .map(([key, count]) => {
      const city = key.split(":").slice(1).join(":").trim();
      return city ? `${city} (${count})` : "";
    })
    .filter(Boolean)
    .sort((a, b) => {
      const ca = Number(a.match(/\((\d+)\)$/)?.[1] || 0);
      const cb = Number(b.match(/\((\d+)\)$/)?.[1] || 0);
      return cb - ca;
    })
    .join(" · ");

  const countries = Object.entries(stats?.clicksByCountry || {})
    .map(([code, count]) => `${countryCodeToLabel(code)} (${count})`)
    .sort((a, b) => {
      const ca = Number(a.match(/\((\d+)\)$/)?.[1] || 0);
      const cb = Number(b.match(/\((\d+)\)$/)?.[1] || 0);
      return cb - ca;
    })
    .join(" · ");

  return { cities, countries };
}
