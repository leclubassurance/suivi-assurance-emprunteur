import { sanitizeReferralClickGeoSlice, type ReferralClickGeoSlice } from "./referralGeo";

type GeocodeComponent = { long_name?: string; short_name?: string; types?: string[] };

function pickComponent(components: GeocodeComponent[], ...types: string[]): GeocodeComponent | undefined {
  return components.find((c) => types.some((t) => c.types?.includes(t)));
}

/**
 * Géocodage inverse Google (lat/lng → ville + région en français).
 * Google ne propose pas d'API « IP → ville » : on part des coordonnées edge (Vercel).
 */
export async function reverseGeocodeReferralGeo(
  lat: number,
  lng: number,
  apiKey: string,
): Promise<ReferralClickGeoSlice> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !apiKey.trim()) return {};

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("latlng", `${lat},${lng}`);
  url.searchParams.set("language", "fr");
  url.searchParams.set("result_type", "locality|administrative_area_level_1|country");
  url.searchParams.set("key", apiKey.trim());

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(4000) });
  if (!res.ok) return {};

  const data = (await res.json()) as {
    status?: string;
    results?: { address_components?: GeocodeComponent[] }[];
  };
  if (data.status !== "OK" || !data.results?.length) return {};

  const components = data.results[0].address_components || [];
  const country = pickComponent(components, "country");
  const region = pickComponent(components, "administrative_area_level_1");
  const city =
    pickComponent(components, "locality") ||
    pickComponent(components, "postal_town") ||
    pickComponent(components, "administrative_area_level_2");

  return sanitizeReferralClickGeoSlice({
    countryCode: country?.short_name,
    region: region?.long_name,
    city: city?.long_name,
  });
}
