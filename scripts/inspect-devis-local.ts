import fs from "fs";
import { extractPdfTextFromBuffer } from "../server/pdfTextExtract";
import { computeEconomyFromDossierDocs } from "../server/economyFromDocs";

async function main() {
  const devis = process.argv[2] || "/Users/lascaudremi/Downloads/Devis_46369327_27849720.pdf";
  const tableau = process.argv[3];
  const t = await extractPdfTextFromBuffer(fs.readFileSync(devis));
  console.log("devis chars", t.length);
  console.log(t.slice(0, 2000));
  console.log("---");
  const docs: any[] = [{ id: "d1", category: "devis", name: "devis.pdf", localPath: devis }];
  if (tableau) docs.push({ id: "t1", category: "tableau", name: "tableau.pdf", localPath: tableau });
  const eco = await computeEconomyFromDossierDocs({
    id: "LCIF-655597",
    formData: {
      assures: [{ prenom: "Lilian", nom: "Dubreil" }],
      documents: docs,
    },
  });
  console.log(
    JSON.stringify(
      {
        ok: eco.ok,
        reliability: eco.reliability,
        reasons: eco.reasons,
        current: eco.extracted.currentTotalRemaining,
        proposed: eco.extracted.proposedTotalRemaining,
        fees: eco.extracted.feesAssureurTotal,
        insuredTotals: eco.extracted.proposedInsuredTotals,
        effect: eco.extracted.proposedEffectiveDate,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
