import { classifyFileName } from "../shared/documentClassifier";
import { persistInferredDocumentCategories } from "../shared/documentChecklist";
import {
  dedupeDossierDocuments,
  mergeDocumentsIntoDossier,
  type SavedGmailAttachment,
} from "./gmailAttachments";
import { normalizeDossierDocumentsForPersistence } from "./documentStoragePolicy";

export type GmailDocumentFinalizeResult = {
  mergedFromDrive: number;
  categoriesUpdated: number;
  dedupedRemoved: number;
};

function guessMimeFromFilename(name: string): string {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

/** Ajoute dans formData.documents les fichiers Drive absents de l'app (réconciliation automatique). */
export function reconcileDriveAttachmentsToDossier(
  dossier: any,
  driveFilesByName: Map<string, { fileId: string; webViewLink?: string | null; name?: string }>,
): number {
  if (!driveFilesByName.size) return 0;

  const newDocs: SavedGmailAttachment[] = [];
  for (const [nameKey, info] of driveFilesByName) {
    const displayName = info.name || nameKey;
    const category = classifyFileName(displayName);
    newDocs.push({
      id: `${category && category !== "autre" ? category : "pj"}-drive_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: displayName,
      size: 0,
      type: guessMimeFromFilename(displayName),
      localPath: "",
      source: "drive_reconcile",
      category: category || undefined,
      driveFileId: info.fileId,
      driveLink: info.webViewLink || undefined,
    });
  }

  return mergeDocumentsIntoDossier(dossier, newDocs).length;
}

/** Déduplication, réconciliation Drive et catégories inférées — sans action admin. */
export function finalizeGmailDocumentImport(
  dossier: any,
  options?: {
    driveFilesByName?: Map<string, { fileId: string; webViewLink?: string | null; name?: string }>;
  },
): GmailDocumentFinalizeResult {
  const dedupe = dedupeDossierDocuments(dossier);
  let mergedFromDrive = 0;
  if (options?.driveFilesByName?.size) {
    mergedFromDrive = reconcileDriveAttachmentsToDossier(dossier, options.driveFilesByName);
  }
  const categoriesUpdated = persistInferredDocumentCategories(dossier);
  normalizeDossierDocumentsForPersistence(dossier);
  return {
    mergedFromDrive,
    categoriesUpdated,
    dedupedRemoved: dedupe.removed,
  };
}
