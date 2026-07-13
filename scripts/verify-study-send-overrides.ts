/**
 * Usage: npx tsx scripts/verify-study-send-overrides.ts
 */
import { buildEconomyHtmlDraft } from "../server/economyMailDraft";
import {
  applyStudyHtmlOverridesToDossier,
  resolveStudyEmailHtmlForSend,
} from "../shared/studyEmailForSend";
import {
  resolveStudyFeesCourtageForSend,
  resolveStudyPlannedChangeDate,
} from "../shared/studySendResolution";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const comp = {
  ok: true,
  reliability: "HIGH" as const,
  reasons: [],
  extracted: {
    feesAssureurTotal: 220,
    feesCourtierTotal: 720,
    proposedMonthlyByYear: [{ year: 1, monthly: 42.5 }],
  },
  result: {
    grossSavings: 12000,
    currentTotalRemaining: 50000,
    proposedTotalRemaining: 38000,
    table: [
      {
        label: "Année 1",
        currentMonthly: 55,
        proposedMonthly: 42.5,
        gainMonthly: 12.5,
      },
    ],
  },
};

const baseDossier = {
  formData: { assures: [{ prenom: "Jean" }] },
  studyConseillerValidation: {
    status: "approved",
    feesCourtageTotalEur: 900,
    html: "",
  },
};

const { html: draftHtml } = buildEconomyHtmlDraft(baseDossier, comp as any);
const htmlWithDate = `${draftHtml.replace(
  "Bonjour Jean,",
  "Bonjour Jean,</p>\n<p style=\"font-size:14px;margin:0 0 16px 0;color:#1F2937;\">Date de changement prévue : <strong>15 juillet 2026</strong>",
)}`;

const manualDossier = {
  ...baseDossier,
  studyDraft: { html: htmlWithDate },
  studyKpi: { source: "manual", feesCourtageEur: 450 },
  insuranceChangePlan: { plannedDate: "2026-09-01", source: "manual" },
  studyConseillerValidation: {
    status: "approved",
    feesCourtageTotalEur: 900,
    html: htmlWithDate,
  },
};

assert(resolveStudyFeesCourtageForSend(manualDossier) === 450, "courtage manuel prioritaire");
assert(resolveStudyPlannedChangeDate(manualDossier) === "2026-09-01", "date manuelle");

const sentHtml = resolveStudyEmailHtmlForSend({
  draftHtml: htmlWithDate,
  validation: manualDossier.studyConseillerValidation,
  dossier: manualDossier,
});
assert(sentHtml.includes("450,00 €"), "HTML envoyé avec courtage manuel");
assert(!sentHtml.includes("900,00 €"), "HTML sans courtage conseiller");
assert(sentHtml.includes("1 septembre 2026"), "HTML avec date septembre");
assert(!sentHtml.includes("15 juillet 2026"), "HTML sans date juillet");

applyStudyHtmlOverridesToDossier(manualDossier as any);
assert(
  String(manualDossier.studyDraft.html).includes("450,00 €"),
  "brouillon patché courtage",
);
assert(
  String(manualDossier.studyDraft.html).includes("1 septembre 2026"),
  "brouillon patché date",
);

console.log("\nOverrides envoi étude OK.");
