import { computeDocumentChecklist } from "../shared/documentChecklist";
import { inferDocumentCategory } from "../shared/documentClassifier";
import { isLoanSlotExploitable } from "../shared/loanDocAnalysis";
import { assessCertainLoanDocProblems } from "./loanDocCertainty";
import { hasStudyBeenSent } from "./dossierLifecycle";
import type { Dossier } from "./dossierModel";

function isPdfLike(doc: any): boolean {
  const name = String(doc?.name || "").toLowerCase();
  const type = String(doc?.type || "").toLowerCase();
  return /\.pdf$/i.test(name) || type.includes("pdf") || String(doc?.id || "").toLowerCase().includes("pdf");
}

function isBlockingIdentityDoc(doc: any): boolean {
  const cat = inferDocumentCategory(doc);
  return cat === "cni" || cat === "rib";
}

/** Offre + tableau présents (fichiers reçus), indépendamment de la qualité PDF. */
export function resolveLoanDocPresence(dossier: Dossier | any) {
  const docs = (dossier?.formData?.documents || []) as any[];
  const checklist = computeDocumentChecklist(docs);
  const offreItem = checklist.find((c) => c.key === "offre");
  const amortItem = checklist.find((c) => c.key === "amort");

  let offrePresent = Boolean(offreItem?.ok);
  let amortPresent = Boolean(amortItem?.ok);

  if (!offrePresent) {
    offrePresent = docs.some((d) => {
      const cat = inferDocumentCategory(d);
      return cat === "offre" || cat === "fiche";
    });
  }
  if (!amortPresent) {
    amortPresent = docs.some((d) => inferDocumentCategory(d) === "tableau");
  }

  if (!offrePresent || !amortPresent) {
    const loanCandidates = docs.filter((d) => !isBlockingIdentityDoc(d) && isPdfLike(d));
    if (loanCandidates.length >= 2) {
      if (!offrePresent) offrePresent = true;
      if (!amortPresent) amortPresent = true;
    }
  }

  const filesPresent = offrePresent && amortPresent;
  const docProb = assessCertainLoanDocProblems(dossier);
  const studySent = hasStudyBeenSent(dossier);
  const offreExploitable = isLoanSlotExploitable(docs, "offre");
  const amortExploitable = isLoanSlotExploitable(docs, "tableau");
  const exploitable = offreExploitable && amortExploitable;
  const needsResubmit = filesPresent && !exploitable && !studySent;

  return {
    offrePresent,
    amortPresent,
    filesPresent,
    exploitable,
    needsResubmit,
    studySent,
    docProb,
    checklistOffreOk: offreItem?.status === "ok" || offreExploitable,
    checklistAmortOk: amortItem?.status === "ok" || amortExploitable,
    offreExploitable,
    amortExploitable,
  };
}

/** Étape portail « offre + tableau » : validée si exploitables ou étude déjà envoyée. */
export function isLoanDocsStepComplete(dossier: Dossier | any): boolean {
  const loan = resolveLoanDocPresence(dossier);
  if (loan.studySent) return true;
  if (loan.exploitable) return true;
  return false;
}

export function loanDocsStepHint(dossier: Dossier | any): string {
  const loan = resolveLoanDocPresence(dossier);
  if (loan.studySent || loan.exploitable) {
    return "Documents reçus et exploitables";
  }
  if (loan.filesPresent && loan.needsResubmit) {
    return "Nous avons bien reçu vos fichiers. Pour finaliser l'analyse, merci de renvoyer l'offre de prêt et le tableau d'amortissement en PDF complets, téléchargés depuis votre espace client bancaire (évitez les photos et captures d'écran).";
  }
  if (loan.filesPresent) {
    return "Documents reçus — notre équipe vérifie leur contenu";
  }
  return "Merci d'envoyer l'offre de prêt et le tableau d'amortissement en PDF depuis votre banque en ligne";
}
