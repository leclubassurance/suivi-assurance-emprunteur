import fs from "fs";
import path from "path";
import { enrichLoanDocSignal, type LoanDocSignalShape } from "../shared/loanDocAnalysis";
import { extractPdfTextFromBuffer } from "./pdfTextExtract";
import { getHybridOcrMinTextChars, hybridOcrExtractText, isHybridOcrEnabled } from "./documentHybridOcr";

export type LoanDocSignal = LoanDocSignalShape;

function norm(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function findKeywords(text: string, words: string[]) {
  const t = norm(text);
  return words.filter((w) => t.includes(norm(w)));
}

function isImagePath(localPath: string, mimeType?: string) {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.startsWith("image/")) return true;
  return /\.(png|jpe?g|webp|heic)$/i.test(localPath);
}

async function extractNativePdfText(buf: Buffer): Promise<string> {
  return extractPdfTextFromBuffer(buf);
}

export function classifyLoanDocText(
  text: string,
  expected: "offre" | "tableau",
  options?: { skipScanWarning?: boolean },
): LoanDocSignal {
  const reasons: string[] = [];
  const keywords: string[] = [];
  const trimmed = text.trim();

  const baseWords = ["pret", "taux", "capital", "mensualite", "echeance"];
  keywords.push(...findKeywords(text, baseWords));

  const offerWords = [
    "offre de pret",
    "conditions particulieres",
    "taux nominal",
    "taeg",
    "frais de dossier",
  ];
  const tableWords = [
    "tableau d'amortissement",
    "amortissement",
    "capital restant du",
    "interets",
    "assurance",
    "echeancier",
  ];

  const offerHits = findKeywords(text, offerWords);
  const tableHits = findKeywords(text, tableWords);

  if (offerHits.length) keywords.push(...offerHits);
  if (tableHits.length) keywords.push(...tableHits);

  let kind: LoanDocSignal["kind"] = "unknown";
  if (offerHits.length >= 2 && tableHits.length < 2) kind = "offre";
  else if (tableHits.length >= 2) kind = "tableau";
  else if (offerHits.length > 0) kind = "offre";
  else if (tableHits.length > 0) kind = "tableau";

  if (expected === "offre") {
    if (offerHits.length < 1) reasons.push("Mots-clés 'offre de prêt' non détectés");
    // Une offre de prêt contient souvent un tableau d'amortissement en annexe — ne pas rejeter.
    if (tableHits.length >= 2 && offerHits.length === 0) {
      reasons.push("Ressemble plutôt à un tableau d'amortissement seul");
    }
  } else {
    if (tableHits.length < 1) reasons.push("Mots-clés 'tableau d'amortissement' non détectés");
  }

  if (!options?.skipScanWarning && trimmed.length < getHybridOcrMinTextChars()) {
    reasons.push("PDF sans texte exploitable (scan/image) — risque d'extraction faible");
  }

  const ok = reasons.length === 0;
  return {
    ok,
    kind,
    reasons,
    keywords: [...new Set(keywords)].slice(0, 12),
    extractedChars: trimmed.length,
  };
}

/**
 * Analyse offre / tableau : texte PDF natif, puis OCR Gemini si scan ou image.
 */
export async function analyzeLoanPdf(
  localPath: string,
  expected: "offre" | "tableau",
  options?: { mimeType?: string },
): Promise<LoanDocSignal> {
  const keywords: string[] = [];

  if (!localPath || !fs.existsSync(localPath)) {
    return { ok: false, kind: "unknown", reasons: ["Fichier introuvable sur le serveur"], keywords };
  }

  const buf = fs.readFileSync(localPath);
  const minChars = getHybridOcrMinTextChars();
  const imageOnly = isImagePath(localPath, options?.mimeType);

  if (buf.length < 40_000 && !imageOnly) {
    // gardé comme signal faible ; ne bloque pas seul la validation
  }

  let text = "";
  let textSource: LoanDocSignal["textSource"] = "pdf_native";
  let ocrUsed = false;

  if (imageOnly) {
    if (!isHybridOcrEnabled()) {
      return {
        ok: false,
        kind: "unknown",
        reasons: ["Document image — activez l'OCR hybride ou envoyez un PDF banque"],
        keywords,
      };
    }
    const ocr = await hybridOcrExtractText(localPath, { mimeType: options?.mimeType });
    if (!ocr.usedOcr || !ocr.text.trim()) {
      return {
        ok: false,
        kind: "unknown",
        reasons: [
          ocr.error === "gemini_not_configured"
            ? "OCR indisponible (clé Gemini)"
            : "Impossible de lire le texte sur l'image (OCR)",
        ],
        keywords,
        ocrUsed: false,
      };
    }
    text = ocr.text;
    textSource = "ocr_image";
    ocrUsed = true;
  } else {
    try {
      text = await extractNativePdfText(buf);
    } catch {
      return { ok: false, kind: "unknown", reasons: ["Impossible de lire le contenu PDF"], keywords };
    }

    if (text.trim().length < minChars && isHybridOcrEnabled()) {
      const ocr = await hybridOcrExtractText(localPath, { mimeType: options?.mimeType || "application/pdf" });
      if (ocr.usedOcr && ocr.text.trim().length > text.trim().length) {
        text = ocr.text;
        textSource = "ocr";
        ocrUsed = true;
      }
    }
  }

  const classified = classifyLoanDocText(text, expected, {
    skipScanWarning: ocrUsed && text.trim().length >= minChars,
  });

  if (ocrUsed && classified.ok) {
    const filtered = classified.reasons.filter(
      (r) => !/sans texte exploitable/i.test(r) && !/Mots-clés.*non détectés/i.test(r),
    );
    if (filtered.length !== classified.reasons.length) {
      classified.reasons = filtered;
      classified.ok = filtered.length === 0;
    }
  }

  // Type détecté vs catégorie attendue (offre avec tableau intégré = offre valide)
  if (classified.kind !== "unknown" && classified.kind !== expected) {
    if (expected === "offre" && classified.kind === "tableau") {
      const offerWords = [
        "offre de pret",
        "conditions particulieres",
        "taux nominal",
        "taeg",
        "frais de dossier",
        "fiche standardisee",
      ];
      const offerHits = findKeywords(text, offerWords);
      if (offerHits.length >= 1) {
        classified.kind = "offre";
        classified.reasons = classified.reasons.filter(
          (r) => !/Ressemble plutôt à un tableau/i.test(r),
        );
        classified.ok = classified.reasons.length === 0;
      } else if (!classified.reasons.some((r) => /tableau d'amortissement/i.test(r))) {
        classified.reasons.push("Ressemble plutôt à un tableau d'amortissement seul");
        classified.ok = false;
      }
    }
  }

  return enrichLoanDocSignal(
    {
      ...classified,
      ocrUsed,
      textSource,
      extractedChars: text.trim().length,
    },
    expected,
    { fileName: path.basename(localPath) },
  );
}

export function isLoanPdfOrImage(name?: string, mimeType?: string): boolean {
  const n = String(name || "").toLowerCase();
  const t = String(mimeType || "").toLowerCase();
  if (t.includes("pdf") || n.endsWith(".pdf")) return true;
  if (t.startsWith("image/") || /\.(png|jpe?g|webp|heic)$/i.test(n)) return true;
  return false;
}
