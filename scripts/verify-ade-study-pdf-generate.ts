import { generateAdeStudyPdfBuffer } from "../server/adeStudyPdfGenerate";
import { extractPdfTextFromBuffer } from "../server/pdfTextExtract";
import { parseStudyEconomicsFromPdfText } from "../shared/studyPdfEconomicsParse";

async function main() {
  const comp = {
    effectDateIso: "2026-10-27",
    currentTotalEur: 19718.21,
    proposedTotalEur: 11834.89,
    feesAssureurEur: 170,
    grossSavingsEur: 7883.32,
    netSavingsEur: 7713.32,
    savingsPercent: 39.1,
    year1ProposedEur: 443.16,
    years: [
      {
        year: 1,
        currentEur: 1348.29,
        proposedEur: 443.16,
        netSavingEur: 735.13,
        cumulNetEur: 735.13,
      },
    ],
    monthsCompared: 295,
    guarantees: [{ label: "DC", current: "Oui", proposed: "Oui" }],
    assumptions: ["test"],
    warnings: [] as string[],
    confidence: "high" as const,
    clientName: "Laura Raimbault",
    provider: "mixed" as const,
  };

  const buf = await generateAdeStudyPdfBuffer(comp);
  const text = await extractPdfTextFromBuffer(buf);
  const parsed = parseStudyEconomicsFromPdfText(text);
  console.log("gross", parsed.grossSavingsEur);
  console.log("net", parsed.netSavingsEur);
  console.log("fees", parsed.feesAssureurEur);
  console.log("current", parsed.currentInsuranceTotalEur);
  console.log("proposed", parsed.proposedInsuranceTotalEur);
  console.log("date", parsed.plannedChangeDate);
  console.log("year1", parsed.proposedYear1RawEur, parsed.year1ValuesAreAnnual);
  if (parsed.grossSavingsEur == null) {
    console.log("TEXT PREVIEW:\n", text.slice(0, 1200));
    process.exit(1);
  }
  console.log("OK generated PDF is parseable");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
