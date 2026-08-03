/**
 * Usage: npx tsx scripts/verify-ade-feasibility.ts
 */
import {
  assessAdeStudyFeasibility,
  ADE_FEASIBILITY_PASS_SCORE,
} from "../server/adeStudyFeasibility";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main() {
  const killian = await assessAdeStudyFeasibility({
    formData: {
      assures: [{}],
      documents: [
        {
          category: "tableau",
          name: "primolis.pdf",
          type: "application/pdf",
          localPath: "/Users/lascaudremi/Downloads/tableau amortissement PH primolis 3 PAL.pdf",
        },
        {
          category: "tableau",
          name: "ptz.pdf",
          type: "application/pdf",
          localPath: "/Users/lascaudremi/Downloads/tableau amortissement PTZ Killian.pdf",
        },
        {
          category: "tableau",
          name: "primo.pdf",
          type: "application/pdf",
          localPath: "/Users/lascaudremi/Downloads/tableau amortissement prêt primo jeune Killian.pdf",
        },
        {
          category: "devis",
          name: "devis.pdf",
          type: "application/pdf",
          localPath: "/Users/lascaudremi/Downloads/Devis_46424164_27906781.pdf",
        },
      ],
    },
  });

  console.log("Killian score", killian.score, "/", killian.max, "pass=", killian.pass);
  console.log(
    "  current",
    killian.summary.currentTotalEur,
    "proposed",
    killian.summary.proposedTotalEur,
    "fees",
    killian.summary.feesAssureurEur,
  );
  assert(killian.score >= ADE_FEASIBILITY_PASS_SCORE, `Killian score ≥ ${ADE_FEASIBILITY_PASS_SCORE} (auto PDF)`);
  assert(killian.pass === true, "Killian pass (mode auto)");
  assert(killian.mode === "auto", "Killian mode auto");
  assert(killian.summary.currentTotalEur === 4426.94, "Killian current 4426.94");

  const incomplete = await assessAdeStudyFeasibility({
    formData: {
      assures: [{}],
      documents: [
        {
          category: "tableau",
          name: "primolis.pdf",
          type: "application/pdf",
          localPath: "/Users/lascaudremi/Downloads/tableau amortissement PH primolis 3 PAL.pdf",
        },
      ],
    },
  });
  console.log("Incomplete (no devis) score", incomplete.score, "/", incomplete.max, "pass=", incomplete.pass, "mode=", incomplete.mode);
  assert(incomplete.pass === false, "Incomplete must not pass");
  assert(incomplete.mode === "full_manual", "Incomplete → full_manual");

  console.log("\nADE feasibility OK.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
