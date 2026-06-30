import { formatSirenDisplay, formatSiretDisplay, normalizeSiretInput } from "./siret";

/** Raison sociale masquée ou absente au registre (INSEE / données protégées). */
export function isMaskedRegistryCompanyName(
  name: string,
  siren?: string,
  siret?: string,
): boolean {
  const raw = String(name || "").trim();
  if (!raw) return true;

  const normalized = normalizeSiretInput(raw);
  if (/^\d{9,14}$/.test(normalized)) return true;
  if (/^\[?\s*nd\s*\]?$/i.test(raw)) return true;
  if (/non diffus/i.test(raw)) return true;
  if (/confidentiel/i.test(raw)) return true;

  const sirenNorm = siren ? normalizeSiretInput(siren) : "";
  const siretNorm = siret ? normalizeSiretInput(siret) : "";
  if (sirenNorm && normalized === sirenNorm) return true;
  if (siretNorm && normalized === siretNorm) return true;

  return false;
}

export function registryFallbackCompanyLabel(params: { siren: string; siret?: string }): string {
  if (params.siret) return formatSiretDisplay(params.siret);
  return formatSirenDisplay(params.siren);
}

export function resolveCompanyNamesFromRegistryLookup(match: {
  name: string;
  siren: string;
  siret?: string;
}): {
  companyLegalName: string;
  suggestedCompanyName: string;
  isMasked: boolean;
} {
  const isMasked = isMaskedRegistryCompanyName(match.name, match.siren, match.siret);
  if (isMasked) {
    // Ne pas recopier le SIREN/SIRET dans la raison sociale — les identifiants sont sur des lignes dédiées.
    return {
      companyLegalName: "",
      suggestedCompanyName: "",
      isMasked: true,
    };
  }
  const legal = String(match.name || "").trim();
  return {
    companyLegalName: legal,
    suggestedCompanyName: legal,
    isMasked: false,
  };
}
