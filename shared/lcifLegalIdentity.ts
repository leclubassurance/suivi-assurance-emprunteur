/**
 * Identité juridique LCIF — source unique pour mentions légales et confidentialité.
 * Données société alignées sur les mandats / actes LCIF (ex. représentant : Charles VICTOR).
 */

export const LCIF_LEGAL = {
  brandName: "Le Club Immobilier Français",
  companyName: "LE CLUB IMMOBILIER FRANÇAIS",
  legalForm: "SAS",
  shareCapitalEur: "3 000",
  registeredOffice: "17 Passage Leroy, 44000 Nantes, France",
  rcsCity: "Nantes",
  rcsNumber: "915 289 599",
  siren: "915 289 599",
  vatNumber: "FR84915289599",
  legalRepresentative: "Charles VICTOR",
  legalRepresentativeTitle: "Président",
  publicationDirector: "Charles VICTOR",
  /** Référent données personnelles (contrat mandataire — annexe RGPD), pas un DPO nommément désigné. */
  dataProtectionContact: "Charles VICTOR",
  dataProtectionContactRole: "Référent données personnelles",
  siretEstablishment: "891528959900010",
  oriasNumber: "24002253",
  oriasUrl: "https://www.orias.fr",
  cpiNumber: "CPI 4401 2022 000 000 058",
  cpiIssuedAt: "26/08/2022",
  cpiAuthority: "CCI Nantes-Saint Nazaire",
  professionalInsurance: {
    insurer: "MMA IARD",
    address: "14 boulevard Marie et Alexandre Oyon, 72100 Le Mans",
    policyNumber: "105708080",
  },
  /** Contact mandats / opérationnel (actes LCIF) */
  contactEmail: "support@leclubimmobilier.fr",
  /** Contact public site vitrine */
  email: "info@leclubimmobilier.fr",
  phone: "07 80 95 30 92",
  mainWebsiteUrl: "https://leclubimmobilierfrancais.fr",
  insuranceActivity:
    "courtage en assurance, notamment assurance emprunteur (délégation d'assurance)",
  acpr:
    "Autorité de contrôle prudentiel et de résolution (ACPR) — 4 place de Budapest, CS 92459, 75436 Paris Cedex 09",
  mediationInsurance: {
    name: "La Médiation de l'Assurance",
    website: "https://www.mediation-assurance.org",
    postal: "TSA 50110 — 75441 Paris Cedex 09",
  },
  mediationConsumption: {
    name: "Médiateur de la consommation (entité désignée par l'Éditeur)",
    company: "SARL",
    address: "12 square Desnouettes, 75015 Paris",
    rcs: "840 463 129",
  },
} as const;

export function getAssurancePlatformUrl(): string {
  if (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_PUBLIC_SITE_URL) {
    return String((import.meta as any).env.VITE_PUBLIC_SITE_URL).replace(/\/$/, "");
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "https://assurance-emprunteur.up.railway.app";
}
