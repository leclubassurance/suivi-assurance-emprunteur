/**
 * Vérifie que la suppression du PDF d'étude bloque toute résurrection
 * et que le flag survit à ensureDossierShape (persistance Firestore).
 */
import assert from "node:assert/strict";
import { ensureDossierShape } from "../server/dossierModel";
import {
  clearStudyPdfState,
  hasStudyPdfMeta,
  isStudyPdfSuppressed,
  unsuppressStudyPdf,
} from "../server/studyPdfFlow";

async function main() {
  const dossier: any = {
    id: "LCIF-TEST",
    studyDraft: {
      kind: "PDF_UPLOAD",
      extracted: {
        pdf: { fileName: "old.pdf", driveFileId: "drive-old", localPath: "/tmp/missing.pdf" },
      },
    },
    studyPdf: { fileName: "old.pdf", driveFileId: "drive-old", localPath: "/tmp/missing.pdf" },
    formData: {
      documents: [
        {
          id: "etude-study-pdf-1",
          category: "etude",
          name: "old.pdf",
          source: "study_pdf",
          driveFileId: "drive-old",
        },
        { id: "offre-1", category: "offre", name: "offre.pdf" },
      ],
    },
    studyConseillerValidation: { studyPdfFileName: "old.pdf", studySource: "pdf" },
  };

  assert.equal(hasStudyPdfMeta(dossier), true);

  await clearStudyPdfState(dossier, { trashDrive: false });

  assert.equal(isStudyPdfSuppressed(dossier), true);
  assert.equal(hasStudyPdfMeta(dossier), false);
  assert.equal(dossier.studyPdf, undefined);
  assert.equal(dossier.studyDraft?.extracted?.pdf, undefined);
  assert.equal(dossier.studyDraft?.kind, "PDF_UPLOAD_CLEARED");
  assert.equal(dossier.studyPdfSuppressed, true);
  assert.ok(dossier.studyPdfClearedAt);
  assert.equal(dossier.formData.documents.length, 1);
  assert.equal(dossier.formData.documents[0].category, "offre");
  assert.equal(dossier.studyConseillerValidation.studyPdfFileName, undefined);

  const reshaped = ensureDossierShape(dossier);
  assert.equal(isStudyPdfSuppressed(reshaped), true, "suppress flag must survive ensureDossierShape");
  assert.equal(hasStudyPdfMeta(reshaped), false);
  assert.equal(reshaped.studyPdfSuppressed, true);
  assert.equal(reshaped.studyDraft?.kind, "PDF_UPLOAD_CLEARED");

  // Sans studyDraft préalable : le marqueur est quand même créé
  const bare: any = {
    id: "LCIF-BARE",
    studyPdf: { fileName: "x.pdf", driveFileId: "d1" },
    formData: { documents: [] },
  };
  await clearStudyPdfState(bare, { trashDrive: false });
  assert.equal(bare.studyDraft?.kind, "PDF_UPLOAD_CLEARED");
  assert.equal(isStudyPdfSuppressed(ensureDossierShape(bare)), true);

  unsuppressStudyPdf(dossier);
  dossier.studyPdf = { fileName: "new.pdf", driveFileId: "drive-new", localPath: "/tmp/new.pdf" };
  assert.equal(isStudyPdfSuppressed(dossier), false);
  assert.equal(hasStudyPdfMeta(dossier), true);

  // Régénération fantôme : calcul ADE seul ≠ PDF à restaurer
  const { ensureStudyPdfLocalFile } = await import("../server/studyPdfFlow");
  const ghost: any = {
    id: "LCIF-GHOST",
    adeStudyComputation: {
      grossSavingsEur: 1000,
      currentTotalEur: 5000,
      proposedTotalEur: 4000,
    },
    formData: {
      documents: [
        { id: "d1", category: "devis", name: "devis.pdf" },
        { id: "t1", category: "tableau", name: "tableau.pdf" },
      ],
    },
  };
  const ensured = await ensureStudyPdfLocalFile(ghost, "/tmp");
  assert.equal(ensured.localPath, null);
  assert.equal(ghost.studyPdf, undefined);

  console.log("verify-study-pdf-clear: OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
