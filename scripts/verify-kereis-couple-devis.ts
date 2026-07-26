/**
 * Vérifie l'extraction couple sur un PDF Kereis à 2 assurés + échéancier CE.
 *   npx tsx scripts/verify-kereis-couple-devis.ts
 *   npx tsx scripts/verify-kereis-couple-devis.ts /path/devis.pdf /path/tableau.pdf
 */
import path from "path";
import { computeEconomyFromDossierDocs } from "../server/economyFromDocs";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  const devisPath =
    process.argv[2] || path.resolve("tmp-devis-couple.pdf");
  const tableauPath =
    process.argv[3] || path.resolve("tmp-tableau-ce.pdf");

  const dossier = {
    id: "LCIF-TEST-COUPLE",
    formData: {
      assures: [
        { prenom: "Laura", nom: "Raimbault" },
        { prenom: "Alexandre", nom: "Poitevin" },
      ],
      documents: [
        {
          id: "devis-1",
          category: "devis",
          name: path.basename(devisPath),
          localPath: devisPath,
        },
        {
          id: "tab-1",
          category: "tableau",
          name: path.basename(tableauPath),
          localPath: tableauPath,
        },
      ],
    },
  };

  const eco = await computeEconomyFromDossierDocs(dossier);
  console.log(JSON.stringify({
    ok: eco.ok,
    reliability: eco.reliability,
    reasons: eco.reasons,
    current: eco.extracted.currentTotalRemaining,
    proposed: eco.extracted.proposedTotalRemaining,
    fees: eco.extracted.feesAssureurTotal,
    effect: eco.extracted.proposedEffectiveDate,
    year1Monthly: eco.extracted.proposedMonthlyByYear?.[0],
    gross: eco.result?.grossSavings,
  }, null, 2));

  assert(eco.ok, "economy ok");
  assert(Math.abs((eco.extracted.currentTotalRemaining || 0) - 19718.21) < 0.02, `current=${eco.extracted.currentTotalRemaining}`);
  assert(Math.abs((eco.extracted.proposedTotalRemaining || 0) - 11834.89) < 0.02, `proposed=${eco.extracted.proposedTotalRemaining}`);
  assert(eco.extracted.feesAssureurTotal === 170, `fees=${eco.extracted.feesAssureurTotal}`);
  const gross = Math.round(((eco.extracted.currentTotalRemaining || 0) - (eco.extracted.proposedTotalRemaining || 0)) * 100) / 100;
  assert(Math.abs(gross - 7883.32) < 0.02, `gross=${gross}`);
  const net = Math.round((gross - 170) * 100) / 100;
  assert(Math.abs(net - 7713.32) < 0.02, `net=${net}`);
  assert(
    Math.abs((eco.extracted.proposedMonthlyByYear?.[0]?.monthly || 0) - 36.93) < 0.02,
    `year1 monthly=${eco.extracted.proposedMonthlyByYear?.[0]?.monthly}`,
  );
  assert(
    !eco.reasons.some((r) => /Attention:.*assurés/i.test(r)),
    `unexpected warning: ${eco.reasons.join(" | ")}`,
  );
  assert(
    eco.reasons.some((r) => /2 assurés détectés/i.test(r)),
    `missing 2-insured reason: ${eco.reasons.join(" | ")}`,
  );
  console.log("\nKereis couple devis extraction OK (11834.89 / fees 170 / net 7713.32).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
