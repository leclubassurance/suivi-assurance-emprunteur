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

  // Sync Gmail stale ne doit pas écraser une suppression admin
  const { mergeManualDossierOverrides } = await import("../server/dossierManualOverrides");
  const cleared = ensureDossierShape({
    id: "LCIF-RACE",
    studyPdfSuppressed: true,
    studyPdfClearedAt: "2026-07-29T16:40:26.000Z",
    studyDraft: { kind: "PDF_UPLOAD_CLEARED", computedAt: "2026-07-29T16:40:26.000Z", reliability: "cleared" },
    formData: { documents: [{ id: "offre-1", category: "offre", name: "offre.pdf" }] },
  });
  const staleIncoming = ensureDossierShape({
    id: "LCIF-RACE",
    studyPdf: {
      fileName: "Etude_economies_ADE_LCIF-RACE_restored_1.pdf",
      driveFileId: "old-drive-id",
      localPath: "/tmp/old.pdf",
      uploadedAt: "2026-07-29T15:00:00.000Z",
    },
    studyDraft: { kind: "PDF_UPLOAD", computedAt: "2026-07-29T15:00:00.000Z", reliability: "high" },
    formData: {
      documents: [
        { id: "etude-study-pdf-1", category: "etude", name: "old.pdf", source: "study_pdf" },
        { id: "offre-1", category: "offre", name: "offre.pdf" },
      ],
    },
  });
  const merged = mergeManualDossierOverrides(cleared, staleIncoming);
  assert.equal(merged.studyPdfSuppressed, true);
  assert.equal(merged.studyPdf, undefined);
  assert.equal(merged.studyDraft?.kind, "PDF_UPLOAD_CLEARED");
  assert.equal(merged.formData.documents.some((d: any) => d.category === "etude"), false);

  const freshIncoming = ensureDossierShape({
    id: "LCIF-RACE",
    studyPdf: {
      fileName: "new.pdf",
      driveFileId: "new-id",
      localPath: "/tmp/new.pdf",
      uploadedAt: "2026-07-29T16:45:00.000Z",
    },
    studyDraft: { kind: "PDF_UPLOAD", computedAt: "2026-07-29T16:45:00.000Z", reliability: "high" },
    formData: { documents: [] },
  });
  const mergedFresh = mergeManualDossierOverrides(cleared, freshIncoming);
  assert.equal(mergedFresh.studyPdfSuppressed, undefined);
  assert.equal(mergedFresh.studyPdf?.fileName, "new.pdf");

  console.log("verify-study-pdf-clear: OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
