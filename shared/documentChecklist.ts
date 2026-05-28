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

function getCategory(d: any): string | null {
  return inferDocumentCategory(d);
}

function enrichDocuments(documents: any[] = []) {
  let enriched = documents.map((d) => {
    const category = inferDocumentCategory(d);
    return category ? { ...d, category } : { ...d };
  });

  const hasOffre = enriched.some((d) => {
    const c = getCategory(d);
    return c === "offre" || c === "fiche" || docId(d).startsWith("offre-") || docId(d).startsWith("fiche-");
  });
  const hasTableau = enriched.some(
    (d) => getCategory(d) === "tableau" || docId(d).startsWith("tableau-"),
  );

  const unknown = enriched.filter((d) => !getCategory(d));

  if (hasOffre && !hasTableau && unknown.length >= 1) {
    const target = unknown[0];
    enriched = enriched.map((d) =>
      d.id === target.id && d.name === target.name ? { ...d, category: "tableau" } : d,
    );
  } else if (!hasOffre && hasTableau && unknown.length >= 1) {
    const target = unknown[0];
    enriched = enriched.map((d) =>
      d.id === target.id && d.name === target.name ? { ...d, category: "offre" } : d,
    );
  } else if (!hasOffre && !hasTableau && unknown.length >= 2) {
    enriched = enriched.map((d, idx) => {
      const uIdx = unknown.indexOf(d);
      if (uIdx === 0) return { ...d, category: "offre" };
      if (uIdx === 1) return { ...d, category: "tableau" };
      return d;
    });
  } else if (!hasTableau && unknown.length === 1 && enriched.length >= 2 && hasOffre) {
    const onlyUnknown = unknown[0];
    const tableauById = enriched.some((d) => docId(d).startsWith("tableau-"));
    if (!tableauById) {
      enriched = enriched.map((d) =>
        d.id === onlyUnknown.id && d.name === onlyUnknown.name
          ? { ...d, category: "tableau" }
          : d,
      );
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
    const category = getCategory(d);
    const checklistKey = categoryToChecklistKey(category as any);

    if (checklistKey && matched[checklistKey]) {
      matched[checklistKey].push(name);
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

  if (matched.offre.length === 0 && matched.amort.length === 0) {
    const loanPdfs = docs.filter((d) => {
      const cat = getCategory(d);
      if (cat === "cni" || cat === "rib") return false;
      const name = String(d.name || d.id || "").toLowerCase();
      return /\.pdf$/i.test(name) || String(d.type || "").toLowerCase().includes("pdf");
    });
    if (loanPdfs.length >= 2) {
      matched.offre.push(String(loanPdfs[0].name || loanPdfs[0].id || "document"));
      matched.amort.push(String(loanPdfs[1].name || loanPdfs[1].id || "document"));
    }
  }

  return [
    {
      key: "cni",
      label: "Pièce d'identité (CNI/Passeport)",
      ok: matched.cni.length > 0,
      matchedFiles: matched.cni,
    },
    {
      key: "rib",
      label: "RIB",
      ok: matched.rib.length > 0,
      matchedFiles: matched.rib,
    },
    {
      key: "offre",
      label: "Offre de prêt",
      ok: matched.offre.length > 0,
      matchedFiles: matched.offre,
    },
    {
      key: "amort",
      label: "Tableau d'amortissement",
      ok: matched.amort.length > 0,
      matchedFiles: matched.amort,
    },
  ];
}

export function getBlockingMissingLabels(documents: any[] = []) {
  return computeDocumentChecklist(documents)
    .filter((i) => !i.ok && (i.key === "cni" || i.key === "rib"))
    .map((i) => i.label);
}
