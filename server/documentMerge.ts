import type { Express } from "express";
import { classifyFileName, inferDocumentCategory, type DocumentCategory } from "../shared/documentClassifier";

function newDocId(category: DocumentCategory | null, fallbackPrefix = "doc") {
  const prefix = category && category !== "autre" ? category : fallbackPrefix;
  return `${prefix}-${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Conserve les ids offre-/tableau-/fiche- du formulaire en les associant aux fichiers uploadés. */
export function mergeFormDocumentsWithUploads(
  metaDocs: any[] = [],
  files: Express.Multer.File[] = [],
) {
  const remainingMeta = [...metaDocs];

  const takeMetaForFile = (file: Express.Multer.File) => {
    const byName = remainingMeta.findIndex(
      (d) => String(d?.name || "").toLowerCase() === String(file.originalname || "").toLowerCase(),
    );
    if (byName >= 0) return remainingMeta.splice(byName, 1)[0];
    if (remainingMeta.length > 0) return remainingMeta.shift();
    return null;
  };

  return files.map((f) => {
    const meta = takeMetaForFile(f);
    const fromMeta = meta ? inferDocumentCategory(meta) : null;
    const fromName = classifyFileName(f.originalname);
    const category = fromMeta || fromName;
    const id =
      meta?.id && String(meta.id).includes("-")
        ? String(meta.id)
        : newDocId(category);

    return {
      id,
      category: category || undefined,
      name: f.originalname,
      size: f.size,
      type: f.mimetype,
      localPath: f.path,
      source: meta?.source || "form",
      uploadedAt: meta?.uploadedAt || new Date().toISOString(),
    };
  });
}
