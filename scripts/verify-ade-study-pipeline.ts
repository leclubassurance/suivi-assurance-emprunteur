/**
 * Test E2E local : échéancier CE + devis → PDF étude parseable.
 * Usage:
 *   npx tsx scripts/verify-ade-study-pipeline.ts
 *   TABLEAU_PDF=... DEVIS_PDF=... npx tsx scripts/verify-ade-study-pipeline.ts
 */
import fs from "fs";
import path from "path";
import os from "os";
import { computeEconomyFromDossierDocs } from "../server/economyFromDocs";
import { generateAndIngestAdeStudyForDossier } from "../server/adeStudyPipeline";
import type { Dossier } from "../server/dossierModel";
import { ensureDossierShape } from "../server/dossierModel";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main() {
  const tableau =
    process.env.TABLEAU_PDF ||
    path.join(os.homedir(), "Downloads/Tableau_d_amortissement-2.pdf");
  const devis =
    process.env.DEVIS_PDF ||
    path.join(os.homedir(), "Downloads/Devis_44573396_26128219-2.pdf");

  assert(fs.existsSync(tableau), `tableau présent: ${tableau}`);
  assert(fs.existsSync(devis), `devis présent: ${devis}`);

  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "ade-study-"));
  const dossierId = "LCIF-TEST-ADE";
  const dossierDir = path.join(uploadsDir, dossierId);
  fs.mkdirSync(dossierDir, { recursive: true });

  const tableauPath = path.join(dossierDir, "tableau.pdf");
  const devisPath = path.join(dossierDir, "devis.pdf");
  fs.copyFileSync(tableau, tableauPath);
  fs.copyFileSync(devis, devisPath);

  const dossier = ensureDossierShape({
    id: dossierId,
    status: "EN_COURS",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    formData: {
      assures: [{ prenom: "Laura", nom: "Raimbault", email: "test@example.com" }],
      prets: [{ capitalRestant: 130000 }],
      documents: [
        {
          id: "tableau-1",
          category: "tableau",
          name: "tableau.pdf",
          localPath: tableauPath,
          type: "application/pdf",
        },
        {
          id: "devis-1",
          category: "devis",
          name: "devis.pdf",
          localPath: devisPath,
          type: "application/pdf",
        },
      ],
    },
  }) as Dossier;

  console.log("\n=== economyFromDocs ===");
  const eco = await computeEconomyFromDossierDocs(dossier);
  console.log(
    JSON.stringify(
      {
        ok: eco.ok,
        reliability: eco.reliability,
        current: eco.extracted.currentTotalRemaining,
        proposed: eco.extracted.proposedTotalRemaining,
        months: eco.extracted.remainingMonths,
        fees: eco.extracted.feesAssureurTotal,
        reasons: eco.reasons,
      },
      null,
      2,
    ),
  );
  assert(eco.ok, "economyFromDocs ok");
  assert((eco.extracted.currentTotalRemaining || 0) > 1000, "coût actuel extrait");
  assert((eco.extracted.proposedTotalRemaining || 0) > 100, "cotisations devis extraites");

  console.log("\n=== generateAndIngestAdeStudyForDossier ===");
  const result = await generateAndIngestAdeStudyForDossier({
    dossier,
    uploadsDir,
    actorLabel: "verify-script",
  });
  if (!result.ok) {
    console.error(result);
    throw new Error(result.error);
  }
  console.log(
    JSON.stringify(
      {
        gross: result.computation.grossSavingsEur,
        net: result.computation.netSavingsEur,
        current: result.computation.currentTotalEur,
        proposed: result.computation.proposedTotalEur,
        fees: result.computation.feesAssureurEur,
        confidence: result.computation.confidence,
        years: result.computation.years.length,
        parsedGross: result.parsed?.grossSavingsEur,
        studyPdf: result.studyPdf?.fileName,
      },
      null,
      2,
    ),
  );

  assert(Number.isFinite(result.computation.grossSavingsEur), "économie brute calculée");
  assert(result.parsed?.grossSavingsEur != null, "PDF ingesté / parsable");
  assert(
    Math.abs(Math.abs(result.parsed.grossSavingsEur) - Math.abs(result.computation.grossSavingsEur)) < 1,
    "parse ≈ calcul",
  );
  assert(fs.existsSync(result.studyPdf.localPath), "fichier PDF écrit");
  assert(Boolean(dossier.studyDraft?.html), "mail client généré");

  console.log("\nPipeline ADE OK.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
