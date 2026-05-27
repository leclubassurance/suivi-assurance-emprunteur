import type { Express } from "express";
import { classifyFileName, inferDocumentCategory, type DocumentCategory } from "../shared/documentClassifier";

function newDocId(category: DocumentCategory | null, fallbackPrefix = "doc") {
  const prefix = category && category !== "autre" ? category : fallbackPrefix;
  return `${prefix}-${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Conserve les ids offre-/tableau-/fiche- du formulaire (appariement par index puis par nom). */
export function mergeFormDocumentsWithUploads(
  metaDocs: any[] = [],
  files: Express.Multer.File[] = [],
) {
  const usedMetaIndexes = new Set<number>();

  const pickMeta = (file: Express.Multer.File, fileIndex: number) => {
    if (fileIndex < metaDocs.length && !usedMetaIndexes.has(fileIndex)) {
      const byIndex = metaDocs[fileIndex];
      const indexName = String(byIndex?.name || "").toLowerCase();
      const fileName = String(file.originalname || "").toLowerCase();
      if (!indexName || indexName === fileName) {
        usedMetaIndexes.add(fileIndex);
        return byIndex;
      }
    }

    const byNameIdx = metaDocs.findIndex(
      (d, i) =>
        !usedMetaIndexes.has(i) &&
        String(d?.name || "").toLowerCase() === String(file.originalname || "").toLowerCase(),
    );
    if (byNameIdx >= 0) {
      usedMetaIndexes.add(byNameIdx);
      return metaDocs[byNameIdx];
    }

    if (fileIndex < metaDocs.length && !usedMetaIndexes.has(fileIndex)) {
      usedMetaIndexes.add(fileIndex);
      return metaDocs[fileIndex];
    }

    const nextIdx = metaDocs.findIndex((_, i) => !usedMetaIndexes.has(i));
    if (nextIdx >= 0) {
      usedMetaIndexes.add(nextIdx);
      return metaDocs[nextIdx];
    }

    return null;
  };

  return files.map((f, fileIndex) => {
    const meta = pickMeta(f, fileIndex);
    const fromMeta = meta ? inferDocumentCategory(meta) : null;
    const fromName = classifyFileName(f.originalname);
    const category = fromMeta || fromName;
    const id =
      meta?.id && String(meta.id).includes("-") ? String(meta.id) : newDocId(category);

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
