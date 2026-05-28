import type { DocumentCategory } from "./documentClassifier";

export type DocumentQuality = {
  ok: boolean;
  reasons: string[];
  // purely indicative; not shown to client
  confidence: "low" | "medium" | "high";
};

export function assessDocumentQuality(input: {
  name?: string;
  size?: number;
  type?: string;
  category?: DocumentCategory | string | null;
}): DocumentQuality {
  const name = String(input.name || "").toLowerCase();
  const size = Number(input.size || 0);
  const type = String(input.type || "").toLowerCase();
  const category = (input.category || null) as string | null;

  const reasons: string[] = [];

  if (!name) reasons.push("Nom de fichier manquant");
  if (!size || size <= 0) reasons.push("Fichier vide");
  if (size > 0 && size < 40_000) reasons.push("Fichier très léger (qualité possiblement insuffisante)");

  const isPdf = name.endsWith(".pdf") || type.includes("pdf");
  const isImage = /\.(png|jpe?g|webp)$/i.test(name) || type.startsWith("image/");

  // Expected: offer/tableau usually PDF (not always, but most reliable).
  const isLoanDoc = category === "offre" || category === "tableau";
  if (isLoanDoc && isImage && size > 0 && size < 250_000) {
    reasons.push("Document clé en image (capture) : privilégier un PDF lisible");
  }
  if (isLoanDoc && !isPdf && !isImage && type) {
    reasons.push("Type de fichier inattendu pour un document clé");
  }

  // Light heuristic: if filename suggests screenshot
  if (isLoanDoc && /(capture|screenshot|screen|whatsapp|photo)/i.test(name)) {
    reasons.push("Nom de fichier évoque une capture/photo (souvent inexploitable)");
  }

  // Confidence: if no issues => high, if only size warning => medium, else low
  const ok = reasons.length === 0 || (reasons.length === 1 && reasons[0].includes("très léger") === false);
  const confidence: DocumentQuality["confidence"] =
    reasons.length === 0 ? "high" : reasons.length === 1 ? "medium" : "low";

  return { ok, reasons, confidence };
}

