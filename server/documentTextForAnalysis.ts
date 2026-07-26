import fs from "fs";
import path from "path";
import { extractPdfTextFromBuffer } from "./pdfTextExtract";
import { getHybridOcrMinTextChars, hybridOcrExtractText, isHybridOcrEnabled } from "./documentHybridOcr";
import { ensureDocumentLocalFile } from "./documentFileResolve";
import type { Dossier } from "./dossierModel";

export type DocTextResult = {
  category: string;
  name: string;
  localPath: string | null;
  text: string;
  chars: number;
  ocrUsed: boolean;
  skipReason?: string;
};

function isImagePath(localPath: string, mimeType?: string) {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.startsWith("image/")) return true;
  return /\.(png|jpe?g|webp|heic)$/i.test(localPath);
}

/** Texte exploitable d'un document dossier (PDF natif puis OCR hybride). */
export async function extractDocumentText(
  dossier: Dossier,
  doc: any,
  uploadsDir: string,
): Promise<DocTextResult> {
  const category = String(doc?.category || "?").toLowerCase();
  const name = String(doc?.name || "?");
  const resolved = await ensureDocumentLocalFile(dossier, doc, uploadsDir);
  if (!resolved.localPath) {
    return {
      category,
      name,
      localPath: null,
      text: "",
      chars: 0,
      ocrUsed: false,
      skipReason: resolved.skipReason || "file_missing",
    };
  }

  const localPath = resolved.localPath;
  doc.localPath = localPath;
  const mimeType = String(doc?.type || "");
  const minChars = getHybridOcrMinTextChars();
  let text = "";
  let ocrUsed = false;

  if (isImagePath(localPath, mimeType)) {
    if (!isHybridOcrEnabled()) {
      return {
        category,
        name,
        localPath,
        text: "",
        chars: 0,
        ocrUsed: false,
        skipReason: "image_needs_ocr",
      };
    }
    const ocr = await hybridOcrExtractText(localPath, { mimeType });
    text = ocr.text || "";
    ocrUsed = Boolean(ocr.usedOcr);
  } else if (/\.pdf$/i.test(localPath) || /pdf/i.test(mimeType)) {
    try {
      const buf = fs.readFileSync(localPath);
      text = await extractPdfTextFromBuffer(buf);
    } catch {
      text = "";
    }
    if (text.trim().length < minChars && isHybridOcrEnabled()) {
      const ocr = await hybridOcrExtractText(localPath, {
        mimeType: mimeType || "application/pdf",
      });
      if (ocr.usedOcr && (ocr.text || "").trim().length > text.trim().length) {
        text = ocr.text;
        ocrUsed = true;
      }
    }
  } else {
    return {
      category,
      name,
      localPath,
      text: "",
      chars: 0,
      ocrUsed: false,
      skipReason: "unsupported_type",
    };
  }

  const trimmed = String(text || "").trim();
  return {
    category,
    name,
    localPath,
    text: trimmed,
    chars: trimmed.length,
    ocrUsed,
  };
}

export async function extractDocsByCategories(
  dossier: Dossier,
  uploadsDir: string,
  categories: string[],
): Promise<DocTextResult[]> {
  const wanted = new Set(categories.map((c) => c.toLowerCase()));
  const docs = (dossier.formData?.documents || []) as any[];
  const out: DocTextResult[] = [];
  for (const doc of docs) {
    const cat = String(doc?.category || "").toLowerCase();
    const effective = cat === "fiche" ? "offre" : cat;
    if (!wanted.has(effective) && !wanted.has(cat)) continue;
    const r = await extractDocumentText(dossier, doc, uploadsDir);
    out.push({ ...r, category: effective || cat });
  }
  return out;
}

export function findDocByCategory(dossier: Dossier, category: string): any | null {
  const docs = (dossier.formData?.documents || []) as any[];
  const want = category.toLowerCase();
  return (
    docs.find((d) => {
      const c = String(d?.category || "").toLowerCase();
      return c === want || (want === "offre" && c === "fiche");
    }) || null
  );
}

export function basenameSafe(p: string): string {
  return path.basename(p || "document.pdf");
}
