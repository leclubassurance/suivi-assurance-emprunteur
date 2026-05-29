/**
 * Stockage des pièces : Drive = source de vérité, Firestore = métadonnées + OCR.
 * Le disque Railway est éphémère — on ne persiste pas localPath si Drive est disponible.
 */

export function normalizeDocumentForPersistence(doc: any): any {
  if (!doc || typeof doc !== "object") return doc;
  const out = { ...doc };
  if (out.driveFileId && out.localPath) {
    delete out.localPath;
  }
  return out;
}

export function normalizeDossierDocumentsForPersistence(dossier: any) {
  const docs = dossier?.formData?.documents;
  if (!Array.isArray(docs)) return;
  dossier.formData.documents = docs.map(normalizeDocumentForPersistence);
}
