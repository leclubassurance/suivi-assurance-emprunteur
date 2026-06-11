import { Type } from "@google/genai";
import fs from "fs";
import path from "path";
import { computeDocumentChecklist } from "../shared/documentChecklist";
import { buildCamilleContextBlock, wrapCamilleHtmlReply } from "./camilleMail";
import {
  sanitizeCamilleClientMessage,
  shouldUsePostStudyComplementaryDocsReply,
  buildPostStudyComplementaryDocsMessage,
  inboundHasIdentityAttachments,
  buildPostStudyIdentityAttachmentsReply,
} from "./camilleClientMessage";
import { generateContentWithRetry } from "./geminiClient";
import { CAMILLE_PERSONA_PROMPT } from "./camillePersona";
import { buildCamilleKnowledgePromptBlock } from "./camilleKnowledgeDrive";
import { buildProspectCamilleKnowledgeBlock } from "../shared/lcifKnowledge";
import { getPreStudyLoanReminderLabels } from "../shared/documentChecklist";
import { hasStudyBeenSent } from "./dossierLifecycle";
import { clientHasAcceptedInsuranceChange } from "./insuranceAcceptance";
import { tryCamilleDocClarificationInsteadOfEscalation } from "./camilleDocAutoReply";
import { getRecentStaffOutboundSummary, isStaffActivelyHandling } from "./camilleStaffHandoff";
import { getConversationTailForAi, hasUnansweredClientInbound } from "./gmailConversation";
import { logAiAudit } from "./aiAuditLog";
import { buildMultiDossierClientContext } from "./clientMultipleDossiers";
import {
  buildPlaybooksPromptBlock,
  tryPlaybookAutoReply,
} from "./camillePlaybooks";
import {
  isCamilleReviewEnabled,
  shouldForceReviewHeuristic,
} from "./camilleReviewQueue";
import { isLeadDossier } from "./leadDossierMerge";
import { extractNewClientMessageText } from "./emailQuoteStrip";
import {
  buildCamilleOperationalPromptBlock,
  isCamilleReasoningEnabled,
  runCamilleLegacySingleShot,
  runCamilleReasoningPipeline,
  type CamilleOperationalInput,
} from "./camilleReasoningPipeline";
import {
  buildTelegramActionFromReply,
  stripHtmlForTelegram as stripHtmlForNotify,
} from "./camilleTelegramActionNotify";

export async function processIncomingClientEmail(
  dossier: any,
  emailText: string,
  clientEmail: string,
  options?: {
    newAttachmentNames?: string[];
    emailSubject?: string;
    allDossiers?: any[];
    gmailId?: string;
    isProspectLead?: boolean;
  },
) {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes("MY_GEMINI")) {
    console.warn("[AI] GEMINI_API_KEY manquante sur Railway — pas de réponse automatique.");
    return { status: "escalated", reason: "Clé Gemini non configurée sur le serveur." };
  }

  try {
    const prenom = dossier.formData?.assures?.[0]?.prenom || "";
    const attachmentNames = options?.newAttachmentNames || [];
    const nom = dossier.formData?.assures?.[0]?.nom || "";
    const isProspectLead = Boolean(options?.isProspectLead || isLeadDossier(dossier));
    const clientMessageFresh = extractNewClientMessageText(emailText);
    const clientMessageForAi =
      clientMessageFresh.length >= 3 ? clientMessageFresh : emailText;
    const conversationTailEarly = getConversationTailForAi(dossier);

    if (isProspectLead) {
      const { runProspectInboundReply } = await import("./camilleProspectReply");

      const prospectDecision = await runProspectInboundReply({
        dossier,
        clientMessage: clientMessageForAi,
        emailSubject: options?.emailSubject,
        clientEmail,
        prenom,
        nom,
        conversationTail: conversationTailEarly,
      });

      const prospectModel = prospectDecision.model || "gemini-2.5-flash";
      const prospectAudit = { prospectSingleShot: true };

      if (prospectDecision.action === "REVIEW") {
        const question = String(prospectDecision.questionForStaff || "").trim();
        if (isCamilleReviewEnabled() && question.length >= 10) {
          console.log(`[AI] REVIEW prospect pipeline pour ${dossier.id}`);
          logAiAudit(dossier, {
            action: "REVIEW",
            channel: "gmail_auto_reply",
            actor: "Camille",
            outcome: "info",
            model: prospectModel,
            summary: question.slice(0, 200),
            meta: prospectAudit,
          });
          return {
            status: "review",
            questionForStaff: question,
            reason: prospectDecision.reasonForEscalation || "Pipeline prospect — validation équipe",
          };
        }
        return { status: "escalated", reason: question || "Review prospect indisponible" };
      }

      if (prospectDecision.action === "ESCALATE") {
        if (
          isCamilleReviewEnabled() &&
          String(process.env.CAMILLE_REVIEW_INSTEAD_ESCALATE ?? "true").toLowerCase() !== "false"
        ) {
          const question =
            String(prospectDecision.questionForStaff || "").trim() ||
            `Comment répondre au prospect : « ${clientMessageForAi.slice(0, 200)} » ?`;
          return { status: "review", questionForStaff: question, reason: prospectDecision.reasonForEscalation };
        }
        return { status: "escalated", reason: prospectDecision.reasonForEscalation };
      }

      if (prospectDecision.action === "REPLY" && prospectDecision.messageToClient) {
        const plain = prospectDecision.messageToClient;
        console.log(`[AI] Réponse prospect pipeline pour ${dossier.id}`);
        logAiAudit(dossier, {
          action: "REPLY",
          channel: "gmail_auto_reply",
          actor: "Camille",
          outcome: "sent",
          model: prospectModel,
          summary: `Réponse prospect (${prospectModel})`,
          instructionPreview: plain.slice(0, 300),
          meta: prospectAudit,
        });
        const telegramAction = buildTelegramActionFromReply({
          dossier,
          clientMessage: clientMessageForAi,
          replyPlain: plain,
          emailSubject: options?.emailSubject,
          actionKind: "prospect_ai_reply",
          attachmentNames,
        });
        return {
          status: "replied",
          text: wrapCamilleHtmlReply(plain, prenom, nom, dossier),
          replyPlain: plain,
          telegramAction,
        };
      }

      return { status: "escalated", reason: "Pipeline prospect sans réponse" };
    }

    const playbookProspectOk =
      !isProspectLead ||
      String(process.env.CAMILLE_PLAYBOOK_PROSPECT_ENABLED ?? "false").toLowerCase() ===
        "true";
    const playbookHit = playbookProspectOk
      ? await tryPlaybookAutoReply(dossier, clientMessageForAi)
      : null;
    if (playbookHit) {
      let plain = playbookHit.plain;
      if (isProspectLead) {
        const { patchProspectReplyHardRules } = await import("./camilleProspectInbound");
        const { analyzeProspectMessageIntent } = await import("./prospectMessageIntent");
        const intent = analyzeProspectMessageIntent(clientMessageForAi);
        plain = patchProspectReplyHardRules(plain, dossier, clientMessageForAi, {
          shouldIncludeFormLink: intent.shouldIncludeFormLink,
        });
      }
      console.log(`[AI] Réponse playbook ${playbookHit.playbook.id} pour ${dossier.id}`);
      const telegramAction = buildTelegramActionFromReply({
        dossier,
        clientMessage: clientMessageForAi,
        replyPlain: plain,
        emailSubject: options?.emailSubject,
        actionKind: "playbook",
        attachmentNames,
        playbookId: playbookHit.playbook.id,
      });
      return {
        status: "replied",
        text: wrapCamilleHtmlReply(plain, prenom, nom, dossier),
        replyPlain: plain,
        telegramAction,
      };
    }

    if (
      !isProspectLead &&
      hasStudyBeenSent(dossier) &&
      inboundHasIdentityAttachments(attachmentNames)
    ) {
      const nom = dossier.formData?.assures?.[0]?.nom || "";
      const plain = buildPostStudyIdentityAttachmentsReply(dossier, emailText);
      console.log(`[AI] Accusé pièces identité post-étude pour ${dossier.id}`);
      const telegramAction = buildTelegramActionFromReply({
        dossier,
        clientMessage: emailText,
        replyPlain: plain,
        emailSubject: options?.emailSubject,
        actionKind: "template_identity",
        attachmentNames,
      });
      return {
        status: "replied",
        text: wrapCamilleHtmlReply(plain, prenom, nom, dossier),
        replyPlain: plain,
        telegramAction,
      };
    }

    if (
      !isProspectLead &&
      shouldUsePostStudyComplementaryDocsReply(dossier, {
        inboundAttachmentNames: attachmentNames,
        clientMessage: emailText,
      })
    ) {
      const nom = dossier.formData?.assures?.[0]?.nom || "";
      const plain = buildPostStudyComplementaryDocsMessage(dossier);
      console.log(`[AI] Réponse pièces complémentaires post-étude pour ${dossier.id}`);
      const telegramAction = buildTelegramActionFromReply({
        dossier,
        clientMessage: emailText,
        replyPlain: plain,
        emailSubject: options?.emailSubject,
        actionKind: "template_complementary_docs",
        attachmentNames,
      });
      return {
        status: "replied",
        text: wrapCamilleHtmlReply(plain, prenom, nom, dossier),
        replyPlain: plain,
        telegramAction,
      };
    }

    const ctx = buildCamilleContextBlock(dossier, attachmentNames, options?.allDossiers);
    const staffHandling = isStaffActivelyHandling(dossier);
    const staffOutbound = getRecentStaffOutboundSummary(dossier);
    const knowledgeBlock = isProspectLead
      ? buildProspectCamilleKnowledgeBlock()
      : await buildCamilleKnowledgePromptBlock(null, undefined, {
          clientMessage: clientMessageForAi,
          subscriptionPhase: ctx.subscriptionPhase,
          studySent: ctx.studySent,
        });
    const playbooksBlock = await buildPlaybooksPromptBlock(emailText, dossier);
    const studySent = hasStudyBeenSent(dossier);
    const clientAccepted = clientHasAcceptedInsuranceChange(dossier);
    const missingLoanLabels = isProspectLead
      ? []
      : studySent
        ? clientAccepted
          ? ctx.missingBlocking.map((c) => c.label)
          : []
        : getPreStudyLoanReminderLabels(dossier.formData?.documents || []);
    const conversationTail = getConversationTailForAi(dossier);
    const needsReply = hasUnansweredClientInbound(dossier);
    const multiDossier =
      options?.allDossiers && options.allDossiers.length > 0
        ? buildMultiDossierClientContext({
            allDossiers: options.allDossiers,
            dossier,
            emailSubject: options.emailSubject,
            emailBody: emailText,
          })
        : null;

    if (
      !isProspectLead &&
      shouldForceReviewHeuristic(clientMessageForAi, dossier) &&
      isCamilleReviewEnabled()
    ) {
      return {
        status: "review",
        questionForStaff: `Comment répondre à ce mail client ? « ${clientMessageForAi.slice(0, 350)} »`,
        reason: "Situation sensible ou multi-contrat — validation équipe requise",
      };
    }

    let prospectLeadBlock = "";
    if (isProspectLead) {
      const { buildProspectLeadPromptBlock } = await import("./camilleProspectInbound");
      prospectLeadBlock = buildProspectLeadPromptBlock(dossier);
    }

    const operational: CamilleOperationalInput = {
      dossierId: dossier.id,
      clientEmail,
      prenom,
      nom,
      emailSubject: options?.emailSubject,
      emailText: clientMessageForAi,
      attachmentNames,
      ctx,
      staffHandling,
      staffOutbound,
      conversationTail,
      needsReply,
      multiDossierPrompt: multiDossier?.promptBlock,
      multiDossierAmbiguous: multiDossier?.ambiguousTargeting,
      studySent,
      clientAccepted,
      missingLoanLabels,
      isProspectLead,
      prospectLeadBlock,
    };

    const useReasoningPipeline =
      isCamilleReasoningEnabled() &&
      (!isProspectLead ||
        String(process.env.CAMILLE_PROSPECT_REASONING_ENABLED ?? "false").toLowerCase() ===
          "true");

    const decision = useReasoningPipeline
      ? await runCamilleReasoningPipeline({
          knowledgeBlock,
          playbooksBlock: playbooksBlock || "Aucun playbook similaire validé par l'équipe.",
          operational,
        })
      : await runCamilleLegacySingleShot([
          { role: "user", parts: [{ text: CAMILLE_PERSONA_PROMPT }] },
          { role: "user", parts: [{ text: knowledgeBlock }] },
          {
            role: "user",
            parts: [
              {
                text: `${playbooksBlock || "Aucun playbook similaire validé par l'équipe."}\n\n${buildCamilleOperationalPromptBlock(operational)}\n\nDécide REPLY, REVIEW ou ESCALATE.`,
              },
            ],
          },
        ]);

    const pipelineModel =
      "pipeline" in decision && decision.pipeline?.analyzeModel
        ? decision.pipeline.analyzeModel
        : "gemini-2.5-flash";

    const auditMeta = {
      subscriptionPhase: ctx.subscriptionPhase,
      studySent: ctx.studySent,
      clientAccepted: ctx.clientAcceptedInsurance,
      knowledgeInjected: true,
      knowledgeRag: true,
      reasoningPipeline: isCamilleReasoningEnabled(),
      primaryTopic:
        "pipeline" in decision ? decision.pipeline?.analyze?.primaryTopic : undefined,
      planAction: "pipeline" in decision ? decision.pipeline?.plan?.action : undefined,
      critiqueApproved:
        "pipeline" in decision ? decision.pipeline?.critique?.approved : undefined,
    };

    if (decision.action === "REVIEW") {
      const question = String(decision.questionForStaff || decision.reasonForEscalation || "").trim();
      if (isCamilleReviewEnabled() && question.length >= 10) {
        console.log(`[AI] REVIEW Telegram pour ${dossier.id}`);
        logAiAudit(dossier, {
          action: "REVIEW",
          channel: "gmail_auto_reply",
          actor: "Camille",
          outcome: "info",
          model: pipelineModel,
          summary: `Question équipe : ${question.slice(0, 200)}`,
          meta: auditMeta,
        });
        return {
          status: "review",
          questionForStaff: question,
          reason: decision.reasonForEscalation || "Doute sur la réponse client",
        };
      }
      console.log(`[AI] REVIEW non disponible — escalade ${dossier.id}`);
      return { status: "escalated", reason: question || "Doute — review indisponible" };
    }

    if (
      decision.action === "ESCALATE" &&
      isCamilleReviewEnabled() &&
      String(process.env.CAMILLE_REVIEW_INSTEAD_ESCALATE ?? "true").toLowerCase() !== "false" &&
      !/m[eé]dical|juridique|menace|avocat|tribunal|contentieux/i.test(
        `${decision.reasonForEscalation || ""} ${emailText}`,
      )
    ) {
      const question =
        String(decision.questionForStaff || "").trim() ||
        `Comment répondre au client sur : « ${emailText.slice(0, 200)} » ?`;
      console.log(`[AI] Escalade → REVIEW Telegram pour ${dossier.id}`);
      return {
        status: "review",
        questionForStaff: question,
        reason: decision.reasonForEscalation || "Escalade convertie en question équipe",
      };
    }

    if (decision.action === "ESCALATE") {
      const docReply = await tryCamilleDocClarificationInsteadOfEscalation(dossier, {
        clientMessage: emailText,
        reason: decision.reasonForEscalation,
      });
      if (docReply.sent && docReply.html) {
        console.log(`[AI] Escalade évitée — mail documents envoyé pour ${dossier.id}`);
        const plain = stripHtmlForNotify(docReply.html);
        const telegramAction = buildTelegramActionFromReply({
          dossier,
          clientMessage: emailText,
          replyPlain: plain,
          emailSubject: options?.emailSubject,
          actionKind: "doc_clarify",
          attachmentNames,
          reason: decision.reasonForEscalation,
        });
        return { status: "replied", text: docReply.html, replyPlain: plain, telegramAction };
      }
      console.log(`[AI] Escalade requise pour le dossier ${dossier.id}`);
      return { status: "escalated", reason: decision.reasonForEscalation };
    } else if (decision.action === "REPLY") {
      console.log(`[AI] Réponse autonome pour le dossier ${dossier.id}`);
      let plain = String(decision.messageToClient || "").trim();
      if (!plain) {
        return { status: "escalated", reason: "Réponse IA vide" };
      }
      if (isProspectLead) {
        const { patchProspectReplyHardRules } = await import("./camilleProspectInbound");
        const { analyzeProspectMessageIntent } = await import("./prospectMessageIntent");
        const intent = analyzeProspectMessageIntent(clientMessageForAi);
        plain = patchProspectReplyHardRules(plain, dossier, clientMessageForAi, {
          shouldIncludeFormLink: intent.shouldIncludeFormLink,
        });
      }
      const { text, blockedDocRequest } = sanitizeCamilleClientMessage(plain, dossier, {
        inboundAttachmentNames: attachmentNames,
        clientMessage: emailText,
        allDossiers: options?.allDossiers,
      });
      if (blockedDocRequest) {
        console.log(
          `[AI] Demande de pièces prêt bloquée (déjà présentes) pour ${dossier.id}`,
        );
      }
      logAiAudit(dossier, {
        action: "REPLY",
        channel: "gmail_auto_reply",
        actor: "Camille",
        outcome: "sent",
        model: pipelineModel,
        summary: `Réponse autonome Phase 3 (${ctx.subscriptionPhaseLabel || "phase inconnue"}, topic ${auditMeta.primaryTopic || "—"})`,
        instructionPreview: text.slice(0, 300),
        meta: auditMeta,
      });
      const pipeline =
        "pipeline" in decision ? decision.pipeline : undefined;
      const telegramAction = buildTelegramActionFromReply({
        dossier,
        clientMessage: emailText,
        replyPlain: text,
        emailSubject: options?.emailSubject,
        actionKind: "autonomous_reply",
        attachmentNames,
        blockedDocRequest,
        analyze: pipeline?.analyze,
        plan: pipeline?.plan,
        critiqueApproved: pipeline?.critique?.approved,
      });
      return {
        status: "replied",
        text: wrapCamilleHtmlReply(text, prenom, nom, dossier),
        replyPlain: text,
        telegramAction,
      };
    }
  } catch (error) {
    console.error("Erreur lors de l'analyse IA de l'email:", error);
    return { status: "escalated", reason: "Erreur technique Gemini" };
  }
}

export async function generateCamillePreDossierHelpEmail(params: {
  clientEmail: string;
  clientPrenom?: string;
  message: string;
}): Promise<{ subject: string; html: string }> {
  const prenom = String(params.clientPrenom || "").trim();
  const safeName = prenom || "Bonjour";
  const subject = `Aide pour votre dossier — ${safeName}`;

  // If Gemini is not configured, return a safe generic reply.
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes("MY_GEMINI")) {
    const generic = [
      `Je peux vous aider à récupérer les documents nécessaires.`,
      ``,
      `Pour lancer l’étude, il nous faut :`,
      `- l’offre de prêt (PDF depuis votre espace bancaire)`,
      `- le tableau d’amortissement / échéancier complet (PDF)`,
      ``,
      `Souvent, vous les trouverez dans votre application bancaire : rubrique “Crédit”, “Prêt immobilier” puis “Documents” ou “Échéancier”.`,
      `Si vous ne les voyez pas, vous pouvez aussi demander directement à votre conseiller bancaire de vous envoyer l’offre de prêt et l’échéancier complet en PDF.`,
      ``,
      `Dès que vous les avez, vous pouvez les déposer dans le formulaire et répondre à ce mail si besoin.`,
    ].join("\n");
    return { subject, html: wrapCamilleHtmlReply(generic, prenom, "") };
  }

  const knowledgeBlock = await buildCamilleKnowledgePromptBlock(null, undefined, {
    clientMessage: params.message,
    studySent: false,
  });

  const helpPrompt = `
Tu es Camille, assistante de Charles, au Club Immobilier Français.
Tu aides un client à compléter le formulaire en ligne et à retrouver les documents.

Contraintes:
- Ton chaleureux, humain, concis (6 à 14 lignes).
- Pas de téléphone.
- Expliquer où trouver: offre de prêt + tableau d’amortissement (échéancier) dans app bancaire / espace client, ou demander au conseiller.
- Mentionner que les PDFs issus de l’espace bancaire sont préférables à des photos pour la lisibilité.
- Terminer par une seule action: "répondez à ce mail si besoin" OU "déposez vos documents dans le formulaire".

Réponds en JSON:
{ "messageToClient": "..." }
`;

  const response = await generateContentWithRetry({
    model: "gemini-2.5-flash",
    contents: [
      { role: "user", parts: [{ text: helpPrompt }] },
      { role: "user", parts: [{ text: knowledgeBlock }] },
      {
        role: "user",
        parts: [
          {
            text: `Client: ${params.clientEmail}\nMessage:\n"""\n${String(params.message || "").slice(0, 4000)}\n"""`,
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      temperature: 0.55,
    },
  });

  let decision: any = null;
  try {
    decision = JSON.parse(response.text || "{}");
  } catch {
    decision = null;
  }

  const plain = String(decision?.messageToClient || "").trim();
  if (!plain) {
    const fallback = `Je peux vous aider à retrouver l’offre de prêt et le tableau d’amortissement (échéancier complet) dans votre espace bancaire.\nSouvent: “Crédit / Prêt immobilier” → “Documents” ou “Échéancier”.\nSi vous ne les voyez pas, demandez à votre conseiller bancaire de vous les envoyer en PDF.\n\nDéposez ensuite les PDFs dans le formulaire — je reste disponible si besoin.`;
    return { subject, html: wrapCamilleHtmlReply(fallback, prenom, "") };
  }

  const { text } = sanitizeCamilleClientMessage(plain, {
    formData: { assures: [{ prenom, email: params.clientEmail }] },
  });
  return { subject, html: wrapCamilleHtmlReply(text, prenom, "") };
}

const CHARLES_VICTOR_PERSONA = `
Tu es Charles Victor, conseiller expert en assurance emprunteur au "Le Club Immobilier Français" (LCIF).
Tu es un courtier indépendant, non lié à une compagnie d'assurance.
Ton rôle : analyser le dossier du client, calculer objectivement ce qu'il peut économiser, et l'informer par mail de façon professionnelle et honnête — sans jamais nommer l'assureur proposé dans le mail, et sans jamais sur-vendre.

RÈGLES ABSOLUES DU MAIL :
- ❌ Ne jamais nommer l'assureur (Cardif, BNP, iAssure, etc.).
- ❌ Ne jamais mettre de numéro de téléphone (tout par mail).
- ❌ Ne jamais écrire "LCIF" seul — toujours "Le Club Immobilier Français" ou "notre équipe".
- ❌ Ne jamais mentionner le bloc garanties supérieures si les garanties proposées sont simplement équivalentes.
- ❌ Ne jamais redemander les échéanciers ou l'offre de prêt (déjà reçus).
- ✅ Signer Charles Victor — Conseiller en assurance emprunteur — Le Club Immobilier Français.
- ✅ Couleurs : bleu marine #1E3A8A, blanc, gris clair #F8FAFC.
- ✅ Logo blanc sur fond bleu : https://res.cloudinary.com/dji8akleo/image/upload/v1772999309/5_yn8wfm.png
- ✅ Ton : chaleureux, professionnel, direct — jamais sur-vendeur.
- ✅ Call-to-action unique : répondre au mail pour activer le changement.
- ✅ Inline CSS uniquement.
`;

export async function generateInsuranceStudyMail(dossier: any, calc: any): Promise<string> {
  try {
    const isLemoine = (Number(dossier.formData?.prets?.[0]?.capitalRestant) || 0) <= 200000;
    const clientName = dossier.formData?.assures?.[0]?.prenom || 'Cher client';
    
    // Déterminer le scénario
    let scenario = 'A'; // Défaut : économie significative
    const totalSavingsNette = calc.totalSavings || 0;
    if (totalSavingsNette < 500) {
      if (calc.isGarantiesSuperieures) scenario = 'B';
      else scenario = 'C';
    }
    if (totalSavingsNette <= 0 && !calc.isGarantiesSuperieures) scenario = 'C';

    let prompt = `
Tu es Charles Victor, conseiller en assurance emprunteur au Club Immobilier Français. Tu es courtier indépendant, pas lié à une compagnie. Ton rôle : analyser le dossier du client, calculer objectivement ce qu'il peut économiser, et l'informer par mail de façon professionnelle et honnête — sans jamais nommer l'assureur proposé dans le mail, et sans jamais sur-vendre.

Rédige un mail HTML complet (inline CSS uniquement) pour ${clientName} basé sur cette analyse :
- Scénario déterminé : ${scenario === 'C' ? "C - Dossier déjà optimisé (Pas d'économie)" : scenario === 'B' ? "B - Economies faibles mais Garanties Supérieures" : "A - Économie significative"}
- Coût total assurance actuelle restante (AVANT) : ${calc.existantTotal} €
- Coût total assurance proposée restante (APRÈS) : ${calc.proposeTotalBare} €
- Économie Brute Totale (Différence) : ${calc.totalSavingsBrute} €
- Frais Assureur (dossier) : ${calc.feesAssureur || 0} €
- Frais Courtage LCIF : ${calc.feesCourtageLCIF || 0} €
- Garanties : ${calc.isGarantiesSuperieures ? "SUPERIEURES" : "EQUIVALENTES"}
- Mensualités Actuelles estimées : Année 1: ${calc.ep1} €/mois, Année 2: ${calc.ep2} €/mois, Année 3: ${calc.ep3} €/mois, Année 4+: ${calc.ep3} €/mois
- Mensualités Proposées estimées : Année 1: ${calc.pp1} €/mois, Année 2: ${calc.pp2} €/mois, Année 3: ${calc.pp3} €/mois, Année 4+: ${calc.pp3} €/mois
- Loi Lemoine applicable : ${isLemoine ? "OUI" : "NON"}

RÈGLES ABSOLUES :
- Police d'écriture : sans-serif, propre, moderne (ex: Helvetica, Arial, sans-serif), taille de police 14px ou 15px.
- Ne jamais nommer l'assureur proposé.
- Ne jamais mettre de numéro de téléphone.
- Signer Charles Victor — Conseiller en assurance emprunteur — Le Club Immobilier Français.
- Couleurs : bleu marine #1E3A8A, blanc, gris clair #F8FAFC. Lignes de tableau alternées.
- Logo en haut, blanc sur fond bleu : https://res.cloudinary.com/dji8akleo/image/upload/v1772999309/5_yn8wfm.png
- Ton : chaleureux, professionnel, direct.
- Call-to-action : répondre au mail.
- Ne jamais mentionner l'économie sur 8 ans, concentre-toi sur l'économie totale qui est la plus représentative.
- Footer Légal obligatoire (en petit texte gris à la fin) :
  Le Club Immobilier Français
  17 Passage Leroy, 44000 Nantes
  N° ORIAS : 24002253 | Courtier en assurance emprunteur, indépendant de tout assureur
  Cette proposition est établie à titre indicatif et n'a pas de valeur contractuelle.

STRUCTURE REQUISE SELON LE SCÉNARIO :

${scenario === 'A' || scenario === 'B' ? `
L'accroche : "J'ai analysé votre dossier... avec des garanties ${calc.isGarantiesSuperieures ? "supérieures" : "équivalentes"}."
BLOC ÉCONOMIE : fond #EFF6FF, bordure #BFDBFE, padding et marges généreuses. Affichez clairement :
  * Coût assurance actuelle : ${calc.existantTotal} €
  * Coût nouvelle assurance : ${calc.proposeTotalBare} €
  * ECONOMIE GENEREE : ${calc.totalSavingsBrute} €
(Séparément en dessous) Détaillez vos frais : Frais de dossier (${calc.feesAssureur || 0} €) | Frais de courtage (${calc.feesCourtageLCIF || 0} €). Demandez au client de les déduire lui-même de l'économie s'il le souhaite.
${calc.isGarantiesSuperieures ? 'BLOC GARANTIES SUPÉRIEURES : fond #F0FDF4. Détaillez ce qui s\'améliore.' : ''}
TABLEAU MENSUALITÉS : Un seul tableau consolidé "ÉVOLUTION DE VOS MENSUALITÉS" avec 5 lignes (Année 1, Année 2, Année 3, Année 4, Années suivantes). Colonnes : Période | Assurance actuelle | Nouvelle assurance | Gain Mensuel.
Loi Lemoine : Si applicable ("OUI"), indiquer "Aucun questionnaire de santé nécessaire".
PIÈCES À FOURNIR : CNI + RIB.
` : `
BLOC RÉSULTAT POSITIF : fond #F0FDF4. "Bonne nouvelle... assurance déjà optimisée."
Indiquer qu'ils font partie de la minorité des dossiers bien optimisés et félicitez-les.
BLOC RECOMMANDATION : fond #EFF6FF. Proposer d'analyser les proches.
Pas de tableau de sommes dans ce cas.
`}

Retourne UNIQUEMENT le code HTML. Ne mettez pas de formatage de type markdown (\`\`\`html).
`;

    const response = await generateContentWithRetry({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { temperature: 0.7 }
    });

    return response.text;
  } catch (err) {
    console.error("Error generating Charles Victor email:", err);
    throw err;
  }
}



function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.pdf': return 'application/pdf';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    default: return 'application/octet-stream';
  }
}
