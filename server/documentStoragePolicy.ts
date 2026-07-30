/**
 * Stockage des pièces : Drive = source de vérité une fois uploadé.
 * On ne retire localPath que si driveFileId est présent — sinon un export Drive
 * raté / bloqué en PENDING effacerait toute trace du fichier (disque Railway éphémère).
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
