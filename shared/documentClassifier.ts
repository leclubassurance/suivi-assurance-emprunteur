export type DocumentCategory = "cni" | "rib" | "offre" | "tableau" | "fiche" | "autre";

function normalize(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function classifyFileName(filename: string): DocumentCategory | null {
  const n = normalize(filename);
  if (!n || n.length < 2) return null;

  if (
    n.includes("cni") ||
    n.includes("identit") ||
    (n.includes("piece") && n.includes("identit")) ||
    n.includes("passeport") ||
    (n.includes("carte") && n.includes("identit")) ||
    n.includes("id_recto") ||
    n.includes("id_verso")
  ) {
    return "cni";
  }

  if (n.includes("rib") || n.includes("iban") || n.includes("releve identite bancaire")) {
    return "rib";
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
    n.includes("proposition") ||
    n.includes("simulation") ||
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

export function inferDocumentCategory(doc: {
  id?: string;
  name?: string;
  category?: string;
}): DocumentCategory | null {
  const explicit = doc.category ? normalize(doc.category) : "";
  if (
    explicit === "cni" ||
    explicit === "rib" ||
    explicit === "offre" ||
    explicit === "tableau" ||
    explicit === "fiche"
  ) {
    return explicit as DocumentCategory;
  }

  const id = String(doc.id || "");
  for (const prefix of ["tableau", "offre", "fiche", "cni", "rib"] as const) {
    if (id.startsWith(`${prefix}-`)) return prefix;
  }

  return classifyFileName(doc.name || "");
}

export function categoryToChecklistKey(category: DocumentCategory | null): string | null {
  if (!category || category === "autre" || category === "fiche") return null;
  return category;
}
