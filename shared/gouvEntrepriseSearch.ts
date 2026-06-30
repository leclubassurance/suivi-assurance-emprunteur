import { extractSirenFromSiret, normalizeSiretInput } from "./siret";
import {
  isMaskedRegistryCompanyName,
  registryFallbackCompanyLabel,
} from "./companyRegistryName";

export type GouvEntrepriseMatch = {
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

type GouvEstablishment = {
  siret?: string;
  adresse?: string;
  code_postal?: string;
  libelle_commune?: string;
  commune?: string;
  etat_administratif?: string;
};

export type GouvSearchResponse = {
  results?: Array<{
    siren?: string;
    nom_complet?: string;
    nom_raison_sociale?: string;
    nom_commercial?: string;
    nature_juridique?: string;
    etat_administratif?: string;
    siege?: GouvEstablishment;
    matching_etablissements?: GouvEstablishment[];
  }>;
};

export const GOUV_ENTREPRISE_API_BASE = "https://recherche-entreprises.api.gouv.fr";
export const GOUV_ENTREPRISE_USER_AGENT =
  "Le-Club-Immobilier-Francais/1.0 (+https://leclubimmobilierfrancais.fr; support@leclubimmobilier.fr)";

export function buildGouvEntrepriseSearchQueries(raw: string): string[] {
  const normalized = normalizeSiretInput(raw);
  if (!/^\d{9}$/.test(normalized) && !/^\d{14}$/.test(normalized)) return [];
  if (normalized.length === 9) {
    return [normalized, `siren:${normalized}`];
  }
  const siren = normalized.slice(0, 9);
  return [normalized, `siret:${normalized}`, siren, `siren:${siren}`];
}

export function buildGouvEntrepriseSearchUrl(q: string): string {
  const params = new URLSearchParams({
    q,
    page: "1",
    per_page: "5",
    minimal: "true",
    include: "siege,matching_etablissements",
    limite_matching_etablissements: "100",
  });
  return `${GOUV_ENTREPRISE_API_BASE}/search?${params.toString()}`;
}

function pickEstablishment(
  result: NonNullable<GouvSearchResponse["results"]>[number],
  normalizedQuery: string,
): GouvEstablishment | undefined {
  if (normalizedQuery.length === 14) {
    return (
      result.matching_etablissements?.find((e) => e.siret === normalizedQuery) ||
      (result.siege?.siret === normalizedQuery ? result.siege : undefined)
    );
  }
  return result.siege;
}

function establishmentIsActive(establishment?: GouvEstablishment, fallback?: string): boolean {
  const state = establishment?.etat_administratif || fallback || "A";
  return state === "A";
}

export function parseGouvEntrepriseSearchResponse(
  data: GouvSearchResponse,
  normalizedQuery: string,
): GouvEntrepriseMatch | null {
  const expectedSiren = extractSirenFromSiret(normalizedQuery);
  const result =
    data.results?.find((r) => r.siren === expectedSiren) ||
    (normalizedQuery.length === 14
      ? data.results?.find(
          (r) =>
            r.siege?.siret === normalizedQuery ||
            r.matching_etablissements?.some((e) => e.siret === normalizedQuery),
        )
      : undefined) ||
    data.results?.[0];

  if (!result?.siren) return null;

  const establishment = pickEstablishment(result, normalizedQuery);
  const siret = normalizedQuery.length === 14 ? normalizedQuery : establishment?.siret;
  const rawName = String(result.nom_raison_sociale || result.nom_complet || "").trim();
  const isMasked = isMaskedRegistryCompanyName(rawName, result.siren, siret);
  const name = isMasked
    ? registryFallbackCompanyLabel({ siren: result.siren, siret })
    : rawName;
  if (!name) return null;

  return {
    siren: result.siren,
    siret,
    name,
    tradeName: result.nom_commercial || undefined,
    addressLine: establishment?.adresse,
    postalCode: establishment?.code_postal,
    city: establishment?.libelle_commune || establishment?.commune,
    legalForm: result.nature_juridique || undefined,
    isActive: establishmentIsActive(establishment, result.etat_administratif),
  };
}
