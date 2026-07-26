/**
 * Inspecte un dossier Firestore + tente extraction économie locale.
 * Usage: npx tsx scripts/inspect-dossier-ade.ts LCIF-450320
 */
import fs from "fs";
import path from "path";
import os from "os";
import dotenv from "dotenv";
import admin from "firebase-admin";
import { ensureDossierShape } from "../server/dossierModel";
import { ensureDocumentLocalFile } from "../server/documentFileResolve";
import { computeEconomyFromDossierDocs } from "../server/economyFromDocs";
import { extractDocsByCategories } from "../server/documentTextForAnalysis";

dotenv.config({ quiet: true });

async function main() {
  const id = process.argv[2] || "LCIF-450320";
  const SA =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(
      os.homedir(),
      "Downloads/le-club-assurance-emprunteur-firebase-adminsdk-fbsvc-95537a4b3d.json",
    );
  const sa = JSON.parse(fs.readFileSync(SA, "utf8"));
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
  const snap = await admin.firestore().collection("dossiers").doc(id).get();
  if (!snap.exists) throw new Error(`Dossier ${id} introuvable`);
  const dossier = ensureDossierShape(snap.data());
  const docs = (dossier.formData?.documents || []) as any[];
  console.log(
    JSON.stringify(
      {
        id: dossier.id,
        assures: (dossier.formData?.assures || []).map((a: any) => `${a.prenom || ""} ${a.nom || ""}`.trim()),
        docs: docs.map((d) => ({
          cat: d.category,
          name: d.name,
          hasLocal: Boolean(d.localPath && fs.existsSync(String(d.localPath))),
          hasDrive: Boolean(d.driveFileId || d.driveLink),
        })),
        ade: (dossier as any).adeStudyComputation
          ? {
              current: (dossier as any).adeStudyComputation.currentTotalEur,
              proposed: (dossier as any).adeStudyComputation.proposedTotalEur,
              net: (dossier as any).adeStudyComputation.netSavingsEur,
              months: (dossier as any).adeStudyComputation.monthsCompared,
              provider: (dossier as any).adeStudyComputation.provider,
              reasons: (dossier as any).adeStudyComputation.economyReasons?.slice?.(0, 8),
            }
          : null,
      },
      null,
      2,
    ),
  );

  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "ade-insp-"));
  for (const doc of docs) {
    const cat = String(doc?.category || "");
    if (!["offre", "tableau", "devis", "fiche"].includes(cat)) continue;
    const r = await ensureDocumentLocalFile(dossier, doc, uploadsDir);
    console.log(`resolve ${cat}/${doc.name}:`, r.localPath ? `OK ${r.source}` : `FAIL ${r.skipReason}`);
    if (r.localPath) doc.localPath = r.localPath;
  }

  const eco = await computeEconomyFromDossierDocs(dossier);
  console.log(
    "\nECO",
    JSON.stringify(
      {
        ok: eco.ok,
        reliability: eco.reliability,
        reasons: eco.reasons,
        current: eco.extracted.currentTotalRemaining,
        proposed: eco.extracted.proposedTotalRemaining,
        fees: eco.extracted.feesAssureurTotal,
        months: eco.extracted.remainingMonths,
        insuredTotals: eco.extracted.proposedInsuredTotals,
        effect: eco.extracted.proposedEffectiveDate,
        year1Prop: eco.extracted.proposedMonthlyByYear?.[0],
        year1Cur: eco.extracted.currentMonthlyByYear?.[0],
      },
      null,
      2,
    ),
  );

  const texts = await extractDocsByCategories(dossier, uploadsDir, ["tableau", "devis"]);
  for (const t of texts) {
    console.log(`\n=== ${t.category} ${t.name || ""} (${t.text.length} chars) ===`);
    console.log(t.text.slice(0, 1800));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
