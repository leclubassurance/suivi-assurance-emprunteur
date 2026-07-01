export type ReferralClickGeoSlice = {
  countryCode?: string;
  region?: string;
  city?: string;
};

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
  const rc = String(regionCode || "").trim().toUpperCase();
  if (cc === "FR" && FR_REGION_LABELS[rc]) return FR_REGION_LABELS[rc];
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
  const cc = String(geo.countryCode || "")
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const region = geo.region ? String(geo.region).trim().slice(0, 12) : undefined;
  const city = geo.city ? String(geo.city).trim().slice(0, 64) : undefined;

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
    regions.push({
      label: regionCodeToLabel(cc, region),
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
      return `${regionCodeToLabel(cc, region)} (${count})`;
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
