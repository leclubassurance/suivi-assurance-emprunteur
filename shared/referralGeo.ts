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
  const region = geo.region
    ? normalizeReferralRegionLabel(countryCode, String(geo.region).trim())
    : undefined;
  const out: ReferralClickGeoSlice = {};
  if (countryCode && countryCode !== "XX" && countryCode !== "T1") out.countryCode = countryCode;
  if (region) out.region = region.slice(0, 64);
  if (city) out.city = city;
  return out;
}

/** Convertit codes bruts (75, IDF, FR-IDF) en libellé région lisible ; vide si non interprétable. */
export function normalizeReferralRegionLabel(countryCode: string, regionCode: string): string {
  const cc = String(countryCode || "").toUpperCase();
  let rc = String(regionCode || "").trim();
  if (!rc) return "";

  // Déjà un libellé (ex. après géocodage Google)
  if (rc.length > 4 && /[a-zàâçéèêëîïôùûü]/i.test(rc) && !/^\d+$/.test(rc)) {
    return rc;
  }

  if (rc.includes("-")) {
    const parts = rc.split("-");
    rc = parts[parts.length - 1] || rc;
  }

  const upper = rc.toUpperCase();
  if (cc === "FR") {
    if (FR_REGION_LABELS[upper]) return FR_REGION_LABELS[upper];
    const deptKey = /^\d+$/.test(upper) ? upper.padStart(upper.length <= 2 ? 2 : upper.length, "0") : upper;
    if (FR_DEPT_TO_REGION[deptKey]) return FR_DEPT_TO_REGION[deptKey];
    if (FR_DEPT_TO_REGION[upper]) return FR_DEPT_TO_REGION[upper];
  }

  // Code numérique ou sigle inconnu → ne pas afficher (évite « 11 », « 75 »…)
  if (/^\d+$/.test(upper) || (upper.length <= 4 && upper === upper.toUpperCase() && !FR_REGION_LABELS[upper])) {
    return "";
  }

  return rc;
}

/** En-têtes géo Vercel (MaxMind) — disponibles sur les fonctions edge, pas sur Railway direct. */
export function geoFromVercelHeaders(headers: Record<string, string | string[] | undefined>): ReferralClickGeoSlice {
  const read = (name: string) => {
    const raw = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(raw) ? raw[0] : raw;
  };
  return sanitizeReferralClickGeoSlice({
    countryCode: read("x-vercel-ip-country"),
    region: read("x-vercel-ip-country-region"),
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
    region: a.region || b.region,
    city: a.city || b.city,
  });
}

const FR_REGION_LABELS: Record<string, string> = {
  IDF: "Île-de-France",
  ARA: "Auvergne-Rhône-Alpes",
  BFC: "Bourgogne-Franche-Comté",
  BRE: "Bretagne",
  CVL: "Centre-Val de Loire",
  COR: "Corse",
  GES: "Grand Est",
  HDF: "Hauts-de-France",
  NAQ: "Nouvelle-Aquitaine",
  OCC: "Occitanie",
  PDL: "Pays de la Loire",
  PAC: "Provence-Alpes-Côte d'Azur",
  NOR: "Normandie",
  GUA: "Guadeloupe",
  MTQ: "Martinique",
  REU: "La Réunion",
  GUF: "Guyane",
  MAY: "Mayotte",
};

/** Départements / codes ISO → libellé région (Vercel envoie souvent 75, 11, FR-IDF…). */
const FR_DEPT_TO_REGION: Record<string, string> = {
  "01": "Auvergne-Rhône-Alpes",
  "02": "Hauts-de-France",
  "03": "Auvergne-Rhône-Alpes",
  "04": "Provence-Alpes-Côte d'Azur",
  "05": "Provence-Alpes-Côte d'Azur",
  "06": "Provence-Alpes-Côte d'Azur",
  "07": "Auvergne-Rhône-Alpes",
  "08": "Grand Est",
  "09": "Occitanie",
  "10": "Grand Est",
  "11": "Occitanie",
  "12": "Occitanie",
  "13": "Provence-Alpes-Côte d'Azur",
  "14": "Normandie",
  "15": "Auvergne-Rhône-Alpes",
  "16": "Nouvelle-Aquitaine",
  "17": "Nouvelle-Aquitaine",
  "18": "Centre-Val de Loire",
  "19": "Nouvelle-Aquitaine",
  "21": "Bourgogne-Franche-Comté",
  "22": "Bretagne",
  "23": "Nouvelle-Aquitaine",
  "24": "Nouvelle-Aquitaine",
  "25": "Bourgogne-Franche-Comté",
  "26": "Auvergne-Rhône-Alpes",
  "27": "Normandie",
  "28": "Centre-Val de Loire",
  "29": "Bretagne",
  "2A": "Corse",
  "2B": "Corse",
  "30": "Occitanie",
  "31": "Occitanie",
  "32": "Occitanie",
  "33": "Nouvelle-Aquitaine",
  "34": "Occitanie",
  "35": "Bretagne",
  "36": "Centre-Val de Loire",
  "37": "Centre-Val de Loire",
  "38": "Auvergne-Rhône-Alpes",
  "39": "Bourgogne-Franche-Comté",
  "40": "Nouvelle-Aquitaine",
  "41": "Centre-Val de Loire",
  "42": "Auvergne-Rhône-Alpes",
  "43": "Auvergne-Rhône-Alpes",
  "44": "Pays de la Loire",
  "45": "Centre-Val de Loire",
  "46": "Occitanie",
  "47": "Nouvelle-Aquitaine",
  "48": "Occitanie",
  "49": "Pays de la Loire",
  "50": "Normandie",
  "51": "Grand Est",
  "52": "Grand Est",
  "53": "Pays de la Loire",
  "54": "Grand Est",
  "55": "Grand Est",
  "56": "Bretagne",
  "57": "Grand Est",
  "58": "Bourgogne-Franche-Comté",
  "59": "Hauts-de-France",
  "60": "Hauts-de-France",
  "61": "Normandie",
  "62": "Hauts-de-France",
  "63": "Auvergne-Rhône-Alpes",
  "64": "Nouvelle-Aquitaine",
  "65": "Occitanie",
  "66": "Occitanie",
  "67": "Grand Est",
  "68": "Grand Est",
  "69": "Auvergne-Rhône-Alpes",
  "70": "Bourgogne-Franche-Comté",
  "71": "Bourgogne-Franche-Comté",
  "72": "Pays de la Loire",
  "73": "Auvergne-Rhône-Alpes",
  "74": "Auvergne-Rhône-Alpes",
  "75": "Île-de-France",
  "76": "Normandie",
  "77": "Île-de-France",
  "78": "Île-de-France",
  "79": "Nouvelle-Aquitaine",
  "80": "Hauts-de-France",
  "81": "Occitanie",
  "82": "Occitanie",
  "83": "Provence-Alpes-Côte d'Azur",
  "84": "Provence-Alpes-Côte d'Azur",
  "85": "Pays de la Loire",
  "86": "Nouvelle-Aquitaine",
  "87": "Nouvelle-Aquitaine",
  "88": "Grand Est",
  "89": "Bourgogne-Franche-Comté",
  "90": "Bourgogne-Franche-Comté",
  "91": "Île-de-France",
  "92": "Île-de-France",
  "93": "Île-de-France",
  "94": "Île-de-France",
  "95": "Île-de-France",
  "971": "Guadeloupe",
  "972": "Martinique",
  "973": "Guyane",
  "974": "La Réunion",
  "976": "Mayotte",
};

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

export function regionCodeToLabel(countryCode: string | undefined, regionCode: string): string {
  const cc = String(countryCode || "").toUpperCase();
  const label = normalizeReferralRegionLabel(cc, regionCode);
  if (label) return label;
  const rc = String(regionCode || "").trim();
  if (!rc || /^\d+$/.test(rc)) return "";
  return rc;
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
  const region = normalized.region;
  const city = normalized.city;

  if (cc && cc !== "XX") {
    const byCountry = { ...(stats.clicksByCountry || {}) };
    bump(byCountry, cc);
    stats.clicksByCountry = byCountry;
  }

  if (cc && region) {
    const byRegion = { ...(stats.clicksByRegion || {}) };
    bump(byRegion, `${cc}:${region}`);
    stats.clicksByRegion = byRegion;
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
    region,
    city,
  });
  stats.recentClicks = recent.slice(-120);
}

export type GeoLocationSummary = { label: string; count: number; kind: "city" | "region" | "country" };

/** Résumé lisible pour l'admin : villes en priorité, sinon régions, sinon pays. */
export function summarizeReferralClickGeo(stats?: {
  clicksByCity?: Record<string, number>;
  clicksByRegion?: Record<string, number>;
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

  const regions: GeoLocationSummary[] = [];
  for (const [key, count] of Object.entries(stats.clicksByRegion || {})) {
    const [cc, region] = key.split(":");
    if (!region) continue;
    const label = regionCodeToLabel(cc, region);
    if (!label) continue;
    regions.push({
      label,
      count: Number(count) || 0,
      kind: "region",
    });
  }
  if (regions.length) return regions.sort((a, b) => b.count - a.count).slice(0, 8);

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
  return summaries
    .map((s) => {
      const suffix = s.kind === "region" ? " (rég.)" : "";
      return `${s.label}${suffix} (${s.count})`;
    })
    .join(" · ");
}

/** Détail complet pour la fiche apporteur admin. */
export function formatReferralGeoDetail(stats?: {
  clicksByCity?: Record<string, number>;
  clicksByRegion?: Record<string, number>;
  clicksByCountry?: Record<string, number>;
}): { cities: string; regions: string; countries: string } {
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

  const regions = Object.entries(stats?.clicksByRegion || {})
    .map(([key, count]) => {
      const [cc, region] = key.split(":");
      if (!region) return "";
      const label = regionCodeToLabel(cc, region);
      if (!label) return "";
      return `${label} (${count})`;
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

  return { cities, regions, countries };
}
