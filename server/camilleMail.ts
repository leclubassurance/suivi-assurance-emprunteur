import { computeDocumentChecklistForDossier } from "../shared/documentChecklist";
import { buildLoanDocsAnalysisReport } from "../shared/loanDocAnalysis";
import { assessCertainLoanDocProblems } from "./loanDocCertainty";
import { hasStudyBeenSent } from "./dossierLifecycle";
import { clientHasAcceptedInsuranceChange } from "./insuranceAcceptance";
import { resolveLoanDocPresence } from "./loanDocPresence";
import { stripRedundantSalutations } from "./camilleClientMessage";
import { getSharedIdentityDocsFromSiblings } from "./clientMultipleDossiers";
import { wrapLcifClientEmailHtml } from "../shared/emailBrand";
import {
  buildCamilleDossierSituationBlock,
  buildSubscriptionGuidanceForPhase,
  formatStudyKpiForAi,
  getSubscriptionPhaseLabel,
} from "./camilleDossierTimeline";
import { getLastStudyOutbound } from "./dossierLifecycle";
import { resolveEffectiveSubscriptionPhase } from "./subscriptionProgress";

function parisYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Déjà un mail sortant vers le client aujourd'hui (Paris) sur ce dossier. */
export function hasClientOutboundTodayParis(dossier: any, now = new Date()): boolean {
  const today = parisYmd(now);
  for (const c of dossier?.communications || []) {
    if (c.direction !== "outbound") continue;
    const raw = c.date;
    if (!raw) continue;
    const t = new Date(raw);
    if (!Number.isFinite(t.getTime())) continue;
    if (parisYmd(t) === today) return true;
  }
  return false;
}

/** « Bonjour » seulement sur le premier mail sortant du jour (fil en cours). */
export function shouldIncludeCamilleDailyGreeting(dossier: any, now = new Date()): boolean {
  if (!dossier) return true;
  return !hasClientOutboundTodayParis(dossier, now);
}

export function wrapCamilleHtmlReply(
  bodyText: string,
  clientPrenom?: string,
  clientNom?: string,
  dossier?: any,
) {
  const includeGreeting = shouldIncludeCamilleDailyGreeting(dossier);
  const greeting = includeGreeting
    ? clientPrenom
      ? `Bonjour ${clientPrenom},`
      : "Bonjour,"
    : "";
  const cleaned = stripRedundantSalutations(bodyText, {
    prenom: clientPrenom,
    nom: clientNom,
  });
  const inner = cleaned.replace(/\n/g, "<br/>");

  const header = greeting
    ? `<p style="color: #1E3A8A; font-weight: bold; margin: 0 0 12px 0;">${greeting}</p>\n  `
    : "";

  return wrapLcifClientEmailHtml(`${header}<div>${inner}</div>`);
}

export function buildCamilleContextBlock(
  dossier: any,
  newAttachmentNames: string[] = [],
  allDossiers?: any[],
) {
  const checklist = computeDocumentChecklistForDossier(dossier);
  let siblingIdentityNote = "";
  if (allDossiers && allDossiers.length > 0) {
    const shared = getSharedIdentityDocsFromSiblings(allDossiers, dossier);
    if (shared.details.length > 0) {
      siblingIdentityNote = `\nAutres contrats du même client : ${shared.details.join(" ; ")}. Ne pas redemander CNI/RIB sur ce dossier si déjà présents ailleurs.`;
    }
  }
  const studySent = hasStudyBeenSent(dossier);
  const clientAccepted = clientHasAcceptedInsuranceChange(dossier);
  const missingBlocking = clientAccepted
    ? checklist.filter((c) => !c.ok && (c.key === "cni" || c.key === "rib"))
    : studySent
      ? []
      : checklist.filter(
          (c) =>
            (c.key === "offre" || c.key === "amort") &&
            (c.status === "missing" || c.status === "review"),
        );
  const loan = resolveLoanDocPresence(dossier);
  const docs = (dossier.formData?.documents || []) as any[];
  const qualityIssues = docs
    .filter((d) => d?.quality && d.quality.ok === false)
    .map((d) => `${d.name || d.id}: ${(d.quality.reasons || []).join(", ")}`)
    .slice(0, 6);

  const offerDocs = docs.filter((d) => d?.category === "offre" || d?.category === "fiche");
  const tableauDocs = docs.filter((d) => d?.category === "tableau");

  const offerOk = offerDocs.some((d) => d?.loanSignal?.ok && d?.loanSignal?.matchesExpected);
  const tableauOk = tableauDocs.some((d) => d?.loanSignal?.ok && d?.loanSignal?.matchesExpected);
  const strongMismatch =
    offerDocs.some((d) => d?.loanSignal && d.loanSignal.ok === false) ||
    tableauDocs.some((d) => d?.loanSignal && d.loanSignal.ok === false) ||
    qualityIssues.length >= 2;

  const docsReliability: "low" | "medium" | "high" =
    loan.exploitable ? "high" : strongMismatch ? "low" : "medium";

  const docProblemAssessment = assessCertainLoanDocProblems(dossier);

  const clientSafeReason =
    loan.exploitable
      ? "les documents de prêt sont exploitables pour l'étude"
      : loan.filesPresent && loan.needsResubmit
        ? "nous avons besoin des PDF complets depuis la banque (offre + tableau)"
        : "nous avons besoin de l'offre de prêt et du tableau d'amortissement au format PDF banque";

  const documentAnalysisReport = buildLoanDocsAnalysisReport(docs);
  const loanClientGuidance = [...offerDocs, ...tableauDocs]
    .map((d) => d?.loanSignal?.clientHint)
    .filter(Boolean)
    .slice(0, 2)
    .join("\n");

  const statusLabel = (st?: string) =>
    st === "ok" ? "validé" : st === "review" ? "reçu — à préciser" : "manquant";

  const subscriptionPhase = resolveEffectiveSubscriptionPhase(dossier);
  const lastStudy = getLastStudyOutbound(dossier);
  const studyKpiSummary = formatStudyKpiForAi(dossier);
  const dossierSituationBlock = buildCamilleDossierSituationBlock(dossier);

  return {
    checklist,
    missingBlocking,
    loanDocsPresent: loan.filesPresent,
    loanDocsOk: loan.exploitable,
    newAttachmentNames,
    qualityIssues,
    docsReliability,
    certainDocProblems: docProblemAssessment.certain,
    certainDocProblemsDetail: docProblemAssessment.problems,
    uncertainDocSignals: docProblemAssessment.uncertainSignals,
    clientSafeReason,
    documentSummary:
      checklist
        .map((c) => {
          const files = c.matchedFiles?.length ? ` (${c.matchedFiles.join(", ")})` : "";
          const st = c.status || (c.ok ? "ok" : "missing");
          return `${c.label}: ${statusLabel(st)}${files}${c.reviewHint && st !== "ok" ? ` — ${c.reviewHint}` : ""}`;
        })
        .join("\n") + siblingIdentityNote,
    documentAnalysisReport,
    loanClientGuidance,
    loanOffreExploitable: loan.offreExploitable,
    loanAmortExploitable: loan.amortExploitable,
    studySent,
    clientAcceptedInsurance: clientAccepted,
    identityDocsMayBeRequested: clientAccepted,
    dossierStatus: String(dossier.status || "NOUVEAU"),
    subscriptionPhase,
    subscriptionPhaseLabel: getSubscriptionPhaseLabel(subscriptionPhase),
    subscriptionGuidance: buildSubscriptionGuidanceForPhase(subscriptionPhase, studySent),
    studyKpiSummary,
    lastStudyOutbound: lastStudy,
    dossierSituationBlock,
  };
}
