export type CertainLoanDocProblem =
  | { kind: "image_not_pdf"; category: "offre" | "tableau"; fileName: string }
  | { kind: "screenshot_filename"; category: "offre" | "tableau"; fileName: string }
  | { kind: "scan_pdf_no_text"; category: "offre" | "tableau"; fileName: string }
  | { kind: "wrong_doc_kind"; category: "offre" | "tableau"; fileName: string; detail: string };

export type LoanDocProblemAssessment = {
  certain: boolean;
  problems: CertainLoanDocProblem[];
  uncertainSignals: string[];
};

function isLoanCategory(cat: unknown): cat is "offre" | "tableau" {
  return cat === "offre" || cat === "tableau";
}

function isImageDoc(doc: any): boolean {
  const name = String(doc?.name || "").toLowerCase();
  const type = String(doc?.type || "").toLowerCase();
  return /\.(png|jpe?g|webp|heic)$/i.test(name) || type.startsWith("image/");
}

function isScreenshotName(name: string): boolean {
  return /(capture|screenshot|screen|whatsapp|photo|img_|image)/i.test(name);
}

function hasScanPdfSignal(doc: any): boolean {
  const reasons: string[] = [
    ...(doc?.loanSignal?.reasons || []),
    ...(doc?.quality?.reasons || []),
  ];
  return reasons.some(
    (r) =>
      /sans texte exploitable/i.test(r) ||
      /scan\/image/i.test(r) ||
      /Impossible de lire le contenu PDF/i.test(r),
  );
}

function hasWrongKindSignal(doc: any): boolean {
  const reasons: string[] = doc?.loanSignal?.reasons || [];
  return reasons.some((r) => /Ressemble plutôt à un tableau/i.test(r) && doc?.category === "offre");
}

/** Problème objectif → relance client ; signaux faibles → traitement manuel. */
export function assessCertainLoanDocProblems(dossier: any): LoanDocProblemAssessment {
  const docs = (dossier?.formData?.documents || []) as any[];
  const problems: CertainLoanDocProblem[] = [];
  const uncertainSignals: string[] = [];

  for (const doc of docs) {
    if (!isLoanCategory(doc?.category)) continue;
    const category = doc.category;
    const fileName = String(doc.name || doc.id || "document");

    if (isImageDoc(doc)) {
      problems.push({ kind: "image_not_pdf", category, fileName });
      continue;
    }

    if (isScreenshotName(fileName)) {
      problems.push({ kind: "screenshot_filename", category, fileName });
      continue;
    }

    if (hasScanPdfSignal(doc)) {
      const ocrValidated =
        doc?.loanSignal?.ocrUsed === true &&
        doc?.loanSignal?.ok === true &&
        Number(doc?.loanSignal?.extractedChars || 0) >= 80;
      if (!ocrValidated) {
        problems.push({ kind: "scan_pdf_no_text", category, fileName });
      }
      continue;
    }

    if (hasWrongKindSignal(doc)) {
      problems.push({
        kind: "wrong_doc_kind",
        category,
        fileName,
        detail: "document reçu ne correspond pas à une offre de prêt",
      });
      continue;
    }

    const qReasons: string[] = doc?.quality?.reasons || [];
    const sigReasons: string[] = doc?.loanSignal?.reasons || [];
    const weakOnly = [...qReasons, ...sigReasons].filter(
      (r) =>
        !/sans texte exploitable/i.test(r) &&
        !/scan\/image/i.test(r) &&
        !/capture|photo|image/i.test(r) &&
        !/Ressemble plutôt/i.test(r),
    );
    if (weakOnly.length > 0) {
      uncertainSignals.push(`${fileName}: ${weakOnly.join("; ")}`);
    }
  }

  const deduped = problems.filter(
    (p, i, arr) =>
      arr.findIndex((x) => x.kind === p.kind && x.category === p.category && x.fileName === p.fileName) === i,
  );

  return {
    certain: deduped.length > 0,
    problems: deduped,
    uncertainSignals: uncertainSignals.slice(0, 8),
  };
}
