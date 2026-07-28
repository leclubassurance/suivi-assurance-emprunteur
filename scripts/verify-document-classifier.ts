/**
 * Vérifie que les catégories manuelles et connues (devis/etude) ne sont pas écrasées,
 * et que la checklist suivi ne rattache plus un devis à la CNI via l'id.
 */
import assert from "node:assert/strict";
import {
  classifyFileName,
  inferDocumentCategory,
  categoryToChecklistKey,
} from "../shared/documentClassifier";
import { computeDocumentChecklist } from "../shared/documentChecklist";

assert.equal(classifyFileName("Devis_Mutuelle_2026.pdf"), "devis");
assert.equal(classifyFileName("Etude_economies_Dupont.pdf"), "etude");
assert.equal(classifyFileName("CNI_recto.pdf"), "cni");

assert.equal(
  inferDocumentCategory({
    id: "cni-1710000000_weird.pdf",
    name: "devis_assurance.pdf",
    category: "devis",
    categoryManual: true,
  }),
  "devis",
);

assert.equal(
  inferDocumentCategory({
    id: "cni-123_file.pdf",
    name: "scan.pdf",
    category: "devis",
  }),
  "devis",
);

assert.equal(
  inferDocumentCategory({
    id: "etude-study-pdf-1",
    name: "etude.pdf",
    category: "etude",
  }),
  "etude",
);

assert.equal(
  inferDocumentCategory({
    id: "offre-1",
    name: "x.pdf",
    category: "autre",
    categoryManual: true,
  }),
  "autre",
);

assert.equal(categoryToChecklistKey("tableau"), "amort");
assert.equal(categoryToChecklistKey("devis"), null);

const checklist = computeDocumentChecklist([
  {
    id: "cni-1710000000_devis.pdf",
    name: "Devis_46496908_27973643.pdf",
    category: "devis",
    categoryManual: true,
  },
  {
    id: "offre-1",
    name: "Offre de prêt.pdf",
    category: "offre",
  },
  {
    id: "tableau-1",
    name: "Tableau.pdf",
    category: "tableau",
  },
]);
const cni = checklist.find((i) => i.key === "cni");
assert.equal(cni?.ok, false);
assert.equal((cni?.matchedFiles || []).length, 0);
assert.equal(checklist.find((i) => i.key === "offre")?.ok, true);
assert.equal(checklist.find((i) => i.key === "amort")?.ok, true);

console.log("verify-document-classifier: OK");
