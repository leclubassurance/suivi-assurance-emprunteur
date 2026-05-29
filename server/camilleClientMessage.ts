import { computeDocumentChecklistForDossier } from "../shared/documentChecklist";
import type { LoanDocProblemAssessment, CertainLoanDocProblem } from "./loanDocCertainty";
import { assessCertainLoanDocProblems } from "./loanDocCertainty";
import { resolveLoanDocPresence } from "./loanDocPresence";
import { hasStudyBeenSent } from "./dossierLifecycle";

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Retire les formules d'accueil en tête de corps — wrapCamilleHtmlReply ajoute déjà « Bonjour {prénom}, ».
 */
export function stripRedundantSalutations(
  bodyText: string,
  options?: { prenom?: string; nom?: string },
): string {
  const prenom = String(options?.prenom || "").trim();
  const nom = String(options?.nom || "").trim();
  let lines = String(bodyText || "")
    .replace(/\r\n/g, "\n")
    .split("\n");

  const greetingPatterns: RegExp[] = [
    /^bonjour\b/i,
    /^bonsoir\b/i,
    /^coucou\b/i,
    /^ch[eè]re?\s+(madame|monsieur|m\.|mme)\b/i,
    /^cher\s+(madame|monsieur|m\.|mme)\b/i,
    /^madame\b/i,
    /^monsieur\b/i,
    /^mme\.?\s/i,
    /^m\.\s/i,
    /^salutations\b/i,
  ];

  if (prenom) {
    const p = escapeRegex(prenom);
    greetingPatterns.push(new RegExp(`^${p}\\s*[,!]?\\s*$`, "i"));
    greetingPatterns.push(new RegExp(`^ch[eè]re?\\s+(madame|monsieur)\\s+${p}`, "i"));
    greetingPatterns.push(new RegExp(`^cher\\s+(madame|monsieur)\\s+${p}`, "i"));
    greetingPatterns.push(new RegExp(`^bonjour\\s+${p}`, "i"));
  }
  if (nom) {
    const n = escapeRegex(nom);
    greetingPatterns.push(new RegExp(`^ch[eè]re?\\s+madame\\s+${n}`, "i"));
    greetingPatterns.push(new RegExp(`^cher\\s+monsieur\\s+${n}`, "i"));
  }

  let i = 0;
  while (i < lines.length && i < 10) {
    const l = lines[i].trim();
    if (!l) {
      i++;
      continue;
    }
    if (greetingPatterns.some((rx) => rx.test(l))) {
      i++;
      continue;
    }
    break;
  }

  let rest = lines.slice(i).join("\n").trim();

  if (prenom) {
    const p = escapeRegex(prenom);
    rest = rest
      .replace(new RegExp(`^\\s*ch[eè]re?\\s+(madame|monsieur)\\s+${p}\\s*,?\\s*`, "i"), "")
      .replace(new RegExp(`^\\s*bonjour\\s+${p}\\s*,?\\s*`, "i"), "")
      .trim();
  }

  return rest;
}

/** Détecte une demande de pièces prêt alors qu'elles sont déjà dans le dossier (sans problème certain). */
export function messageRequestsMissingLoanDocs(plain: string): boolean {
  const lower = String(plain || "").toLowerCase();
  const asksLoan =
    /offre de pr[eê]t/.test(lower) ||
    /tableau d.amortissement/.test(lower) ||
    /[eé]ch[eé]ancier/.test(lower);
  const asksSend =
    /(manque|manquent|pas reçu|pas encore reçu|nous aurions besoin|besoin de recevoir|merci de nous (envoyer|transmettre)|veuillez nous envoyer|pourriez-vous nous envoyer|afin de recevoir)/i.test(
      lower,
    );
  return asksLoan && asksSend;
}

export function refineLoanDocFollowUpAssessment(
  dossier: any,
  assessment: LoanDocProblemAssessment,
): LoanDocProblemAssessment {
  const loan = resolveLoanDocPresence(dossier);

  if (loan.exploitable || loan.studySent) {
    return { certain: false, problems: [], uncertainSignals: assessment.uncertainSignals };
  }

  if (loan.filesPresent && !loan.needsResubmit) {
    return { certain: false, problems: [], uncertainSignals: assessment.uncertainSignals };
  }

  const problems = assessment.problems.filter((p) => {
    if (p.category === "offre") return !loan.offrePresent || loan.needsResubmit;
    if (p.category === "tableau") return !loan.amortPresent || loan.needsResubmit;
    return true;
  });

  return {
    certain: problems.length > 0,
    problems,
    uncertainSignals: assessment.uncertainSignals,
  };
}

/** Problèmes certains + slots OCR « à préciser » → mail client, pas alerte Rémi. */
export function assessLoanDocFollowUpAssessment(dossier: any): LoanDocProblemAssessment {
  const base = refineLoanDocFollowUpAssessment(dossier, assessCertainLoanDocProblems(dossier));
  if (base.certain || hasStudyBeenSent(dossier)) return base;

  const loan = resolveLoanDocPresence(dossier);
  if (loan.exploitable || loan.studySent) return base;

  const checklist = computeDocumentChecklistForDossier(dossier);
  const extra: CertainLoanDocProblem[] = [];

  for (const key of ["offre", "amort"] as const) {
    const item = checklist.find((c) => c.key === key);
    if (!item || item.status === "ok") continue;
    const category = key === "offre" ? "offre" : "tableau";
    const fileName = item.matchedFiles?.[0] || item.label;
    if (item.status === "missing") {
      extra.push({
        kind: "wrong_doc_kind",
        category,
        fileName,
        detail: "document manquant pour l'étude",
      });
    } else if (item.status === "review") {
      extra.push({
        kind: "wrong_doc_kind",
        category,
        fileName,
        detail: item.reviewHint || "à préciser — PDF banque conseillé",
      });
    }
  }

  const problems = [...base.problems, ...extra].filter(
    (p, i, arr) =>
      arr.findIndex((x) => x.category === p.category && x.kind === p.kind) === i,
  );

  return {
    certain: problems.length > 0,
    problems,
    uncertainSignals: base.uncertainSignals,
  };
}

export function shouldScheduleLoanDocFollowUp(dossier: any): {
  allowed: boolean;
  reason?: string;
  loan: ReturnType<typeof resolveLoanDocPresence>;
} {
  const loan = resolveLoanDocPresence(dossier);
  if (loan.studySent) {
    return { allowed: false, reason: "study_sent", loan };
  }
  if (loan.exploitable) {
    return { allowed: false, reason: "docs_exploitable", loan };
  }
  if (loan.filesPresent && !loan.needsResubmit) {
    return { allowed: false, reason: "docs_present_ok", loan };
  }
  return { allowed: true, loan };
}

/**
 * Nettoie le corps client et bloque les demandes de pièces déjà présentes.
 */
export function sanitizeCamilleClientMessage(
  plain: string,
  dossier: any,
): { text: string; blockedDocRequest: boolean } {
  const a = dossier?.formData?.assures?.[0];
  let text = stripRedundantSalutations(plain, {
    prenom: a?.prenom,
    nom: a?.nom,
  });

  const loan = resolveLoanDocPresence(dossier);
  let blockedDocRequest =
    loan.filesPresent && !loan.needsResubmit && messageRequestsMissingLoanDocs(text);

  if (
    !hasStudyBeenSent(dossier) &&
    /(\bcni\b|passeport|\brib\b|iban|relevé d.identité)/i.test(text) &&
    /(manque|envoy|transmet|besoin|merci de|veuillez)/i.test(text)
  ) {
    blockedDocRequest = true;
    text = [
      `Merci pour votre message${String(a?.prenom || "").trim() ? `, ${String(a?.prenom).trim()}` : ""}.`,
      ``,
      `Pour l'étude de votre assurance emprunteur, nous avons surtout besoin de l'offre de prêt et du tableau d'amortissement complets en PDF depuis votre espace bancaire.`,
      `La pièce d'identité et le RIB vous seront demandés plus tard, uniquement si vous souhaitez poursuivre la souscription après présentation de l'étude.`,
      ``,
      `Si vous avez une question précise, répondez à ce mail.`,
    ].join("\n");
    text = stripRedundantSalutations(text, { prenom: a?.prenom, nom: a?.nom });
    return { text, blockedDocRequest };
  }

  if (blockedDocRequest) {
    const prenom = String(a?.prenom || "").trim();
    text = [
      `Merci pour votre message${prenom ? `, ${prenom}` : ""}.`,
      ``,
      `Nous avons bien enregistré votre offre de prêt et votre tableau d'amortissement. Notre équipe poursuit l'analyse de votre dossier.`,
      `Nous vous recontacterons par email dès que votre étude personnalisée sera prête.`,
      ``,
      `Si vous souhaitez ajouter une précision, répondez simplement à ce mail.`,
    ].join("\n");
    text = stripRedundantSalutations(text, { prenom: a?.prenom, nom: a?.nom });
  }

  return { text, blockedDocRequest };
}
