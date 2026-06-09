import { classifyFileName, inferDocumentCategory, categoryToChecklistKey } from "./documentClassifier";
import { assessCertainLoanDocProblems } from "./loanDocCertainty";
import {
  applyAdminChecklistOverrides,
  getAdminChecklistOverrides,
  type AdminChecklistOverride,
} from "./adminDocValidation";

export type { AdminChecklistOverride } from "./adminDocValidation";
export { getAdminChecklistOverrides, applyAdminChecklistOverrides } from "./adminDocValidation";

export type ChecklistDocStatus = "missing" | "review" | "ok";

export type ChecklistFileRow = {
  docId: string;
  name: string;
  category: string;
  status: ChecklistDocStatus;
  reviewHint?: string;
};

export type ChecklistItem = {
  key: string;
  label: string;
  /** Fichier reçu pour cette catégorie */
  ok: boolean;
  status: ChecklistDocStatus;
  matchedFiles?: string[];
  /** Détail par fichier (admin / portail étendu) */
  files?: ChecklistFileRow[];
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

function loanDocsSatisfied(enriched: any[]): boolean {
  const hasOffre = enriched.some((d) => {
    const c = getCategory(d);
    return c === "offre" || c === "fiche" || docId(d).startsWith("offre-") || docId(d).startsWith("fiche-");
  });
  const hasTableau = enriched.some(
    (d) => getCategory(d) === "tableau" || docId(d).startsWith("tableau-"),
  );
  return hasOffre && hasTableau;
}

/** Après étude : offre + tableau OK → les PJ Gmail sans nom explicite sont souvent CNI + RIB. */
function enrichPostStudyIdentitySlots(enriched: any[]): any[] {
  if (!loanDocsSatisfied(enriched)) return enriched;

  const hasCni = enriched.some((d) => getCategory(d) === "cni");
  const hasRib = enriched.some((d) => getCategory(d) === "rib");
  if (hasCni && hasRib) return enriched;

  let unknown = enriched.filter((d) => !getCategory(d));
  if (unknown.length === 0) return enriched;

  const assignCategory = (doc: any, category: "cni" | "rib") => {
    enriched = enriched.map((d) =>
      d.id === doc.id && d.name === doc.name ? { ...d, category } : d,
    );
    unknown = unknown.filter((u) => u.id !== doc.id || u.name !== doc.name);
  };

  for (const doc of [...unknown]) {
    const guess = classifyFileName(doc.name || "");
    if (guess === "cni" && !hasCni && !enriched.some((d) => getCategory(d) === "cni")) {
      assignCategory(doc, "cni");
    } else if (guess === "rib" && !hasRib && !enriched.some((d) => getCategory(d) === "rib")) {
      assignCategory(doc, "rib");
    }
  }

  const stillUnknown = enriched.filter((d) => !getCategory(d));
  const stillNeedsCni = !enriched.some((d) => getCategory(d) === "cni");
  const stillNeedsRib = !enriched.some((d) => getCategory(d) === "rib");

  const isImageLike = (doc: any) => {
    const name = docName(doc);
    const type = String(doc?.type || "").toLowerCase();
    return (
      /\.(jpe?g|png|heic|webp|tif|tiff)$/i.test(name) ||
      type.startsWith("image/") ||
      /^img[_-]|^scan[_-]|^photo[_-]|^image[_-]/i.test(name)
    );
  };

  if (stillNeedsCni && stillUnknown.length > 0) {
    const pick =
      stillUnknown.find((d) => classifyFileName(d.name || "") === "cni") ||
      stillUnknown.find(isImageLike) ||
      stillUnknown[0];
    if (pick) assignCategory(pick, "cni");
  }

  const afterCni = enriched.filter((d) => !getCategory(d));
  if (stillNeedsRib && afterCni.length > 0) {
    const pick =
      afterCni.find((d) => classifyFileName(d.name || "") === "rib") ||
      afterCni.find((d) => !isImageLike(d)) ||
      afterCni[0];
    if (pick) assignCategory(pick, "rib");
  }

  return enriched;
}

function isStudyLikelySent(dossier: { status?: string; studyKpi?: { extractedAt?: string }; communications?: any[] }): boolean {
  if (dossier?.studyKpi?.extractedAt) return true;
  const st = String(dossier?.status || "").toUpperCase();
  if (["MAIL_ENVOYÉ", "MAIL_ENVOYE", "TRAITÉ", "TRAITE", "CLOS"].includes(st)) return true;
  for (const c of dossier?.communications || []) {
    if (c?.direction !== "outbound") continue;
    const blob = `${c.subject || ""} ${c.text || ""}`.toLowerCase();
    if (
      /charles victor|club immobilier/.test(blob) &&
      /économie|economie|étude|etude|optimisée|optimisee/.test(blob)
    ) {
      return true;
    }
  }
  return false;
}

function enrichDocuments(documents: any[] = [], options?: { studySent?: boolean }) {
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

  if (options?.studySent) {
    enriched = enrichPostStudyIdentitySlots(enriched);
  }

  return enriched;
}

/** Checklist basée sur id/catégorie/nom de fichier (formulaire + Gmail). */
export function computeDocumentChecklist(
  documents: any[] = [],
  options?: { adminOverrides?: Record<string, AdminChecklistOverride>; studySent?: boolean },
): ChecklistItem[] {
  const docs = enrichDocuments(documents, { studySent: options?.studySent });

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
      continue;
    }

    const n = docName(d);
    const id = docId(d);

    if (
      id.startsWith("cni-") ||
      classifyFileName(name) === "cni"
    ) {
      matched.cni.push(name);
    }
    if (n.includes("rib") || n.includes("iban") || id.startsWith("rib-")) {
      matched.rib.push(name);
    }
    if (id.startsWith("offre-")) {
      matched.offre.push(name);
    } else if (id.startsWith("fiche-")) {
      // fiche gérée à part (ne compte pas comme offre si une vraie offre existe)
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

  const offreDocNames = docs
    .filter((d) => getCategory(d) === "offre")
    .map((d) => String(d.name || d.id || "document"));
  const ficheDocNames = docs
    .filter((d) => getCategory(d) === "fiche")
    .map((d) => String(d.name || d.id || "document"));
  const hasRealOffre = offreDocNames.length > 0;
  const offreMatched = hasRealOffre ? offreDocNames : ficheDocNames;

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
      ok: offreMatched.length > 0,
      status: offreMatched.length > 0 ? "ok" : "missing",
      matchedFiles: offreMatched,
      reviewHint:
        !hasRealOffre && ficheDocNames.length > 0
          ? "Fiche standardisée reçue — en attente de l'offre de prêt complète (PDF banque)"
          : undefined,
    },
    {
      key: "amort",
      label: "Tableau d'amortissement",
      ok: matched.amort.length > 0,
      status: matched.amort.length > 0 ? "ok" : "missing",
      matchedFiles: matched.amort,
    },
  ];

  let reviewed = applyChecklistReviewStatus(base, docs);
  reviewed = attachPerFileRows(reviewed, docs);
  if (options?.adminOverrides && Object.keys(options.adminOverrides).length > 0) {
    return applyAdminChecklistOverrides(reviewed, options.adminOverrides);
  }
  return reviewed;
}

/** Persiste les catégories inférées (ex. image0.jpeg → CNI après étude) dans formData.documents. */
export function persistInferredDocumentCategories(dossier: {
  formData?: { documents?: any[] };
  status?: string;
  studyKpi?: { extractedAt?: string };
  communications?: any[];
}): number {
  const docs = dossier?.formData?.documents;
  if (!Array.isArray(docs) || docs.length === 0) return 0;

  const studySent = isStudyLikelySent(dossier);
  const enriched = enrichDocuments(docs, { studySent });
  const enrichedByKey = new Map(
    enriched.map((d) => [`${docId(d)}\0${docName(d)}`, d]),
  );

  let changed = 0;
  dossier.formData!.documents = docs.map((orig) => {
    const key = `${docId(orig)}\0${docName(orig)}`;
    const inf = enrichedByKey.get(key);
    if (!inf) return orig;
    const newCat = inferDocumentCategory(inf);
    const oldCat = inferDocumentCategory(orig);
    if (newCat && newCat !== "autre" && newCat !== oldCat) {
      changed++;
      return { ...orig, category: newCat };
    }
    if (!orig.category && newCat && newCat !== "autre") {
      changed++;
      return { ...orig, category: newCat };
    }
    return orig;
  });
  return changed;
}

/** Checklist avec validations manuelles admin (Firestore). */
export function computeDocumentChecklistForDossier(dossier: {
  formData?: { documents?: any[] };
  adminChecklistOverrides?: Record<string, AdminChecklistOverride>;
  status?: string;
  studyKpi?: { extractedAt?: string };
  communications?: any[];
}): ChecklistItem[] {
  return computeDocumentChecklist(dossier?.formData?.documents || [], {
    adminOverrides: getAdminChecklistOverrides(dossier),
    studySent: isStudyLikelySent(dossier),
  });
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
  const hasRealOffre = documents.some((d) => inferDocumentCategory(d) === "offre");
  return documents.filter((d) => {
    const c = inferDocumentCategory(d);
    if (loanCat === "offre") {
      if (c === "offre") return true;
      if (c === "fiche" && !hasRealOffre) return true;
      return false;
    }
    return c === loanCat;
  });
}

function fileStatusFromDoc(doc: any, slot: "offre" | "tableau" | "cni" | "rib"): ChecklistDocStatus {
  const cat = inferDocumentCategory(doc) || "autre";
  if (slot === "offre" || slot === "amort") {
    const sig = doc?.loanSignal;
    if (sig?.ok && sig?.matchesExpected !== false) return "ok";
    if (sig && (sig.ok === false || sig.matchesExpected === false)) return "review";
    if (doc?.quality?.ok === false) return "review";
    return "ok";
  }
  if (cat === slot) return doc?.quality?.ok === false ? "review" : "ok";
  return "review";
}

function fileReviewHint(doc: any, slot: "offre" | "tableau" | "cni" | "rib"): string | undefined {
  if (slot === "offre" || slot === "amort") {
    return doc?.loanSignal?.adminLabel || doc?.loanSignal?.summary || undefined;
  }
  if (doc?.quality?.ok === false) return "Qualité du fichier à vérifier";
  return undefined;
}

function slotDocumentsForKey(documents: any[], key: string): any[] {
  if (key === "cni") return documents.filter((d) => inferDocumentCategory(d) === "cni");
  if (key === "rib") return documents.filter((d) => inferDocumentCategory(d) === "rib");
  if (key === "amort") {
    return documents.filter(
      (d) => inferDocumentCategory(d) === "tableau" || docId(d).startsWith("tableau-"),
    );
  }
  if (key === "offre") {
    const offre = documents.filter((d) => inferDocumentCategory(d) === "offre");
    const fiche = documents.filter((d) => inferDocumentCategory(d) === "fiche");
    return offre.length > 0 ? [...offre, ...fiche] : [...fiche, ...offre];
  }
  return [];
}

function attachPerFileRows(items: ChecklistItem[], documents: any[]): ChecklistItem[] {
  return items.map((item) => {
    const slotDocs = slotDocumentsForKey(documents, item.key);
    if (slotDocs.length === 0) return item;

    const slot = item.key === "amort" ? "tableau" : item.key;
    const files: ChecklistFileRow[] = slotDocs.map((d) => {
      const cat = String(inferDocumentCategory(d) || d.category || "autre");
      const st = fileStatusFromDoc(d, slot as "offre" | "tableau" | "cni" | "rib");
      return {
        docId: String(d.id || d.name || ""),
        name: String(d.name || d.id || "document"),
        category: cat,
        status: st,
        reviewHint:
          cat === "fiche"
            ? "Fiche standardisée d'information (complément, pas l'offre de prêt seule)"
            : fileReviewHint(d, slot as "offre" | "tableau" | "cni" | "rib"),
      };
    });

    const anyOk = files.some((f) => f.status === "ok");
    const anyReview = files.some((f) => f.status === "review");
    let status = item.status;
    let ok = item.ok;
    if (item.key === "offre" || item.key === "amort") {
      ok = anyOk;
      status = !anyOk && files.length > 0 ? "review" : anyReview && !anyOk ? "review" : anyOk ? "ok" : "missing";
    }

    return {
      ...item,
      ok,
      status,
      files,
      matchedFiles: files.map((f) => f.name),
    };
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

/** Après accord client pour le changement : pièces d'identité et RIB pour la souscription. */
export function getPostStudyIdentityReminderLabels(documents: any[] = []) {
  return getBlockingMissingLabels(documents);
}
