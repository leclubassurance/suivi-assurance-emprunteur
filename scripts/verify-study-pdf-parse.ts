/**
 * Usage: npx tsx scripts/verify-study-pdf-parse.ts [path-to-pdf]
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

async function main() {
  const pdfPath =
    process.argv[2] ||
    path.join(process.env.HOME || "", "Downloads/TEST-ADE-Martin-economie.pdf");
  if (!fs.existsSync(pdfPath)) {
    console.error(`PDF introuvable: ${pdfPath}`);
    process.exit(1);
  }

  const text = await extractPdfTextFromBuffer(fs.readFileSync(pdfPath));
  assert(text.length > 100, `texte extrait (${text.length} car.)`);

  const parsed = parseStudyEconomicsFromPdfText(text);
  console.log(JSON.stringify(parsed, null, 2));

  assert(parsed.confidence === "high", "confiance high");
  assert(parsed.grossSavingsEur != null && Math.abs(parsed.grossSavingsEur - 8268.37) < 0.02, "économie brute");
  assert(parsed.feesAssureurEur === 0, "frais dossier 0");
  assert(parsed.currentInsuranceTotalEur != null && parsed.currentInsuranceTotalEur > 16000, "coût actuel");
  assert(parsed.proposedInsuranceTotalEur != null && parsed.proposedInsuranceTotalEur > 8000, "nouvelle solution");
  assert(parsed.proposedMonthlyYear1Eur != null && Math.abs(parsed.proposedMonthlyYear1Eur - 790.42) < 0.02, "mensuel an 1");
  assert(parsed.annualPremiumEur != null && Math.abs(parsed.annualPremiumEur - 9485.04) < 0.02, "prime annuelle");
  assert(parsed.loanCapitalEur === 250000, "capital prêt");
  assert(parsed.plannedChangeDate === "2026-10-01", "date d'effet");
  assert(parsed.savingsPercent != null && Math.abs(parsed.savingsPercent - 50.1) < 0.05, "% économies");

  const mail = buildStudyClientEmailHtml({
    clientPrenom: "Martin",
    grossSavingsEur: parsed.grossSavingsEur,
    feesCourtageTotalEur: 400,
    plannedChangeDate: parsed.plannedChangeDate,
  });
  assert(/Frais de courtage\s*:\s*<strong>400/.test(mail.html), "courtage patchable");
  assert(/8\s*268/.test(mail.html) || /8268/.test(mail.html), "économie dans mail type");
  assert(/pièce jointe/i.test(mail.html), "mention PJ");
  assert(/1E3A8A/.test(mail.html), "bandeau marque");
  assert(/Charles Victor/.test(mail.html), "signature");
  assert(/Date de changement prévue\s*:\s*<strong>/i.test(mail.html), "date patchable");

  const { patchStudyHtmlBrokerageFee } = await import("../shared/studyHtmlPatch");
  const patched = patchStudyHtmlBrokerageFee(mail.html, 550);
  assert(patched.patched && /550/.test(patched.html), "patch courtage OK");

  console.log("\nParse PDF étude OK.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
