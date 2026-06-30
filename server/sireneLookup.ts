import { extractSirenFromSiret, isValidSiren, isValidSiret, normalizeSiretInput } from "../shared/siret";

export type SireneCompanyMatch = {
  siren: string;
  siret?: string;
  name: string;
  tradeName?: string;
  addressLine?: string;
  postalCode?: string;
  city?: string;
  legalForm?: string;
  isActive: boolean;
};

type GouvSearchResult = {
  results?: Array<{
    siren?: string;
    nom_complet?: string;
    nom_raison_sociale?: string;
    nom_commercial?: string;
    nature_juridique?: string;
    etat_administratif?: string;
    siege?: {
      siret?: string;
      adresse?: string;
      code_postal?: string;
      libelle_commune?: string;
      etat_administratif?: string;
    };
    matching_etablissements?: Array<{
      siret?: string;
      adresse?: string;
      code_postal?: string;
      libelle_commune?: string;
      etat_administratif?: string;
    }>;
  }>;
};

function pickEstablishment(
  result: NonNullable<GouvSearchResult["results"]>[number],
  normalizedQuery: string,
): {
  siret?: string;
  addressLine?: string;
  postalCode?: string;
  city?: string;
  isActive: boolean;
} {
  if (normalizedQuery.length === 14) {
    const match =
      result.matching_etablissements?.find((e) => e.siret === normalizedQuery) ||
      (result.siege?.siret === normalizedQuery ? result.siege : undefined);
    if (match) {
      return {
        siret: match.siret,
        addressLine: match.adresse,
        postalCode: match.code_postal,
        city: match.libelle_commune,
        isActive: (match.etat_administratif || "A") === "A",
      };
    }
  }
  const siege = result.siege;
  return {
    siret: siege?.siret,
    addressLine: siege?.adresse,
    postalCode: siege?.code_postal,
    city: siege?.libelle_commune,
    isActive: (siege?.etat_administratif || result.etat_administratif || "A") === "A",
  };
}

export async function lookupFrenchCompany(query: string): Promise<SireneCompanyMatch | null> {
  const normalized = normalizeSiretInput(query);
  if (normalized.length !== 9 && normalized.length !== 14) return null;
  if (normalized.length === 9 && !isValidSiren(normalized)) return null;
  if (normalized.length === 14 && !isValidSiret(normalized)) return null;

  const url = `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(normalized)}&per_page=5`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error("Service de vérification SIREN/SIRET indisponible. Réessayez plus tard.");
  }
  const data = (await res.json()) as GouvSearchResult;
  const expectedSiren = extractSirenFromSiret(normalized);
  const result =
    data.results?.find((r) => r.siren === expectedSiren) ||
    (normalized.length === 14
      ? data.results?.find((r) =>
          r.matching_etablissements?.some((e) => e.siret === normalized) ||
          r.siege?.siret === normalized,
        )
      : undefined) ||
    data.results?.[0];
  if (!result?.siren) return null;

  const establishment = pickEstablishment(result, normalized);
  const name = String(result.nom_raison_sociale || result.nom_complet || "").trim();
  if (!name) return null;

  return {
    siren: result.siren,
    siret: normalized.length === 14 ? normalized : establishment.siret,
    name,
    tradeName: result.nom_commercial || undefined,
    addressLine: establishment.addressLine,
    postalCode: establishment.postalCode,
    city: establishment.city,
    legalForm: result.nature_juridique || undefined,
    isActive: establishment.isActive,
  };
}
