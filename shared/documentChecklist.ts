import { classifyFileName, inferDocumentCategory, categoryToChecklistKey } from "./documentClassifier";
import { assessCertainLoanDocProblems } from "./loanDocCertainty";

export type ChecklistDocStatus = "missing" | "review" | "ok";

export type ChecklistItem = {
  key: string;
  label: string;
  /** Fichier reçu pour cette catégorie */
  ok: boolean;
  status: ChecklistDocStatus;
  matchedFiles?: string[];
  reviewHint?: string;
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

  const base: ChecklistItem[] = [
    {
      key: "cni",
      label: "Pièce d'identité (CNI/Passeport)",
      ok: matched.cni.length > 0,
      status: matched.cni.length > 0 ? "ok" : "missing",
      matchedFiles: matched.cni,
    },
    {
      key: "rib",
      label: "RIB",
      ok: matched.rib.length > 0,
      status: matched.rib.length > 0 ? "ok" : "missing",
      matchedFiles: matched.rib,
    },
    {
      key: "offre",
      label: "Offre de prêt",
      ok: matched.offre.length > 0,
      status: matched.offre.length > 0 ? "ok" : "missing",
      matchedFiles: matched.offre,
    },
    {
      key: "amort",
      label: "Tableau d'amortissement",
      ok: matched.amort.length > 0,
      status: matched.amort.length > 0 ? "ok" : "missing",
      matchedFiles: matched.amort,
    },
  ];

  return applyChecklistReviewStatus(base, docs);
}

function loanCategoryForKey(key: string): "offre" | "tableau" | null {
  if (key === "offre") return "offre";
  if (key === "amort") return "tableau";
  return null;
}

function reviewHintForProblem(kind: string): string {
  if (kind === "image_not_pdf" || kind === "screenshot_filename") {
    return "Capture ou image — PDF banque attendu";
  }
  if (kind === "scan_pdf_no_text") return "PDF peu lisible — PDF banque conseillé";
  if (kind === "wrong_doc_kind") return "Type de document douteux";
  return "À confirmer par l'équipe";
}

function loanDocsForCategory(documents: any[], loanCat: "offre" | "tableau") {
  return documents.filter((d) => {
    const c = inferDocumentCategory(d);
    return c === loanCat || (loanCat === "offre" && c === "fiche");
  });
}

function statusFromLoanSignals(catDocs: any[]): Pick<ChecklistItem, "status" | "reviewHint"> | null {
  const sigs = catDocs.map((d) => d?.loanSignal).filter(Boolean);
  if (!sigs.length) return null;

  const validated = sigs.find((s) => s.ok && s.matchesExpected);
  if (validated) {
    return {
      status: "ok",
      reviewHint: validated.adminLabel || validated.summary,
    };
  }

  const best = sigs[0];
  return {
    status: "review",
    reviewHint: best.adminLabel || best.summary || "Analyse automatique : document à confirmer",
  };
}

function applyChecklistReviewStatus(items: ChecklistItem[], documents: any[]): ChecklistItem[] {
  const assessment = assessCertainLoanDocProblems({ formData: { documents } });

  return items.map((item) => {
    if (!item.ok) return { ...item, status: "missing" as const };

    const loanCat = loanCategoryForKey(item.key);
    if (loanCat) {
      const catDocs = loanDocsForCategory(documents, loanCat);
      const fromSignal = statusFromLoanSignals(catDocs);
      if (fromSignal) {
        return { ...item, status: fromSignal.status, reviewHint: fromSignal.reviewHint };
      }

      const catProblems = assessment.problems.filter((p) => p.category === loanCat);
      if (catProblems.length > 0) {
        return {
          ...item,
          status: "review" as const,
          reviewHint: reviewHintForProblem(catProblems[0].kind),
        };
      }
      if (catDocs.some((d) => d?.quality?.ok === false)) {
        return {
          ...item,
          status: "review" as const,
          reviewHint: "Qualité du fichier à vérifier",
        };
      }
      return { ...item, status: "ok" as const };
    }

    if (item.key === "cni" || item.key === "rib") {
      const cat = item.key === "cni" ? "cni" : "rib";
      const catDocs = documents.filter((d) => inferDocumentCategory(d) === cat);
      if (catDocs.some((d) => d?.quality?.ok === false)) {
        return {
          ...item,
          status: "review" as const,
          reviewHint: "Qualité du fichier à vérifier",
        };
      }
    }

    return { ...item, status: "ok" as const };
  });
}

export function getBlockingMissingLabels(documents: any[] = []) {
  return computeDocumentChecklist(documents)
    .filter((i) => !i.ok && (i.key === "cni" || i.key === "rib"))
    .map((i) => i.label);
}

/** Relances automatiques avant étude : uniquement offre + tableau (pas CNI/RIB). */
export function getPreStudyLoanReminderLabels(documents: any[] = []) {
  const checklist = computeDocumentChecklist(documents);
  const labels: string[] = [];
  for (const item of checklist) {
    if (item.key !== "offre" && item.key !== "amort") continue;
    if (item.status === "ok") continue;
    if (item.status === "missing") {
      labels.push(
        item.key === "offre"
          ? "Offre de prêt (PDF complet depuis votre espace bancaire)"
          : "Tableau d'amortissement / échéancier complet (PDF banque)",
      );
    } else if (item.status === "review") {
      labels.push(
        item.reviewHint
          ? `${item.label} — ${item.reviewHint}`
          : `${item.label} — merci de renvoyer un PDF complet depuis votre banque`,
      );
    }
  }
  return labels;
}

/** Après envoi de l'étude : pièces d'identité et RIB pour la souscription. */
export function getPostStudyIdentityReminderLabels(documents: any[] = []) {
  return getBlockingMissingLabels(documents);
}
