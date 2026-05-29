import { computeDocumentChecklist } from "../shared/documentChecklist";
import { buildLoanDocsAnalysisReport } from "../shared/loanDocAnalysis";
import { assessCertainLoanDocProblems } from "./loanDocCertainty";
import { hasStudyBeenSent } from "./dossierLifecycle";
import { resolveLoanDocPresence } from "./loanDocPresence";
import { stripRedundantSalutations } from "./camilleClientMessage";
import { wrapLcifClientEmailHtml } from "../shared/emailBrand";

export function wrapCamilleHtmlReply(
  bodyText: string,
  clientPrenom?: string,
  clientNom?: string,
) {
  const greeting = clientPrenom ? `Bonjour ${clientPrenom},` : "Bonjour,";
  const cleaned = stripRedundantSalutations(bodyText, {
    prenom: clientPrenom,
    nom: clientNom,
  });
  const inner = cleaned.replace(/\n/g, "<br/>");

  return wrapLcifClientEmailHtml(
    `<p style="color: #1E3A8A; font-weight: bold; margin: 0 0 12px 0;">${greeting}</p>
  <div>${inner}</div>`,
  );
}

export function buildCamilleContextBlock(dossier: any, newAttachmentNames: string[] = []) {
  const checklist = computeDocumentChecklist(dossier.formData?.documents || []);
  const studySent = hasStudyBeenSent(dossier);
  const missingBlocking = studySent
    ? checklist.filter((c) => !c.ok && (c.key === "cni" || c.key === "rib"))
    : checklist.filter(
        (c) => (c.key === "offre" || c.key === "amort") && (c.status === "missing" || c.status === "review"),
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
    documentSummary: checklist
      .map((c) => {
        const files = c.matchedFiles?.length ? ` (${c.matchedFiles.join(", ")})` : "";
        const st = c.status || (c.ok ? "ok" : "missing");
        return `${c.label}: ${statusLabel(st)}${files}${c.reviewHint && st !== "ok" ? ` — ${c.reviewHint}` : ""}`;
      })
      .join("\n"),
    documentAnalysisReport,
    loanClientGuidance,
    loanOffreExploitable: loan.offreExploitable,
    loanAmortExploitable: loan.amortExploitable,
  };
}
