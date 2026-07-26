/**
 * Vérifie la présentation ADE 7 pages (pdfkit) : rendu, poids (image de couverture
 * embarquée) et lisibilité par le parseur d'étude.
 *
 * Usage : npx tsx scripts/verify-ade-study-pdf-generate.ts
 * Les montants sont ceux de l'étude de référence Raimbault / Poitevin.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { generateAdeStudyPdfBuffer } from "../server/adeStudyPdfGenerate";
import type { AdeStudyComputation, AdeYearRow } from "../server/adeStudyCompute";
import { extractPdfTextFromBuffer } from "../server/pdfTextExtract";
import { parseStudyEconomicsFromPdfText } from "../shared/studyPdfEconomicsParse";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

/** Années de l'étude de référence : actuelle | nouvelle | nette | cumul. */
const REFERENCE_YEARS: Array<[number, number, number, number]> = [
  [1348.29, 443.16, 735.13, 735.13],
  [1315.89, 546.0, 769.89, 1505.02],
  [1282.03, 609.0, 673.03, 2178.05],
  [1246.67, 662.04, 584.63, 2762.68],
  [1209.74, 702.24, 507.5, 3270.18],
  [1171.19, 759.6, 411.59, 3681.77],
  [1130.92, 893.16, 237.76, 3919.53],
  [1088.91, 989.76, 99.15, 4018.68],
  [1045.02, 979.92, 65.1, 4083.78],
  [999.19, 962.88, 36.31, 4120.09],
  [951.35, 946.2, 5.15, 4125.24],
  [901.38, 988.92, -87.54, 4037.7],
  [849.22, 498.0, 351.22, 4388.92],
  [794.75, 412.08, 382.67, 4771.59],
  [737.89, 334.8, 403.09, 5174.68],
  [678.5, 280.08, 398.42, 5573.1],
  [616.48, 234.48, 382.0, 5955.1],
  [551.77, 190.68, 361.09, 6316.19],
  [484.15, 149.04, 335.11, 6651.3],
  [413.55, 100.68, 312.87, 6964.17],
  [339.86, 68.64, 271.22, 7235.39],
  [262.91, 43.68, 219.23, 7454.62],
  [182.56, 24.12, 158.44, 7613.06],
  [98.66, 13.56, 85.1, 7698.16],
  [17.33, 2.17, 15.16, 7713.32],
];

function buildComputation(): AdeStudyComputation {
  const years: AdeYearRow[] = REFERENCE_YEARS.map(([currentEur, proposedEur, netSavingEur, cumulNetEur], i) => ({
    year: i + 1,
    currentEur,
    proposedEur,
    netSavingEur,
    cumulNetEur,
  }));

  return {
    effectDateIso: "2026-10-27",
    currentTotalEur: 19718.21,
    proposedTotalEur: 11834.89,
    feesAssureurEur: 170,
    grossSavingsEur: 7883.32,
    netSavingsEur: 7713.32,
    savingsPercent: 40,
    year1ProposedEur: 443.16,
    years,
    monthsCompared: 295,
    guarantees: [],
    assumptions: ["Échéancier Caisse d'Épargne 300 lignes, 295 mois comparés."],
    warnings: [],
    confidence: "high",
    clientName: "Laura Raimbault & Alexandre Poitevin",
    provider: "mixed",
    studyDateLabel: "26 juillet 2026",
    comparisonStartLabel: "5 novembre 2026",
    comparisonEndLabel: "5 mai 2051",
    insuredBreakdown: [
      { name: "Laura Raimbault", currentEur: 6306.77, proposedEur: 3420.92, feesEur: 85, netEur: 2800.85 },
      { name: "Alexandre Poitevin", currentEur: 13411.44, proposedEur: 8413.97, feesEur: 85, netEur: 4912.47 },
    ],
    lemoineProfiles: [
      {
        name: "Laura Raimbault",
        tone: "green",
        text:
          "Fin du prêt avant 60 ans et part assurée du prêt étudié inférieure à 200 000 € : absence de " +
          "questionnaire, sous réserve que ses autres encours assurés éventuels ne fassent pas dépasser le " +
          "plafond légal.",
      },
      {
        name: "Alexandre Poitevin",
        tone: "orange",
        text:
          "Le prêt se termine après son 60e anniversaire : l'assureur peut demander un questionnaire de santé " +
          "et, si nécessaire, des pièces ou examens complémentaires.",
      },
    ],
    first8CurrentEur: 9793.64,
    first8ProposedEur: 5604.96,
    loanCapitalEur: 195000,
  };
}

async function main() {
  const comp = buildComputation();
  const buf = await generateAdeStudyPdfBuffer(comp);
  const outPath = path.join(os.tmpdir(), `ade-study-sample-${Date.now()}.pdf`);
  fs.writeFileSync(outPath, buf);
  console.log(`PDF=${outPath} (${Math.round(buf.length / 1024)} Ko)`);

  const text = await extractPdfTextFromBuffer(buf);
  const parsed = parseStudyEconomicsFromPdfText(text);
  console.log(JSON.stringify(parsed, null, 2));

  console.log("\n=== Rendu ===");
  assert(buf.length > 100 * 1024, `poids > 100 Ko (image de couverture embarquée) — ${buf.length} octets`);
  const pageMarks = [...text.matchAll(/--\s*(\d+)\s+of\s+(\d+)\s*--/g)];
  const pages = pageMarks.length ? Number(pageMarks[pageMarks.length - 1][2]) : 0;
  assert(pages === 7, `7 pages (${pages})`);
  for (const title of [
    "Votre assurance",
    "Votre économie en un regard",
    "Évolution annuelle",
    "Tableau complet sur les 25 années",
    "Une protection complète du crédit",
    "Changer d'assurance, simplement",
    "Un changement accompagné de bout en bout",
  ]) {
    assert(text.includes(title), `page présente : « ${title} »`);
  }
  assert(/7 713,32 €/.test(text), "montants au format français avec espaces normales");
  assert(!/\u202f|\u00a0/.test(text), "aucune espace fine / insécable dans le PDF");
  assert(/Année 25 17,33 € 2,17 €/.test(text), "tableau annuel complet (25 lignes)");
  assert(/Prévue sans condition d'hospitalisation/.test(text), "garanties par défaut (référence skill)");
  assert(!/sans frais/i.test(text), "aucune mention « sans frais »");
  assert(!/(l[ée]gifrance|service-public|AERAS|droit à l'oubli)/i.test(text), "aucune source juridique en page Lemoine");

  console.log("\n=== Parse économique ===");
  assert(parsed.templateVersion === "v2_personnalisee", "template v2 détecté");
  assert(parsed.confidence === "high", "confiance high");
  assert(parsed.grossSavingsEur != null && Math.abs(parsed.grossSavingsEur - 7883.32) < 0.02, "économie brute");
  assert(parsed.netSavingsEur != null && Math.abs(parsed.netSavingsEur - 7713.32) < 0.02, "économie nette");
  assert(parsed.feesAssureurEur != null && Math.abs(parsed.feesAssureurEur - 170) < 0.02, "frais retenus 170");
  assert(
    parsed.currentInsuranceTotalEur != null && Math.abs(parsed.currentInsuranceTotalEur - 19718.21) < 0.02,
    "assurance actuelle",
  );
  assert(
    parsed.proposedInsuranceTotalEur != null && Math.abs(parsed.proposedInsuranceTotalEur - 11834.89) < 0.02,
    "nouvelles cotisations",
  );
  assert(parsed.year1ValuesAreAnnual === true, "année 1 annuelle");
  assert(parsed.proposedYear1RawEur != null && Math.abs(parsed.proposedYear1RawEur - 443.16) < 0.02, "année 1 443,16");
  assert(parsed.plannedChangeDate === "2026-10-27", "prise d'effet 27 octobre 2026");
  assert(parsed.savingsPercent != null && Math.abs(parsed.savingsPercent - 39.1) < 0.05, "% économie nette 39,1");
  assert(parsed.loanCapitalEur === 195000, "capital prêt 195 000 €");

  console.log("\nPrésentation ADE OK (7 pages, parseable).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
