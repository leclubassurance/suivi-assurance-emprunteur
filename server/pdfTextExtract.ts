import { PDFParse } from "pdf-parse";

/** Extrait le texte d'un PDF (pdf-parse v2 — classe PDFParse). */
export async function extractPdfTextFromBuffer(buf: Buffer): Promise<string> {
  if (!buf?.length) return "";
  const parser = new PDFParse({ data: buf });
  try {
    const result = await parser.getText();
    return String(result?.text || "").trim();
  } finally {
    try {
      await parser.destroy();
    } catch {
      /* ignore */
    }
  }
}
