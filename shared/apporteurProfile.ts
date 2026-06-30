import type { Apporteur, ApporteurType } from "./apporteurTypes";
import { APPORTEUR_TYPE_LABELS } from "./apporteurTypes";
import { extractSirenFromSiret, formatSirenDisplay, formatSiretDisplay, isValidSiret, normalizeSiretInput } from "./siret";

export const APPORTEUR_LEGAL_FORM_OPTIONS = [
  { value: "micro_entrepreneur", label: "Micro-entrepreneur / auto-entrepreneur" },
  { value: "ei", label: "Entreprise individuelle (EI)" },
  { value: "eurl", label: "EURL" },
  { value: "sasu", label: "SASU" },
  { value: "sarl", label: "SARL" },
  { value: "sas", label: "SAS" },
  { value: "autre", label: "Autre (préciser)" },
] as const;

export type ApporteurProfileInput = {
  contactPrenom?: string;
  contactNom?: string;
  contactName?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  addressLine?: string;
  postalCode?: string;
  city?: string;
  siret?: string;
  siren?: string;
  companyLegalName?: string;
  legalForm?: string;
  legalFormOther?: string;
  type?: ApporteurType;
  typeCustomLabel?: string;
};

export function buildContactNameFromParts(prenom?: string, nom?: string): string {
  return [String(prenom || "").trim(), String(nom || "").trim()].filter(Boolean).join(" ");
}

export function splitContactName(full?: string): { contactPrenom: string; contactNom: string } {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { contactPrenom: "", contactNom: "" };
  if (parts.length === 1) return { contactPrenom: parts[0], contactNom: "" };
  return { contactPrenom: parts[0], contactNom: parts.slice(1).join(" ") };
}

export function resolveApporteurTypeLabel(
  apporteur: Pick<Apporteur, "type" | "typeCustomLabel">,
): string {
  if (apporteur.type === "autre" && String(apporteur.typeCustomLabel || "").trim()) {
    return String(apporteur.typeCustomLabel).trim();
  }
  return APPORTEUR_TYPE_LABELS[apporteur.type] || APPORTEUR_TYPE_LABELS.autre;
}

export function resolveLegalFormLabel(
  legalForm?: string,
  legalFormOther?: string,
): string | undefined {
  if (!legalForm) return undefined;
  if (legalForm === "autre" && legalFormOther?.trim()) return legalFormOther.trim();
  return APPORTEUR_LEGAL_FORM_OPTIONS.find((o) => o.value === legalForm)?.label || legalForm;
}

export function formatApporteurDisplayName(
  apporteur: Pick<Apporteur, "contactName" | "contactPrenom" | "contactNom">,
): string {
  const fromParts = buildContactNameFromParts(apporteur.contactPrenom, apporteur.contactNom);
  return fromParts || String(apporteur.contactName || "").trim();
}

export function formatApporteurPostalAddress(
  apporteur: Pick<Apporteur, "addressLine" | "postalCode" | "city">,
): string | undefined {
  const line = String(apporteur.addressLine || "").trim();
  const zip = String(apporteur.postalCode || "").trim();
  const city = String(apporteur.city || "").trim();
  const cityLine = [zip, city].filter(Boolean).join(" ");
  const full = [line, cityLine].filter(Boolean).join(", ");
  return full || undefined;
}

export function normalizeApporteurProfileInput(input: ApporteurProfileInput): Partial<Apporteur> {
  const contactPrenom = String(input.contactPrenom || "").trim();
  const contactNom = String(input.contactNom || "").trim();
  const contactName =
    buildContactNameFromParts(contactPrenom, contactNom) ||
    String(input.contactName || "").trim();
  const type = (input.type || "apporteur_affaires") as ApporteurType;
  const typeCustomLabel =
    type === "autre" ? String(input.typeCustomLabel || "").trim() || undefined : undefined;
  const legalForm = String(input.legalForm || "").trim() || undefined;
  const legalFormOther =
    legalForm === "autre" ? String(input.legalFormOther || "").trim() || undefined : undefined;

  const siret = normalizeSiretInput(String(input.siret || "")) || undefined;
  const siren = extractSirenFromSiret(siret || String(input.siren || "")) || undefined;

  return {
    contactPrenom: contactPrenom || undefined,
    contactNom: contactNom || undefined,
    contactName,
    companyName: String(input.companyName || "").trim(),
    companyLegalName: String(input.companyLegalName || "").trim() || undefined,
    email: String(input.email || "").trim().toLowerCase(),
    phone: String(input.phone || "").trim() || undefined,
    addressLine: String(input.addressLine || "").trim() || undefined,
    postalCode: String(input.postalCode || "").trim() || undefined,
    city: String(input.city || "").trim() || undefined,
    siret,
    siren,
    legalForm,
    legalFormOther,
    type,
    typeCustomLabel,
  };
}

export function validateApporteurProfileForContract(
  apporteur: Pick<
    Apporteur,
    | "contactPrenom"
    | "contactNom"
    | "contactName"
    | "email"
    | "phone"
    | "companyName"
    | "siret"
    | "siren"
    | "addressLine"
    | "postalCode"
    | "city"
    | "type"
    | "typeCustomLabel"
    | "legalForm"
    | "legalFormOther"
  >,
): { ok: true } | { ok: false; error: string } {
  const prenom = String(apporteur.contactPrenom || "").trim();
  const nom = String(apporteur.contactNom || "").trim();
  if (!prenom || prenom.length < 2) {
    return { ok: false, error: "Le prénom est requis." };
  }
  if (!nom || nom.length < 2) {
    return { ok: false, error: "Le nom de famille est requis." };
  }
  if (!String(apporteur.email || "").includes("@")) {
    return { ok: false, error: "L'email est requis." };
  }
  if (!String(apporteur.phone || "").trim()) {
    return { ok: false, error: "Le téléphone est requis." };
  }
  if (!String(apporteur.addressLine || "").trim()) {
    return { ok: false, error: "L'adresse postale est requise." };
  }
  if (!String(apporteur.postalCode || "").trim()) {
    return { ok: false, error: "Le code postal est requis." };
  }
  if (!String(apporteur.city || "").trim()) {
    return { ok: false, error: "La ville est requise." };
  }
  if (apporteur.type === "autre" && !String(apporteur.typeCustomLabel || "").trim()) {
    return { ok: false, error: "Précisez votre statut professionnel (champ « Autre »)." };
  }
  if (apporteur.legalForm === "autre" && !String(apporteur.legalFormOther || "").trim()) {
    return { ok: false, error: "Précisez votre forme juridique (champ « Autre »)." };
  }
  const company = String(apporteur.companyName || "").trim();
  if (company) {
    const siret = normalizeSiretInput(String(apporteur.siret || ""));
    if (!siret) {
      return { ok: false, error: "Le numéro SIRET est requis lorsqu'une société est renseignée." };
    }
    if (!isValidSiret(siret)) {
      return { ok: false, error: "Le numéro SIRET saisi est invalide (14 chiffres)." };
    }
  }
  return { ok: true };
}

export function apporteurProfileToContractPartyBlock(
  apporteur: Pick<
    Apporteur,
    | "contactPrenom"
    | "contactNom"
    | "contactName"
    | "companyName"
    | "companyLegalName"
    | "email"
    | "phone"
    | "addressLine"
    | "postalCode"
    | "city"
    | "siret"
    | "siren"
    | "legalForm"
    | "legalFormOther"
    | "type"
    | "typeCustomLabel"
  >,
): string {
  const name = formatApporteurDisplayName(apporteur);
  const address = formatApporteurPostalAddress(apporteur);
  const legal = resolveLegalFormLabel(apporteur.legalForm, apporteur.legalFormOther);
  const typeLabel = resolveApporteurTypeLabel(apporteur);
  const companyLabel = apporteur.companyLegalName || apporteur.companyName;
  const lines = [
    `${name}${companyLabel ? `, agissant pour le compte de ${companyLabel}` : ""}`,
    address ? `Adresse : ${address}` : undefined,
    `Email : ${apporteur.email}${apporteur.phone ? ` · Tél. : ${apporteur.phone}` : ""}`,
    apporteur.siren ? `SIREN : ${formatSirenDisplay(apporteur.siren)}` : undefined,
    apporteur.siret ? `SIRET : ${formatSiretDisplay(apporteur.siret)}` : undefined,
    legal ? `Forme juridique : ${legal}` : undefined,
    `Statut professionnel déclaré : ${typeLabel}`,
  ].filter(Boolean);
  return lines.join("\n");
}
