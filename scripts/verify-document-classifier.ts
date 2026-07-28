/**
 * Vérifie que les catégories manuelles et connues (devis/etude) ne sont pas écrasées.
 */
import assert from "node:assert/strict";
import {
  classifyFileName,
  inferDocumentCategory,
} from "../shared/documentClassifier";

assert.equal(classifyFileName("Devis_Mutuelle_2026.pdf"), "devis");
assert.equal(classifyFileName("Etude_economies_Dupont.pdf"), "etude");
assert.equal(classifyFileName("CNI_recto.pdf"), "cni");

// Bug LCIF : devis mal classé CNI puis reclassé manuellement → ne doit plus revenir en CNI
const devisDoc = {
  id: "cni-1710000000_weird.pdf",
  name: "devis_assurance.pdf",
  category: "devis",
  categoryManual: true,
};
assert.equal(inferDocumentCategory(devisDoc), "devis");

// Sans flag manuel, catégorie stockée connue doit quand même gagner sur le préfixe id
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

console.log("verify-document-classifier: OK");
