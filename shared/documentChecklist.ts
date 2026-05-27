import { classifyFileName, inferDocumentCategory, categoryToChecklistKey } from "./documentClassifier";

export type ChecklistItem = {
  key: string;
  label: string;
  ok: boolean;
  matchedFiles?: string[];
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

function enrichDocuments(documents: any[] = []) {
  const enriched = documents.map((d) => {
    const category = inferDocumentCategory(d);
    return category ? { ...d, category } : { ...d };
  });

  const hasOffre = enriched.some((d) => categoryToChecklistKey(inferDocumentCategory(d)) === "offre");
  const hasTableau = enriched.some((d) => inferDocumentCategory(d) === "tableau");
  if (!hasOffre && hasTableau && enriched.length >= 2) {
    const unknown = enriched.filter((d) => !inferDocumentCategory(d));
    if (unknown.length === 1) {
      unknown[0].category = "offre";
      return enriched.map((d) => (d.id === unknown[0].id ? { ...d, category: "offre" } : d));
    }
  }

  return enriched;
}

/** Checklist basée sur id/catégorie/nom de fichier (formulaire + Gmail). */
export function computeDocumentChecklist(documents: any[] = []): ChecklistItem[] {
  const docs = enrichDocuments(documents);

  const matched: Record<string, string[]> = { cni: [], rib: [], offre: [], amort: [] };

  for (const d of docs) {
    const name = String(d.name || d.id || "document");
    const category = inferDocumentCategory(d);
    const key = categoryToChecklistKey(category) || (category === "autre" ? null : null);

    if (key && matched[key]) {
      matched[key].push(name);
      continue;
    }

    if (category === "fiche") {
      matched.offre.push(name);
      continue;
    }

    const n = docName(d);
    const id = docId(d);

    if (
      n.includes("cni") ||
      n.includes("identit") ||
      n.includes("passeport") ||
      id.startsWith("cni-")
    ) {
      matched.cni.push(name);
    }
    if (n.includes("rib") || n.includes("iban") || id.startsWith("rib-")) {
      matched.rib.push(name);
    }
    if (id.startsWith("offre-") || id.startsWith("fiche-")) {
      matched.offre.push(name);
    } else if (id.startsWith("tableau-")) {
      matched.amort.push(name);
    } else {
      const guessed = classifyFileName(name);
      const gKey = categoryToChecklistKey(guessed);
      if (gKey && matched[gKey]) matched[gKey].push(name);
    }
  }

  const hasCni = matched.cni.length > 0;
  const hasRib = matched.rib.length > 0;
  const hasOffrePret = matched.offre.length > 0;
  const hasAmortissement = matched.amort.length > 0;

  return [
    {
      key: "cni",
      label: "Pièce d'identité (CNI/Passeport)",
      ok: hasCni,
      matchedFiles: matched.cni,
    },
    {
      key: "rib",
      label: "RIB",
      ok: hasRib,
      matchedFiles: matched.rib,
    },
    {
      key: "offre",
      label: "Offre de prêt",
      ok: hasOffrePret,
      matchedFiles: matched.offre,
    },
    {
      key: "amort",
      label: "Tableau d'amortissement",
      ok: hasAmortissement,
      matchedFiles: matched.amort,
    },
  ];
}

export function getBlockingMissingLabels(documents: any[] = []) {
  return computeDocumentChecklist(documents)
    .filter((i) => !i.ok && (i.key === "cni" || i.key === "rib"))
    .map((i) => i.label);
}
