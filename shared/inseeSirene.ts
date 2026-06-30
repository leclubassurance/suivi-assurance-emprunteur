import type { GouvEntrepriseMatch } from "./gouvEntrepriseSearch";
import {
  isMaskedRegistryCompanyName,
  registryFallbackCompanyLabel,
} from "./companyRegistryName";
import { extractSirenFromSiret } from "./siret";

export const INSEE_SIRENE_API_BASE = "https://api.insee.fr/api-sirene/3.11";

export type InseeAdresse = {
  numeroVoieEtablissement?: string;
  indiceRepetitionEtablissement?: string;
  typeVoieEtablissement?: string;
  libelleVoieEtablissement?: string;
  complementAdresseEtablissement?: string;
  codePostalEtablissement?: string;
  libelleCommuneEtablissement?: string;
};

type InseePeriodeUniteLegale = {
  dateFin?: string | null;
  etatAdministratifUniteLegale?: string;
  denominationUniteLegale?: string;
  denominationUsuelle1UniteLegale?: string;
  nomUniteLegale?: string;
  prenomUsuelUniteLegale?: string;
  nomUsageUniteLegale?: string;
  nicSiegeUniteLegale?: string;
  categorieJuridiqueUniteLegale?: string;
};

export type InseeUniteLegale = {
  siren?: string;
  periodesUniteLegale?: InseePeriodeUniteLegale[];
};

type InseeUniteLegaleEtablissement = {
  etatAdministratifUniteLegale?: string;
  denominationUniteLegale?: string;
  denominationUsuelle1UniteLegale?: string;
  nomUniteLegale?: string;
  prenomUsuelUniteLegale?: string;
  categorieJuridiqueUniteLegale?: string;
};

type InseePeriodeEtablissement = {
  dateFin?: string | null;
  etatAdministratifEtablissement?: string;
  enseigne1Etablissement?: string;
};

export type InseeEtablissement = {
  siren?: string;
  nic?: string;
  siret?: string;
  etablissementSiege?: boolean;
  uniteLegale?: InseeUniteLegaleEtablissement;
  adresseEtablissement?: InseeAdresse;
  periodesEtablissement?: InseePeriodeEtablissement[];
};

export type InseeReponseUniteLegale = {
  uniteLegale?: InseeUniteLegale;
};

export type InseeReponseEtablissement = {
  etablissement?: InseeEtablissement;
};

export function currentPeriod<T extends { dateFin?: string | null }>(periodes?: T[]): T | undefined {
  if (!periodes?.length) return undefined;
  return periodes.find((p) => p.dateFin == null || p.dateFin === "") ?? periodes[periodes.length - 1];
}

export function buildInseeSiretFromSirenAndNic(siren: string, nic?: string): string | undefined {
  if (!nic) return undefined;
  const padded = String(nic).replace(/\s/g, "").padStart(5, "0");
  if (!/^\d{5}$/.test(padded)) return undefined;
  return `${siren}${padded}`;
}

export function buildAddressLineFromInsee(adresse?: InseeAdresse | null): string | undefined {
  if (!adresse) return undefined;
  const voie = [
    adresse.numeroVoieEtablissement,
    adresse.indiceRepetitionEtablissement,
    adresse.typeVoieEtablissement,
    adresse.libelleVoieEtablissement,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  const parts = [adresse.complementAdresseEtablissement, voie].filter(Boolean);
  return parts.join(", ") || undefined;
}

function legalNameFromUniteLegalePeriod(period?: InseePeriodeUniteLegale): string {
  if (!period) return "";
  return (
    String(period.denominationUniteLegale || "").trim() ||
    [period.prenomUsuelUniteLegale, period.nomUniteLegale].filter(Boolean).join(" ").trim() ||
    String(period.nomUsageUniteLegale || "").trim() ||
    String(period.denominationUsuelle1UniteLegale || "").trim()
  );
}

function legalNameFromUniteLegaleEtablissement(ul?: InseeUniteLegaleEtablissement): string {
  if (!ul) return "";
  return (
    String(ul.denominationUniteLegale || "").trim() ||
    [ul.prenomUsuelUniteLegale, ul.nomUniteLegale].filter(Boolean).join(" ").trim() ||
    String(ul.denominationUsuelle1UniteLegale || "").trim()
  );
}

export function parseInseeEtablissementToMatch(etablissement: InseeEtablissement): GouvEntrepriseMatch | null {
  const siren = String(etablissement.siren || extractSirenFromSiret(etablissement.siret || "") || "").trim();
  if (!siren) return null;

  const period = currentPeriod(etablissement.periodesEtablissement);
  const ul = etablissement.uniteLegale;
  const rawName = legalNameFromUniteLegaleEtablissement(ul) || String(period?.enseigne1Etablissement || "").trim();
  const isMasked = isMaskedRegistryCompanyName(rawName, siren, etablissement.siret);
  const name = isMasked ? registryFallbackCompanyLabel({ siren, siret: etablissement.siret }) : rawName;
  if (!name) return null;

  const etatEtab = period?.etatAdministratifEtablissement;
  const etatUl = ul?.etatAdministratifUniteLegale;
  const isActive = (etatEtab == null || etatEtab === "A") && (etatUl == null || etatUl === "A");

  return {
    siren,
    siret: etablissement.siret,
    name,
    tradeName: period?.enseigne1Etablissement || ul?.denominationUsuelle1UniteLegale || undefined,
    addressLine: buildAddressLineFromInsee(etablissement.adresseEtablissement),
    postalCode: etablissement.adresseEtablissement?.codePostalEtablissement,
    city: etablissement.adresseEtablissement?.libelleCommuneEtablissement,
    legalForm: ul?.categorieJuridiqueUniteLegale || undefined,
    isActive,
  };
}

export function parseInseeUniteLegaleToMatch(
  uniteLegale: InseeUniteLegale,
  siegeEtablissement?: InseeEtablissement,
): GouvEntrepriseMatch | null {
  const siren = String(uniteLegale.siren || "").trim();
  if (!siren) return null;

  const period = currentPeriod(uniteLegale.periodesUniteLegale);
  const rawName = legalNameFromUniteLegalePeriod(period);
  const isMasked = isMaskedRegistryCompanyName(rawName, siren);
  const name = isMasked ? registryFallbackCompanyLabel({ siren }) : rawName;
  if (!name) return null;

  if (siegeEtablissement) {
    const fromSiege = parseInseeEtablissementToMatch(siegeEtablissement);
    if (fromSiege) {
      return {
        ...fromSiege,
        name: fromSiege.name || name,
        legalForm: fromSiege.legalForm || period?.categorieJuridiqueUniteLegale,
      };
    }
  }

  const nicSiege = period?.nicSiegeUniteLegale;
  const siret = buildInseeSiretFromSirenAndNic(siren, nicSiege);
  const etatUl = period?.etatAdministratifUniteLegale;

  return {
    siren,
    siret,
    name,
    tradeName: period?.denominationUsuelle1UniteLegale || undefined,
    legalForm: period?.categorieJuridiqueUniteLegale || undefined,
    isActive: etatUl == null || etatUl === "A",
  };
}

export function buildInseeSirenUrl(siren: string): string {
  return `${INSEE_SIRENE_API_BASE}/siren/${encodeURIComponent(siren)}`;
}

export function buildInseeSiretUrl(siret: string): string {
  return `${INSEE_SIRENE_API_BASE}/siret/${encodeURIComponent(siret)}`;
}
