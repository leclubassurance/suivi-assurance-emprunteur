/**
 * Usage:
 *   npx tsx scripts/verify-study-pdf-parse.ts
 *   npx tsx scripts/verify-study-pdf-parse.ts "/path/to.pdf"
 */
import fs from "fs";
import path from "path";
import { extractPdfTextFromBuffer } from "../server/pdfTextExtract";
import { parseStudyEconomicsFromPdfText } from "../shared/studyPdfEconomicsParse";
import { buildStudyClientEmailHtml } from "../server/studyPdfFlow";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function parseFile(pdfPath: string) {
  const text = await extractPdfTextFromBuffer(fs.readFileSync(pdfPath));
  return { text, parsed: parseStudyEconomicsFromPdfText(text) };
}

async function verifyLegacyMartin() {
  const pdfPath =
    process.env.STUDY_PDF_LEGACY ||
    path.join(process.env.HOME || "", "Downloads/TEST-ADE-Martin-economie.pdf");
  if (!fs.existsSync(pdfPath)) {
    console.log(`(skip legacy Martin — fichier absent: ${pdfPath})`);
    return;
  }
  console.log("\n=== Legacy Martin ===");
  const { parsed } = await parseFile(pdfPath);
  console.log(JSON.stringify(parsed, null, 2));
  assert(parsed.templateVersion === "v1_legacy" || parsed.confidence === "high", "template legacy ou high");
  assert(parsed.grossSavingsEur != null && Math.abs(parsed.grossSavingsEur - 8268.37) < 0.02, "économie brute");
  assert(parsed.feesAssureurEur === 0, "frais dossier 0");
  assert(parsed.currentInsuranceTotalEur != null && parsed.currentInsuranceTotalEur > 16000, "coût actuel");
  assert(parsed.proposedInsuranceTotalEur != null && parsed.proposedInsuranceTotalEur > 8000, "nouvelle solution");
  assert(parsed.proposedMonthlyYear1Eur != null && Math.abs(parsed.proposedMonthlyYear1Eur - 790.42) < 0.02, "mensuel an 1");
  assert(parsed.annualPremiumEur != null && Math.abs(parsed.annualPremiumEur - 9485.04) < 0.02, "prime annuelle ×12");
  assert(parsed.year1ValuesAreAnnual === false, "année 1 mensuelle");
  assert(parsed.loanCapitalEur === 250000, "capital prêt");
  assert(parsed.plannedChangeDate === "2026-10-01", "date d'effet");
}

async function verifyV2Raimbault() {
  const pdfPath =
    process.argv[2] ||
    process.env.STUDY_PDF_V2 ||
    "/Users/lascaudremi/Documents/New project/output/pdf/Etude_economies_ADE_Raimbault_Poitevin.pdf";
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF v2 introuvable: ${pdfPath}`);
  }
  console.log("\n=== V2 Raimbault / Poitevin ===");
  const { parsed } = await parseFile(pdfPath);
  console.log(JSON.stringify(parsed, null, 2));

  assert(parsed.templateVersion === "v2_personnalisee", "template v2");
  assert(parsed.confidence === "high", "confiance high");
  assert(parsed.grossSavingsEur != null && Math.abs(parsed.grossSavingsEur - 7883.32) < 0.02, "économie brute 7883.32");
  assert(parsed.netSavingsEur != null && Math.abs(parsed.netSavingsEur - 7713.32) < 0.02, "économie nette 7713.32");
  assert(parsed.feesAssureurEur != null && Math.abs(parsed.feesAssureurEur - 170) < 0.02, "frais retenus 170");
  assert(parsed.currentInsuranceTotalEur != null && Math.abs(parsed.currentInsuranceTotalEur - 19718.21) < 0.02, "assurance actuelle");
  assert(parsed.proposedInsuranceTotalEur != null && Math.abs(parsed.proposedInsuranceTotalEur - 11834.89) < 0.02, "nouvelles cotisations");
  assert(parsed.year1ValuesAreAnnual === true, "année 1 annuelle");
  assert(parsed.proposedYear1RawEur != null && Math.abs(parsed.proposedYear1RawEur - 443.16) < 0.02, "année 1 raw 443.16");
  assert(parsed.annualPremiumEur != null && Math.abs(parsed.annualPremiumEur - 443.16) < 0.02, "prime annuelle = année 1");
  assert(parsed.proposedMonthlyYear1Eur != null && Math.abs(parsed.proposedMonthlyYear1Eur - 36.93) < 0.02, "mensuel dérivé");
  assert(parsed.plannedChangeDate === "2026-10-27", "prise d'effet 27 octobre 2026");
  assert(parsed.savingsPercent != null && Math.abs(parsed.savingsPercent - 39.1) < 0.05, "% économie 39.1");

  const mail = buildStudyClientEmailHtml({
    clientPrenom: "Laura",
    grossSavingsEur: parsed.grossSavingsEur,
    feesCourtageTotalEur: 400,
    feesAssureurEur: parsed.feesAssureurEur,
    currentInsuranceTotalEur: parsed.currentInsuranceTotalEur,
    proposedInsuranceTotalEur: parsed.proposedInsuranceTotalEur,
    plannedChangeDate: parsed.plannedChangeDate,
  });
  assert(/Frais de courtage\s*:[\s\S]{0,40}<strong>400/.test(mail.html), "courtage patchable");
  assert(/7\s*883/.test(mail.html) || /7883/.test(mail.html), "économie dans mail");
  assert(/Comment ça marche/i.test(mail.html), "étapes mail");
  assert(/1E3A8A/.test(mail.html), "bandeau marque");
  assert(/27\s+octobre\s+2026/i.test(mail.html), "date dans mail");
}

async function verifyV3MaxenceMensualites() {
  const pdfPath =
    "/Users/lascaudremi/Desktop/Étude d'économie/Etude_assurance_Maxence_Herve_mensualites.pdf";
  if (!fs.existsSync(pdfPath)) {
    console.log(`(skip v3 Maxence — fichier absent: ${pdfPath})`);
    return;
  }
  console.log("\n=== V3 Maxence Hervé (mensualités) ===");
  const { parsed } = await parseFile(pdfPath);
  console.log(JSON.stringify(parsed, null, 2));
  assert(parsed.templateVersion === "v3_mensualites", "template v3");
  assert(parsed.grossSavingsEur != null && Math.abs(parsed.grossSavingsEur - 710.43) < 0.02, "économie brute 710.43");
  assert(parsed.netSavingsEur != null && Math.abs(parsed.netSavingsEur - 600.43) < 0.02, "économie nette 600.43");
  assert(parsed.feesAssureurEur != null && Math.abs(parsed.feesAssureurEur - 110) < 0.02, "frais 110");
  assert(parsed.currentInsuranceTotalEur != null && Math.abs(parsed.currentInsuranceTotalEur - 2141.01) < 0.02, "actuelle 2141");
  assert(parsed.proposedInsuranceTotalEur != null && Math.abs(parsed.proposedInsuranceTotalEur - 1430.58) < 0.02, "proposée 1430");
  assert(parsed.loanCapitalEur != null && Math.abs(parsed.loanCapitalEur - 91648.06) < 0.02, "capital");
  assert(parsed.savingsPercent != null && Math.abs(parsed.savingsPercent - 28) < 0.1, "% 28");
  assert(parsed.plannedChangeDate === "2026-10-29", "date 29 oct 2026");
  assert(parsed.grossSavingsEur !== parsed.proposedInsuranceTotalEur, "ne pas confondre économie / nouvelle");

  const mail = buildStudyClientEmailHtml({
    clientPrenom: "Maxence",
    grossSavingsEur: parsed.grossSavingsEur,
    feesCourtageTotalEur: 200,
    feesAssureurEur: parsed.feesAssureurEur,
    currentInsuranceTotalEur: parsed.currentInsuranceTotalEur,
    proposedInsuranceTotalEur: parsed.proposedInsuranceTotalEur,
  });
  assert(/mesurée/i.test(mail.html), "intro palier < 2k");
  assert(/710/.test(mail.html), "710 dans le mail");
  assert(!/1\s*430/.test(mail.subject + mail.html.split("Nouvelle solution")[0]), "pas 1430 en accroche");
}

async function main() {
  await verifyLegacyMartin();
  await verifyV2Raimbault();
  await verifyV3MaxenceMensualites();
  console.log("\nParse PDF études OK.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
