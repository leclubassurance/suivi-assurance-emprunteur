/**
 * Vérifie que la suppression du PDF d'étude bloque toute résurrection.
 */
import assert from "node:assert/strict";
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
  assert.equal(dossier.formData.documents.length, 1);
  assert.equal(dossier.formData.documents[0].category, "offre");
  assert.equal(dossier.studyConseillerValidation.studyPdfFileName, undefined);

  unsuppressStudyPdf(dossier);
  dossier.studyPdf = { fileName: "new.pdf", driveFileId: "drive-new", localPath: "/tmp/new.pdf" };
  assert.equal(isStudyPdfSuppressed(dossier), false);
  assert.equal(hasStudyPdfMeta(dossier), true);

  console.log("verify-study-pdf-clear: OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
