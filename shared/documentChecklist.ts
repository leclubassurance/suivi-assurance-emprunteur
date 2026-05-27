export type ChecklistItem = {
  key: string;
  label: string;
  ok: boolean;
};

function normalize(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function docId(doc: any) {
  return String(doc?.id || "");
}

function docName(doc: any) {
  return normalize(doc?.name);
}

/** Matches how DocumentsStep stores files: id prefix offre-, tableau-, fiche- */
export function computeDocumentChecklist(documents: any[] = []): ChecklistItem[] {
  const hasByCategory = (prefix: string) => documents.some((d) => docId(d).startsWith(`${prefix}-`));

  const names = documents.map(docName);

  const hasCNI = names.some(
    (n) =>
      n.includes("cni") ||
      n.includes("identit") ||
      (n.includes("piece") && n.includes("identit")) ||
      n.includes("passeport") ||
      (n.includes("carte") && n.includes("identit")),
  );
  const hasRib = names.some((n) => n.includes("rib") || n.includes("iban"));

  const hasOffrePret =
    hasByCategory("offre") ||
    names.some(
      (n) =>
        (n.includes("offre") && (n.includes("pret") || n.includes("prêt") || n.includes("credit"))) ||
        (n.includes("contrat") && (n.includes("pret") || n.includes("prêt") || n.includes("credit"))) ||
        n.includes("offrepret"),
    );

  const hasAmortissement =
    hasByCategory("tableau") ||
    names.some(
      (n) =>
        n.includes("amort") ||
        (n.includes("tableau") && (n.includes("amort") || n.includes("pret") || n.includes("credit"))) ||
        n.includes("echeancier"),
    );

  return [
    { key: "cni", label: "Pièce d'identité (CNI/Passeport)", ok: hasCNI },
    { key: "rib", label: "RIB", ok: hasRib },
    { key: "offre", label: "Offre de prêt", ok: hasOffrePret },
    { key: "amort", label: "Tableau d'amortissement", ok: hasAmortissement },
  ];
}

export function getBlockingMissingLabels(documents: any[] = []) {
  return computeDocumentChecklist(documents)
    .filter((i) => !i.ok && (i.key === "cni" || i.key === "rib"))
    .map((i) => i.label);
}
