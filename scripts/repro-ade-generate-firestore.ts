/**
 * Repro prod: charge un dossier Firestore, matérialise docs, tente génération étude.
 * Usage: npx tsx scripts/repro-ade-generate-firestore.ts [dossierId]
 */
import fs from "fs";
import path from "path";
import os from "os";
import admin from "firebase-admin";
import { ensureDossierShape } from "../server/dossierModel";
import { generateAndIngestAdeStudyForDossier } from "../server/adeStudyPipeline";
import { ensureDocumentLocalFile } from "../server/documentFileResolve";

const SA =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  path.join(
    os.homedir(),
    "Downloads/le-club-assurance-emprunteur-firebase-adminsdk-fbsvc-95537a4b3d.json",
  );

async function main() {
  const sa = JSON.parse(fs.readFileSync(SA, "utf8"));
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  const db = admin.firestore();
  const wantId = process.argv[2] || "";

  let dossierRaw: any = null;
  if (wantId) {
    const snap = await db.collection("dossiers").doc(wantId).get();
    if (!snap.exists) throw new Error(`Dossier ${wantId} introuvable`);
    dossierRaw = snap.data();
  } else {
    const snap = await db.collection("dossiers").get();
    const withTableau = snap.docs
      .map((d) => d.data())
      .filter((d) => {
        const docs = d?.formData?.documents || [];
        return docs.some((x: any) => String(x?.category || "") === "tableau");
      });
    // Prefer one that already has devis, else any with tableau
    dossierRaw =
      withTableau.find((d) =>
        (d?.formData?.documents || []).some((x: any) => String(x?.category || "") === "devis"),
      ) || withTableau[0];
    if (!dossierRaw) throw new Error("Aucun dossier avec tableau");
  }

  const dossier = ensureDossierShape(dossierRaw);
  const docs = (dossier.formData?.documents || []) as any[];
  console.log(
    JSON.stringify(
      {
        id: dossier.id,
        name: [dossier.formData?.assures?.[0]?.prenom, dossier.formData?.assures?.[0]?.nom]
          .filter(Boolean)
          .join(" "),
        docs: docs.map((d) => ({
          cat: d.category,
          name: d.name,
          hasLocal: Boolean(d.localPath),
          hasDrive: Boolean(d.driveFileId || d.driveLink),
        })),
      },
      null,
      2,
    ),
  );

  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "ade-repro-"));
  for (const doc of docs) {
    const cat = String(doc?.category || "");
    if (!["offre", "tableau", "devis", "fiche"].includes(cat)) continue;
    const r = await ensureDocumentLocalFile(dossier, doc, uploadsDir);
    console.log(`resolve ${cat}/${doc.name}:`, r.localPath ? `OK ${r.source}` : `FAIL ${r.skipReason}`);
  }

  // If no devis, attach a sample devis for repro of generation path
  const hasDevis = docs.some((d) => String(d?.category || "") === "devis");
  if (!hasDevis) {
    const sample = path.join(os.homedir(), "Downloads/Devis_44573396_26128219-2.pdf");
    if (!fs.existsSync(sample)) throw new Error("Pas de devis sur dossier et sample manquant");
    const dest = path.join(uploadsDir, dossier.id, "devis-sample.pdf");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(sample, dest);
    docs.push({
      id: "devis-sample",
      category: "devis",
      name: "devis-sample.pdf",
      localPath: dest,
      type: "application/pdf",
    });
    console.log("Injected sample devis for generation test");
  }

  const result = await generateAndIngestAdeStudyForDossier({
    dossier,
    uploadsDir,
    actorLabel: "repro-script",
  });
  console.log(JSON.stringify(result, null, 2).slice(0, 2500));
  if (!result.ok) process.exit(1);
  console.log("SUCCESS", {
    gross: result.computation.grossSavingsEur,
    pdf: result.studyPdf?.fileName,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
