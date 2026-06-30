import {
  buildInseeSirenUrl,
  buildInseeSiretFromSirenAndNic,
  buildInseeSiretUrl,
  currentPeriod,
  parseInseeEtablissementToMatch,
  parseInseeUniteLegaleToMatch,
  type InseeReponseEtablissement,
  type InseeReponseUniteLegale,
} from "../shared/inseeSirene";
import type { GouvEntrepriseMatch } from "../shared/gouvEntrepriseSearch";
import { normalizeSiretInput } from "../shared/siret";

function getInseeApiKey(): string | undefined {
  return (
    process.env.INSEE_API_KEY?.trim() ||
    process.env.INSEE_API_TOKEN?.trim() ||
    process.env.X_INSEE_API_KEY_INTEGRATION?.trim() ||
    undefined
  );
}

async function fetchInseeJson<T>(url: string, apiKey: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-INSEE-Api-Key-Integration": apiKey,
    },
    signal: AbortSignal.timeout(12_000),
  });

  if (res.status === 404) {
    throw new Error("NOT_FOUND");
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error("Clé API INSEE invalide ou non autorisée. Vérifiez INSEE_API_KEY sur Railway.");
  }

  if (res.status === 429) {
    throw new Error("Quota API INSEE dépassé. Réessayez dans quelques instants.");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn("[SIRET] API INSEE erreur", res.status, url, body.slice(0, 200));
    throw new Error(`Service INSEE Sirene indisponible (${res.status}).`);
  }

  return (await res.json()) as T;
}

async function lookupSiretViaInsee(siret: string, apiKey: string): Promise<GouvEntrepriseMatch | null> {
  const data = await fetchInseeJson<InseeReponseEtablissement>(buildInseeSiretUrl(siret), apiKey);
  if (!data.etablissement) return null;
  return parseInseeEtablissementToMatch(data.etablissement);
}

async function lookupSirenViaInsee(siren: string, apiKey: string): Promise<GouvEntrepriseMatch | null> {
  const data = await fetchInseeJson<InseeReponseUniteLegale>(buildInseeSirenUrl(siren), apiKey);
  const uniteLegale = data.uniteLegale;
  if (!uniteLegale?.siren) return null;

  const period = currentPeriod(uniteLegale.periodesUniteLegale);
  const siegeSiret = buildInseeSiretFromSirenAndNic(siren, period?.nicSiegeUniteLegale);

  if (siegeSiret) {
    try {
      const siegeData = await fetchInseeJson<InseeReponseEtablissement>(
        buildInseeSiretUrl(siegeSiret),
        apiKey,
      );
      if (siegeData.etablissement) {
        const match = parseInseeUniteLegaleToMatch(uniteLegale, siegeData.etablissement);
        if (match) return match;
      }
    } catch (err: any) {
      if (err?.message !== "NOT_FOUND") throw err;
    }
  }

  return parseInseeUniteLegaleToMatch(uniteLegale);
}

export function isInseeSireneConfigured(): boolean {
  return Boolean(getInseeApiKey());
}

export async function lookupFrenchCompanyViaInsee(query: string): Promise<GouvEntrepriseMatch | null> {
  const apiKey = getInseeApiKey();
  if (!apiKey) {
    throw new Error(
      "Vérification SIREN/SIRET non configurée : ajoutez INSEE_API_KEY (clé du portail api.insee.fr) sur Railway.",
    );
  }

  const normalized = normalizeSiretInput(query);
  if (!/^\d{9}$/.test(normalized) && !/^\d{14}$/.test(normalized)) {
    throw new Error("Saisissez un SIREN (9 chiffres) ou un SIRET (14 chiffres).");
  }

  try {
    if (normalized.length === 14) {
      return await lookupSiretViaInsee(normalized, apiKey);
    }
    return await lookupSirenViaInsee(normalized, apiKey);
  } catch (err: any) {
    if (err?.message === "NOT_FOUND") return null;
    throw err;
  }
}
