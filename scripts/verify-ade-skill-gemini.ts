/**
 * Test Gemini+skill → AdeStudyComputation (+ PDF optionnel).
 *   npx tsx scripts/verify-ade-skill-gemini.ts [devis.pdf] [tableau.pdf]
 */
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { extractPdfTextFromBuffer } from "../server/pdfTextExtract";
import { computeAdeStudyWithSkillGemini } from "../server/adeStudySkillGemini";
import { generateAdeStudyPdfBuffer } from "../server/adeStudyPdfGenerate";

dotenv.config();

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  const devisPath =
    process.argv[2] ||
    path.resolve("/Users/lascaudremi/Downloads/Devis_46369327_27849720.pdf");
  const tableauPath = process.argv[3];

  assert(fs.existsSync(devisPath), `devis missing: ${devisPath}`);
  const devisText = await extractPdfTextFromBuffer(fs.readFileSync(devisPath));
  let scheduleText = "";
  if (tableauPath && fs.existsSync(tableauPath)) {
    scheduleText = await extractPdfTextFromBuffer(fs.readFileSync(tableauPath));
  } else {
    console.warn("Pas de tableau fourni — Gemini risque d'échouer sur le coût actuel.");
    scheduleText = "Tableau non fourni pour ce test.";
  }

  const res = await computeAdeStudyWithSkillGemini({
    clientName: "Lilian Dubreil",
    effectDateIso: "2026-10-10",
    assuresSummary: "Lilian Dubreil",
    scheduleText,
    devisText,
  });
  console.log(JSON.stringify(res, null, 2).slice(0, 4000));
  assert(res.ok, res.ok ? "" : res.error);
  assert(res.computation.proposedTotalEur > 0, "proposed");
  assert(res.computation.provider === "gemini", "provider gemini");

  if (res.computation.currentTotalEur > 0) {
    const buf = await generateAdeStudyPdfBuffer(res.computation);
    const out = path.join("/tmp", `ade-skill-gemini-${Date.now()}.pdf`);
    fs.writeFileSync(out, buf);
    console.log(`PDF=${out} (${Math.round(buf.length / 1024)} Ko) years=${res.computation.years.length}`);
  }
  console.log("\nGemini+skill OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
