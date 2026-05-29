export type LoanDocKind = "offre" | "tableau" | "unknown";

export type LoanDocSignalShape = {
  ok: boolean;
  kind: LoanDocKind;
  reasons: string[];
  keywords: string[];
  ocrUsed?: boolean;
  textSource?: "pdf_native" | "ocr" | "ocr_image";
  extractedChars?: number;
  summary?: string;
  adminLabel?: string;
  clientHint?: string;
  confidence?: "high" | "medium" | "low";
  matchesExpected?: boolean;
  expectedKind?: LoanDocKind;
  detectedLabel?: string;
};

const KIND_LABELS: Record<LoanDocKind, string> = {
  offre: "Offre de prêt",
  tableau: "Tableau d'amortissement",
  unknown: "Type non identifié",
};

function textSourceLabel(src?: string) {
  if (src === "ocr_image") return "OCR (image)";
  if (src === "ocr") return "OCR (PDF scan)";
  if (src === "pdf_native") return "PDF (texte natif)";
  return "analyse automatique";
}

/** Enrichit le signal technique avec libellés compréhensibles (admin + Camille). */
export function enrichLoanDocSignal(
  base: Omit<LoanDocSignalShape, "summary" | "adminLabel" | "clientHint" | "confidence" | "matchesExpected" | "expectedKind" | "detectedLabel">,
  expected: "offre" | "tableau",
  meta?: { fileName?: string },
): LoanDocSignalShape {
  const expectedKind = expected;
  const matchesExpected =
    base.ok &&
    (base.kind === expected ||
      (expected === "offre" &&
        base.kind === "tableau" &&
        !(base.reasons || []).some((r) => /tableau d'amortissement seul/i.test(r))));
  const detectedLabel = KIND_LABELS[base.kind] || KIND_LABELS.unknown;
  const readLabel = textSourceLabel(base.textSource);
  const chars = base.extractedChars ?? 0;

  let confidence: LoanDocSignalShape["confidence"] = "low";
  if (base.ok && matchesExpected) confidence = base.ocrUsed ? "high" : "high";
  else if (base.kind !== "unknown" && base.kind !== expected) confidence = "medium";
  else if (chars >= 200) confidence = "medium";

  let adminLabel = "";
  let clientHint = "";
  let summary = "";

  if (base.ok && matchesExpected) {
    adminLabel = `Validé — ${detectedLabel} confirmé (${readLabel})`;
    summary = `${detectedLabel} : contenu cohérent (${chars} caractères lus${base.ocrUsed ? ", via OCR" : ""}).`;
    clientHint =
      expected === "offre"
        ? "Nous avons bien identifié votre offre de prêt ; Charles peut s'appuyer dessus pour l'étude."
        : "Nous avons bien identifié votre tableau d'amortissement ; Charles peut s'appuyer dessus pour l'étude.";
  } else if (
    base.kind !== "unknown" &&
    base.kind !== expected &&
    !(expected === "offre" && matchesExpected)
  ) {
    adminLabel = `À vérifier — ressemble à un ${KIND_LABELS[base.kind]}, pas à une ${KIND_LABELS[expected]}`;
    summary = `Le fichier reçu en « ${KIND_LABELS[expected]} » semble plutôt être un ${KIND_LABELS[base.kind]}.`;
    clientHint = `Pour avancer, merci de renvoyer le bon document : ${KIND_LABELS[expected]} en PDF depuis votre espace bancaire.`;
    confidence = "medium";
  } else if (base.ocrUsed && chars > 0 && !base.ok) {
    adminLabel = `OCR effectué — contenu insuffisant pour valider une ${KIND_LABELS[expected]}`;
    summary = `Texte partiellement lu (${chars} car.) mais critères ${KIND_LABELS[expected]} non confirmés.`;
    clientHint = `Nous avons pu lire une partie du document ; pour être précis, merci de renvoyer un PDF complet de votre ${KIND_LABELS[expected].toLowerCase()} depuis votre banque en ligne.`;
    confidence = "medium";
  } else if (base.textSource === "ocr_image" || /\.(png|jpe?g)/i.test(meta?.fileName || "")) {
    adminLabel = "Capture / image — PDF banque requis";
    summary = "Fichier image : merci d'envoyer le PDF téléchargé depuis l'application bancaire.";
    clientHint =
      "Pour que Charles finalise votre étude, il nous faut le PDF complet depuis votre espace client (pas une capture d'écran).";
    confidence = "low";
  } else if (/sans texte|illisible|scan/i.test((base.reasons || []).join(" "))) {
    adminLabel = "PDF peu lisible — renvoi PDF banque conseillé";
    summary = "Peu ou pas de texte exploitable : PDF complet depuis la banque en ligne recommandé.";
    clientHint =
      "Si possible, merci de télécharger à nouveau l'offre de prêt et le tableau d'amortissement en PDF depuis votre banque (fichiers complets, pas des photos).";
    confidence = "low";
  } else {
    adminLabel = `À vérifier — ${(base.reasons || [])[0] || "analyse incomplète"}`;
    summary = (base.reasons || []).slice(0, 2).join(" · ") || "Analyse automatique non concluante.";
    clientHint = `Merci de nous transmettre votre ${KIND_LABELS[expected].toLowerCase()} au format PDF depuis votre espace bancaire.`;
    confidence = "low";
  }

  return {
    ...base,
    expectedKind,
    matchesExpected: Boolean(matchesExpected),
    detectedLabel,
    confidence,
    adminLabel,
    clientHint,
    summary,
  };
}

export function buildLoanDocsAnalysisReport(documents: any[]): string {
  const lines: string[] = [];
  for (const slot of ["offre", "tableau"] as const) {
    const label = KIND_LABELS[slot];
    const docs = documents.filter((d) => {
      const c = String(d?.category || "");
      return c === slot || (slot === "offre" && c === "fiche");
    });
    if (!docs.length) {
      lines.push(`${label} : manquant.`);
      continue;
    }
    const sig = docs.map((d) => d?.loanSignal).find(Boolean) as LoanDocSignalShape | undefined;
    if (sig?.summary) {
      lines.push(`${label} : ${sig.summary}`);
      if (sig.clientHint) lines.push(`  → Message client possible : ${sig.clientHint}`);
    } else if (sig?.ok) {
      lines.push(`${label} : reçu, validé.`);
    } else {
      lines.push(`${label} : reçu, ${sig?.adminLabel || "à confirmer"}.`);
    }
  }
  return lines.join("\n");
}

export function isLoanSlotExploitable(documents: any[], slot: "offre" | "tableau"): boolean {
  const docs = documents.filter((d) => {
    const c = String(d?.category || "");
    return c === slot || (slot === "offre" && c === "fiche");
  });
  if (!docs.length) return false;
  return docs.some((d) => d?.loanSignal?.ok === true && d?.loanSignal?.matchesExpected !== false);
}
