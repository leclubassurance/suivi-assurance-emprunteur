import { computeDocumentChecklist } from "../shared/documentChecklist";
import { assessCertainLoanDocProblems } from "./loanDocCertainty";

function stripLeadingGreeting(bodyText: string) {
  const raw = String(bodyText || "").trim();
  if (!raw) return "";
  const lines = raw.split(/\r?\n/);
  let i = 0;
  // Remove 1-3 leading greeting lines like "Bonjour", "Bonjour X,", "Bonjour Monsieur Y,"
  while (i < lines.length && i < 3) {
    const l = lines[i].trim();
    if (!l) {
      i++;
      continue;
    }
    if (/^bonjour\b/i.test(l)) {
      i++;
      continue;
    }
    break;
  }
  return lines.slice(i).join("\n").trim();
}

export function wrapCamilleHtmlReply(bodyText: string, clientPrenom?: string) {
  const greeting = clientPrenom ? `Bonjour ${clientPrenom},` : "Bonjour,";
  const cleaned = stripLeadingGreeting(bodyText);
  const inner = cleaned.replace(/\n/g, "<br/>");

  return `<div style="font-family: Arial, sans-serif; color: #334155; max-width: 600px; line-height: 1.55; font-size: 14px;">
  <img src="https://res.cloudinary.com/dji8akleo/image/upload/v1772999309/5_yn8wfm.png" alt="Le Club Immobilier Français" style="max-width: 140px; margin-bottom: 16px;" />
  <p style="color: #1E3A8A; font-weight: bold; margin: 0 0 12px 0;">${greeting}</p>
  <div>${inner}</div>
  <div style="margin-top: 24px; padding-top: 14px; border-top: 1px solid #EFF6FF;">
    <p style="margin: 0; color: #1E3A8A; font-weight: bold;">Camille</p>
    <p style="margin: 2px 0 0 0; font-size: 12px; color: #64748B;">Assistante de Charles — Le Club Immobilier Français</p>
  </div>
</div>`;
}

export function buildCamilleContextBlock(dossier: any, newAttachmentNames: string[] = []) {
  const checklist = computeDocumentChecklist(dossier.formData?.documents || []);
  const missingBlocking = checklist.filter((c) => !c.ok && (c.key === "cni" || c.key === "rib"));
  const loanDocs = checklist.filter((c) => c.key === "offre" || c.key === "amort");
  const docs = (dossier.formData?.documents || []) as any[];
  const qualityIssues = docs
    .filter((d) => d?.quality && d.quality.ok === false)
    .map((d) => `${d.name || d.id}: ${(d.quality.reasons || []).join(", ")}`)
    .slice(0, 6);

  const offerDocs = docs.filter((d) => d?.category === "offre");
  const tableauDocs = docs.filter((d) => d?.category === "tableau");
  const offerSignals = offerDocs.map((d) => d?.loanSignal).filter(Boolean);
  const tableauSignals = tableauDocs.map((d) => d?.loanSignal).filter(Boolean);

  // Reliability for "docs exploitability" topic:
  // - high: both offer+tableau present and their PDF signals are ok (or no signal but quality ok)
  // - medium: present but some warnings
  // - low: missing or strong mismatch signals
  const offerOk = offerDocs.length > 0 && offerDocs.some((d) => d?.loanSignal?.ok || d?.quality?.ok);
  const tableauOk = tableauDocs.length > 0 && tableauDocs.some((d) => d?.loanSignal?.ok || d?.quality?.ok);
  const strongMismatch =
    offerDocs.some((d) => d?.loanSignal && d.loanSignal.ok === false) ||
    tableauDocs.some((d) => d?.loanSignal && d.loanSignal.ok === false) ||
    qualityIssues.length >= 2;

  const docsReliability: "low" | "medium" | "high" =
    offerOk && tableauOk && !strongMismatch ? "high" : strongMismatch ? "low" : "medium";

  const docProblemAssessment = assessCertainLoanDocProblems(dossier);

  // Client-safe explanation snippets (never mention "bad/illegible", but explain need for exact docs)
  const clientSafeReason =
    docsReliability === "high"
      ? "certains éléments indispensables ne figurent pas clairement dans les documents reçus"
      : docsReliability === "medium"
        ? "nous avons besoin des documents complets pour éviter toute approximation"
        : "nous avons besoin des versions complètes au bon format pour finaliser l’étude";

  return {
    checklist,
    missingBlocking,
    loanDocsOk: loanDocs.every((c) => c.ok),
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
        return `${c.label}: ${c.ok ? "reçu" : "manquant"}${files}`;
      })
      .join("\n"),
  };
}
