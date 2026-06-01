import { computeDocumentChecklistForDossier } from "../shared/documentChecklist";
import type { LoanDocProblemAssessment, CertainLoanDocProblem } from "./loanDocCertainty";
import { assessCertainLoanDocProblems } from "./loanDocCertainty";
import { resolveLoanDocPresence } from "./loanDocPresence";
import { hasStudyBeenSent } from "./dossierLifecycle";
import { clientHasAcceptedInsuranceChange } from "./insuranceAcceptance";

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

/** Le mail promet une étude à venir alors qu'elle a déjà été envoyée. */
export function messagePromisesFutureStudy(plain: string): boolean {
  const lower = String(plain || "").toLowerCase();
  return (
    /(étude\s+personnalisée|étude\s+des\s+économies|votre\s+étude).{0,100}(sera\s+prête|vous\s+recontacter|revenir\s+vers|prépar|finalis|prochainement)/i.test(
      lower,
    ) ||
    /(recontacter|revenir\s+vers\s+vous|nous\s+reviendrons).{0,100}(étude|économies)/i.test(lower) ||
    /charles\s+(prépare|finalise)\s+(votre\s+)?étude/i.test(lower) ||
    /poursuiv(re|ons)\s+(votre\s+)?étude/i.test(lower)
  );
}

export function buildPostStudyClientAckMessage(dossier: any): string {
  const a = dossier?.formData?.assures?.[0];
  const prenom = String(a?.prenom || "").trim();
  const agreed = clientHasAcceptedInsuranceChange(dossier);

  const lines = [
    `Merci pour votre message${prenom ? `, ${prenom}` : ""}.`,
    ``,
    agreed
      ? `Nous avons bien pris note de votre accord pour poursuivre le changement d'assurance.`
      : `Nous avons bien pris note de votre message.`,
    `Votre étude personnalisée (économies possibles) vous a déjà été transmise par email ; consultez également vos courriers indésirables si besoin.`,
    agreed
      ? `Charles et notre équipe vous recontactent très prochainement pour la suite du dossier (mise en place et pièces éventuelles de souscription).`
      : `Si vous avez des questions sur l'étude, répondez simplement à ce mail. Lorsque vous souhaiterez activer le changement d'assurance, indiquez-le nous par retour de mail : nous vous guiderons pour la suite.`,
    ``,
    `Pour toute question précise, répondez simplement à ce mail.`,
  ];
  return lines.join("\n");
}

/** Client envoie des pièces prêt après réception de l'étude (complément pour l'analyse). */
export function shouldUsePostStudyComplementaryDocsReply(
  dossier: any,
  context?: { inboundAttachmentNames?: string[]; clientMessage?: string },
): boolean {
  if (!hasStudyBeenSent(dossier)) return false;
  if (clientHasAcceptedInsuranceChange(dossier)) return false;

  const names = (context?.inboundAttachmentNames || []).map((n) => String(n || "").trim()).filter(Boolean);
  if (names.length === 0) return false;

  const onlyIdentity = names.every((n) => {
    const lower = n.toLowerCase();
    const looksIdentity = /cni|rib|identit|passeport|iban/i.test(lower);
    const looksLoan = /offre|tableau|amort|pret|prêt|échéancier|echeancier|banque/i.test(lower);
    return looksIdentity && !looksLoan;
  });
  if (onlyIdentity) return false;

  const msg = String(context?.clientMessage || "").toLowerCase();
  if (/^(merci|bonjour|rebonjour|ok)\s*[.!]?$/i.test(msg.trim()) && names.length === 0) {
    return false;
  }

  return true;
}

/** Accusé réception pièces complémentaires post-étude — satisfaction + substitution, pas de CNI/RIB. */
export function buildPostStudyComplementaryDocsMessage(dossier: any): string {
  const a = dossier?.formData?.assures?.[0];
  const prenom = String(a?.prenom || "").trim();

  const lines = [
    `Merci pour votre message${prenom ? `, ${prenom}` : ""}.`,
    ``,
    `Nous vous remercions pour les documents complémentaires transmis suite à votre étude des économies.`,
    `Je vais en discuter avec Charles afin de vérifier si cela a un impact sur l'étude qui vous a déjà été envoyée.`,
    ``,
    `Êtes-vous tout de même satisfait(e) de l'étude que vous avez reçue ?`,
    `Si cela ne modifie pas les conclusions, seriez-vous d'accord pour poursuivre la substitution de votre assurance emprunteur ?`,
    ``,
    `Nous restons à votre entière disposition pour toute question.`,
  ];
  return lines.join("\n");
}

/** Relance douce post-étude : vérifier réception / questions — sans demander CNI/RIB. */
export function buildStudyReceiptFollowUpMessage(dossier: any): string {
  const a = dossier?.formData?.assures?.[0];
  const prenom = String(a?.prenom || "").trim();
  const lines = [
    `Nous espérons que vous avez bien reçu l'email contenant votre étude personnalisée de vos économies.`,
    `N'hésitez pas à nous indiquer si vous avez pu la consulter ou si vous avez des questions.`,
    ``,
    `Lorsque vous souhaiterez activer le changement d'assurance, répondez à ce mail pour nous le confirmer : nous vous indiquerons alors les prochaines étapes.`,
    ``,
    `Nous restons à votre entière disposition.`,
  ];
  if (prenom) lines.unshift(`Merci pour votre confiance${prenom ? `, ${prenom}` : ""}.`, ``);
  return lines.join("\n");
}

export function messageRequestsMissingIdentityDocs(plain: string): boolean {
  const lower = String(plain || "").toLowerCase();
  const asks =
    /(\bcni\b|carte d.identit|pi[eè]ce d.identit|passeport|\brib\b|iban|relev[eé] d.identit[eé] bancaire)/i.test(
      lower,
    );
  const intent =
    /(manque|envoy|transmet|transmettre|joindre|fournir|besoin|merci de|veuillez|attend)/i.test(
      lower,
    );
  return asks && intent;
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
    }
    // status « review » : vérification admin uniquement — pas de relance client auto
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
  context?: { inboundAttachmentNames?: string[]; clientMessage?: string },
): { text: string; blockedDocRequest: boolean } {
  const a = dossier?.formData?.assures?.[0];
  let text = stripRedundantSalutations(plain, {
    prenom: a?.prenom,
    nom: a?.nom,
  });

  if (
    shouldUsePostStudyComplementaryDocsReply(dossier, {
      inboundAttachmentNames: context?.inboundAttachmentNames,
      clientMessage: context?.clientMessage ?? plain,
    })
  ) {
    text = buildPostStudyComplementaryDocsMessage(dossier);
    text = stripRedundantSalutations(text, { prenom: a?.prenom, nom: a?.nom });
    return { text, blockedDocRequest: true };
  }

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

  if (hasStudyBeenSent(dossier) && (blockedDocRequest || messagePromisesFutureStudy(text))) {
    text = buildPostStudyClientAckMessage(dossier);
    text = stripRedundantSalutations(text, { prenom: a?.prenom, nom: a?.nom });
    return { text, blockedDocRequest: true };
  }

  if (hasStudyBeenSent(dossier) && messageRequestsMissingIdentityDocs(text)) {
    if (!clientHasAcceptedInsuranceChange(dossier)) {
      text = buildStudyReceiptFollowUpMessage(dossier);
      text = stripRedundantSalutations(text, { prenom: a?.prenom, nom: a?.nom });
      return { text, blockedDocRequest: true };
    }
    const checklist = computeDocumentChecklistForDossier(dossier);
    const cniOk = checklist.find((c) => c.key === "cni")?.ok;
    const ribOk = checklist.find((c) => c.key === "rib")?.ok;
    if (cniOk && ribOk) {
      const prenom = String(a?.prenom || "").trim();
      text = [
        `Merci pour votre message${prenom ? `, ${prenom}` : ""}.`,
        ``,
        `Nous avons bien reçu votre pièce d'identité et votre RIB ; merci beaucoup.`,
        `Charles et notre équipe poursuivent la mise en place de votre dossier et vous recontactent très prochainement.`,
        ``,
        `Pour toute précision, répondez simplement à ce mail.`,
      ].join("\n");
      text = stripRedundantSalutations(text, { prenom: a?.prenom, nom: a?.nom });
      return { text, blockedDocRequest: true };
    }
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
