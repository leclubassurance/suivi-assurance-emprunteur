/**
 * Usage: npx tsx scripts/verify-multi-tableau-docs.ts
 */
import {
  dedupeDossierDocuments,
  mergeDocumentsIntoDossier,
  unionDossierDocuments,
} from "../server/gmailAttachments";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const dossier: any = {
  formData: {
    documents: [
      { id: "t1", category: "tableau", name: "primolis.pdf", size: 1000 },
      { id: "t2", category: "tableau", name: "ptz.pdf", size: 2000 },
      { id: "t3", category: "tableau", name: "primo.pdf", size: 3000 },
      { id: "t1b", category: "tableau", name: "primolis.pdf", size: 1000 }, // exact dup
    ],
  },
};

const d = dedupeDossierDocuments(dossier);
assert(d.removed === 1, "removes exact fingerprint dup");
assert(d.remaining === 3, "keeps 3 distinct tableaux");
assert(
  dossier.formData.documents.filter((x: any) => x.category === "tableau").length === 3,
  "three tableaux remain",
);

const added = mergeDocumentsIntoDossier(dossier, [
  {
    id: "t4",
    name: "autre-ptz.pdf",
    size: 4000,
    type: "application/pdf",
    localPath: "",
    source: "drive_reconcile",
    category: "tableau",
  } as any,
  {
    id: "t5",
    name: "primolis.pdf",
    size: 1000,
    type: "application/pdf",
    localPath: "",
    source: "drive_reconcile",
    category: "tableau",
  } as any,
]);
assert(added.length === 1, "merge adds new tableau name, skips same name");
assert(dossier.formData.documents.length === 4, "now 4 docs");

const unioned = unionDossierDocuments(
  [{ id: "a", category: "devis", name: "devis.pdf", size: 10 }],
  [
    { id: "a", category: "devis", name: "devis.pdf", size: 10, driveFileId: "drv1", driveLink: "https://x" },
    { id: "b", category: "tableau", name: "new.pdf", size: 20 },
  ],
);
assert(unioned.length === 2, "union keeps both");
assert(unioned.some((x) => x.driveFileId === "drv1"), "union prefers drive link");

console.log("\nMulti-tableau docs OK.");
