export const KNOWN_DOCUMENT_CATEGORIES = [
  "cni",
  "rib",
  "offre",
  "tableau",
  "fiche",
  "devis",
  "etude",
  "autre",
] as const;

export type DocumentCategory = (typeof KNOWN_DOCUMENT_CATEGORIES)[number];

function normalize(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function isKnownDocumentCategory(value: unknown): value is DocumentCategory {
  return (KNOWN_DOCUMENT_CATEGORIES as readonly string[]).includes(normalize(value));
}

function isIdentityDocName(n: string): boolean {
  if (n.includes("cni")) return true;
  if (n.includes("passeport")) return true;
  if (n.includes("piece") && n.includes("identit")) return true;
  if (n.includes("carte") && n.includes("identit") && !n.includes("bancair")) return true;
  if (n.includes("justificatif") && n.includes("ident")) return true;
  if (n.includes("titre") && n.includes("sejour")) return true;
  if (n.includes("id_recto") || n.includes("id_verso")) return true;
  if (
    (n.includes("recto") || n.includes("verso")) &&
    (n.includes("cni") || n.includes("identit") || n.includes("passeport"))
  ) {
    return true;
  }
  // « identité » seule, mais pas « identité bancaire » / RIB / devis
  if (
    n.includes("identit") &&
    !n.includes("bancair") &&
    !n.includes("iban") &&
    !n.includes("rib") &&
    !n.includes("devis")
  ) {
    return true;
  }
  return false;
}

export function classifyFileName(filename: string): DocumentCategory | null {
  const n = normalize(filename);
  if (!n || n.length < 2) return null;

  // Étude / devis avant CNI & offre (évite « devis identité » / noms ambigus)
  if (
    n.includes("etude") ||
    n.includes("economie") ||
    n.includes("economies") ||
    n.includes("ade_study") ||
    n.includes("study_pdf") ||
    n.includes("study-pdf")
  ) {
    return "etude";
  }

  if (n.includes("devis") || n.includes("quotation") || n.includes("tarifaire")) {
    return "devis";
  }

  // RIB avant CNI : « relevé d'identité bancaire » contient « identit »
  if (
    n.includes("rib") ||
    n.includes("iban") ||
    n.includes("releve identite bancaire") ||
    n.includes("releve de compte") ||
    n.includes("coordonnees bancaires") ||
    n.includes("attestation bancaire") ||
    (n.includes("bancaire") && !n.includes("pret") && !n.includes("credit") && !n.includes("emprunt"))
  ) {
    return "rib";
  }

  if (isIdentityDocName(n)) {
    return "cni";
  }

  // Tableau avant offre (évite "tableau de crédit" classé en offre)
  if (
    n.includes("tableau") ||
    n.includes("amort") ||
    n.includes("echeancier") ||
    n.includes("echeance") ||
    n.includes("mensualite")
  ) {
    return "tableau";
  }

  if (
    n.includes("fiche") &&
    (n.includes("standard") ||
      n.includes("information") ||
      n.includes("fsi") ||
      n.includes("europeenne") ||
      n.includes("europeen"))
  ) {
    return "fiche";
  }

  if (
    n.includes("offre") ||
    n.includes("emprunt") ||
    (n.includes("pret") && !n.includes("tableau")) ||
    (n.includes("contrat") &&
      (n.includes("pret") || n.includes("credit") || n.includes("emprunt"))) ||
    n.includes("financement") ||
    n.includes("convention") ||
    n.includes("offrepret") ||
    n.includes("loan") ||
    n.includes("credit immobilier")
  ) {
    return "offre";
  }

  return null;
}

/**
 * Résout la catégorie d'un document.
 * Priorité : override manuel admin → catégorie déjà stockée (connue) → préfixe d'id → nom de fichier.
 * Les changements manuels (categoryManual) ne doivent jamais être écrasés.
 */
export function inferDocumentCategory(doc: {
  id?: string;
  name?: string;
  category?: string;
  categoryManual?: boolean;
}): DocumentCategory | null {
  const explicit = doc.category ? normalize(doc.category) : "";

  if (doc.categoryManual && explicit) {
    return isKnownDocumentCategory(explicit) ? explicit : "autre";
  }

  // Toute catégorie connue déjà stockée gagne (devis / etude / autre inclus).
  if (isKnownDocumentCategory(explicit)) {
    return explicit;
  }

  const id = String(doc.id || "");
  for (const prefix of ["etude", "devis", "tableau", "offre", "fiche", "cni", "rib"] as const) {
    if (id.startsWith(`${prefix}-`)) return prefix;
  }

  return classifyFileName(doc.name || "");
}

export function categoryToChecklistKey(category: DocumentCategory | null): string | null {
  if (!category || category === "autre" || category === "fiche" || category === "devis" || category === "etude") {
    return null;
  }
  // Les slots checklist utilisent « amort », pas « tableau ».
  if (category === "tableau") return "amort";
  return category;
}
