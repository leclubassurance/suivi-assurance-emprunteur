import { addEvent, newId, type Dossier } from "./dossierModel";
import { readDB, writeDB } from "./db";
import { generateContentWithRetry } from "./geminiClient";
import { buildCamilleContextBlock, wrapCamilleHtmlReply } from "./camilleMail";
import { sanitizeCamilleClientMessage } from "./camilleClientMessage";
import { buildPlaybooksPromptBlock, saveApprovedPlaybook } from "./camillePlaybooks";
import { buildCamilleKnowledgePromptBlock } from "./camilleKnowledgeDrive";
import { CAMILLE_PERSONA_PROMPT } from "./camillePersona";
import { getConversationTailForAi } from "./gmailConversation";
import { isLeadDossier } from "../shared/leadDossierStatus";
import { registerTelegramDossierContext } from "./telegramCamille";
import { isTelegramEnabled, sendTelegramMessage } from "./telegramCamille";
import { escapeTelegramHtml, reviewConfirmKeyboard } from "./telegramUi";
import { borrowerDisplayName } from "./telegramUi";
import { persistTelegramDossierRef } from "./telegramDossierRefs";
import { findDossierWithReviewReply } from "./camilleReviewTelegram";
import { isCamilleProductionSafeMode } from "./camilleClientSafety";

export type CamillePendingReviewStatus =
  | "awaiting_staff"
  | "awaiting_confirm"
  | "sent"
  | "cancelled";

export type CamillePendingReview = {
  id: string;
  status: CamillePendingReviewStatus;
  createdAt: string;
  updatedAt: string;
  gmailId: string;
  clientEmail: string;
  emailSubject: string;
  clientMessageExcerpt: string;
  fullClientMessage: string;
  questionForStaff: string;
  reason?: string;
  staffAnswer?: string;
  staffAnswerAt?: string;
  proposedClientPlain?: string;
  proposedClientHtml?: string;
  telegramChatId?: string;
  /** Message « question avant brouillon » — répondre à celui-ci. */
  telegramQuestionMessageId?: number;
  /** Message « confirmer l'envoi » avec boutons. */
  telegramConfirmMessageId?: number;
  attachmentNames?: string[];
  /** Brouillon généré par Camille sans consigne équipe préalable. */
  autoDraft?: boolean;
};

export function getPendingReview(dossier: Dossier): CamillePendingReview | null {
  const r = dossier.camillePendingReview;
  if (!r || typeof r !== "object") return null;
  if (r.status === "sent" || r.status === "cancelled") return null;
  return r as CamillePendingReview;
}

export function isReviewBlockingAutoReply(dossier: Dossier): boolean {
  const r = getPendingReview(dossier);
  return Boolean(r && (r.status === "awaiting_staff" || r.status === "awaiting_confirm"));
}

export function isCamilleReviewEnabled(): boolean {
  const raw = String(process.env.CAMILLE_REVIEW_ENABLED ?? "true").toLowerCase();
  if (raw === "false" || raw === "0") return false;
  return isTelegramEnabled();
}

/** Brouillon Telegram avant envoi des réponses IA libres (actif par défaut en mode prod). */
export function isCamilleDraftBeforeSendEnabled(): boolean {
  if (!isCamilleReviewEnabled()) return false;
  if (isCamilleProductionSafeMode()) return true;
  const raw = String(process.env.CAMILLE_DRAFT_BEFORE_SEND ?? "false").toLowerCase();
  return raw === "true" || raw === "1";
}

/** Sujets où Camille doit demander avant de répondre seule. */
export function shouldForceReviewHeuristic(clientMessage: string, dossier: any): boolean {
  const blob = String(clientMessage || "").toLowerCase();
  if (/m[eé]dical|juridique|menace|avocat|tribunal|contentieux/i.test(blob)) return true;
  if (/multi|monsieur|madame|second pr[eê]t|co-emprunteur|autre contrat|partie monsieur/i.test(blob)) {
    return true;
  }
  if (/€\s*\d|[eé]conom.*\d|combien.*(gagn|économ|co[uû]t)/i.test(blob)) return true;
  if (/r[eé]clamation|insatisfait|m[eé]content|arnaque|honte|inadmissible|scandale/i.test(blob)) {
    return true;
  }
  if (/refus(e|er)?|ne veux pas|pas int[eé]ress|stop|d[eé]sabonn|ne plus me contacter/i.test(blob)) {
    return true;
  }
  if (/humain|vrai conseiller|parler [àa] charles|personne r[eé]elle/i.test(blob)) return true;
  return false;
}

export async function createCamilleReviewRequest(params: {
  dossier: Dossier;
  gmailId: string;
  clientEmail: string;
  emailSubject: string;
  clientMessage: string;
  questionForStaff: string;
  reason?: string;
  attachmentNames?: string[];
}): Promise<{ ok: boolean; reviewId?: string; error?: string }> {
  if (!isCamilleReviewEnabled()) {
    return { ok: false, error: "review_disabled" };
  }

  const { getAllowedChatIdsForNotify } = await import("./telegramCamille");
  const chatIds = getAllowedChatIdsForNotify();
  if (!chatIds.length) return { ok: false, error: "no_telegram_chat" };

  const now = new Date().toISOString();
  const review: CamillePendingReview = {
    id: newId("cr"),
    status: "awaiting_staff",
    createdAt: now,
    updatedAt: now,
    gmailId: params.gmailId,
    clientEmail: params.clientEmail,
    emailSubject: params.emailSubject,
    clientMessageExcerpt: String(params.clientMessage || "").slice(0, 500),
    fullClientMessage: String(params.clientMessage || "").slice(0, 8000),
    questionForStaff: params.questionForStaff,
    reason: params.reason,
    attachmentNames: params.attachmentNames || [],
  };

  params.dossier.camillePendingReview = review;
  params.dossier.camilleStaffHandledUntil = new Date(
    Date.now() + 4 * 60 * 60 * 1000,
  ).toISOString();

  addEvent(params.dossier, {
    type: "AI_DECISION",
    actor: { kind: "AI", label: "Camille" },
    message: "Question équipe Telegram (réponse client en attente).",
    meta: {
      reviewId: review.id,
      gmailId: params.gmailId,
      question: params.questionForStaff.slice(0, 300),
    },
  });

  const { formatReviewQuestionTelegramHtml } = await import("./camilleTelegramActionNotify");
  const body = formatReviewQuestionTelegramHtml({
    dossier: params.dossier,
    clientExcerpt: review.clientMessageExcerpt,
    questionForStaff: review.questionForStaff,
    reason: review.reason,
    emailSubject: params.emailSubject,
    attachmentNames: params.attachmentNames,
  });

  let sentToAny = false;
  for (const chatId of chatIds) {
    const msg = await sendTelegramMessage(chatId, body, { dossierId: params.dossier.id });
    if (msg?.message_id) {
      sentToAny = true;
      review.telegramChatId = chatId;
      review.telegramQuestionMessageId = msg.message_id;
      registerTelegramDossierContext(chatId, msg.message_id, params.dossier.id);
      await persistTelegramDossierRef(params.dossier.id, chatId, msg.message_id);
    }
  }

  if (!sentToAny) {
    delete params.dossier.camillePendingReview;
    return { ok: false, error: "telegram_send_failed" };
  }

  review.updatedAt = new Date().toISOString();
  params.dossier.updatedAt = review.updatedAt;
  return { ok: true, reviewId: review.id };
}

export async function createCamilleDraftForConfirm(params: {
  dossier: Dossier;
  gmailId: string;
  clientEmail: string;
  emailSubject: string;
  clientMessage: string;
  proposedPlain: string;
  proposedHtml: string;
  reason?: string;
  attachmentNames?: string[];
  extraTelegramLabel?: string;
}): Promise<{ ok: boolean; reviewId?: string; error?: string }> {
  if (!isCamilleDraftBeforeSendEnabled()) {
    return { ok: false, error: "draft_before_send_disabled" };
  }

  const { getAllowedChatIdsForNotify } = await import("./telegramCamille");
  const chatIds = getAllowedChatIdsForNotify();
  if (!chatIds.length) return { ok: false, error: "no_telegram_chat" };

  if (getPendingReview(params.dossier)) {
    return { ok: false, error: "review_already_pending" };
  }

  const now = new Date().toISOString();
  const review: CamillePendingReview = {
    id: newId("cr"),
    status: "awaiting_confirm",
    createdAt: now,
    updatedAt: now,
    gmailId: params.gmailId,
    clientEmail: params.clientEmail,
    emailSubject: params.emailSubject,
    clientMessageExcerpt: String(params.clientMessage || "").slice(0, 500),
    fullClientMessage: String(params.clientMessage || "").slice(0, 8000),
    questionForStaff: "Validation brouillon avant envoi client.",
    reason: params.reason,
    staffAnswer: "Brouillon Camille — validation équipe avant envoi.",
    staffAnswerAt: now,
    proposedClientPlain: params.proposedPlain,
    proposedClientHtml: params.proposedHtml,
    attachmentNames: params.attachmentNames || [],
    autoDraft: true,
  };

  params.dossier.camillePendingReview = review;
  params.dossier.camilleStaffHandledUntil = new Date(
    Date.now() + 4 * 60 * 60 * 1000,
  ).toISOString();

  const name = borrowerDisplayName(params.dossier);
  const clientPreview = escapeTelegramHtml(review.clientMessageExcerpt.slice(0, 600));
  const draftPreview = escapeTelegramHtml(params.proposedPlain.slice(0, 1800));
  const confirmBody = [
    `<b>📝 ${escapeTelegramHtml(params.dossier.id)} — ${escapeTelegramHtml(name)}</b>`,
    params.extraTelegramLabel
      ? `<i>${escapeTelegramHtml(params.extraTelegramLabel)}</i>`
      : "",
    `<b>Message client :</b>`,
    `<i>« ${clientPreview} »</i>`,
    ``,
    `<b>Brouillon Camille</b> (envoi au client uniquement si vous validez) :`,
    `<i>« ${draftPreview} »</i>`,
    ``,
    `<b>Envoyer ce mail au client ?</b>`,
  ]
    .filter(Boolean)
    .join("\n");

  let sentToAny = false;
  for (const chatId of chatIds) {
    const msg = await sendTelegramMessage(chatId, confirmBody, {
      dossierId: params.dossier.id,
      reply_markup: reviewConfirmKeyboard(params.dossier.id),
    });
    if (msg?.message_id) {
      sentToAny = true;
      review.telegramChatId = chatId;
      review.telegramConfirmMessageId = msg.message_id;
      registerTelegramDossierContext(chatId, msg.message_id, params.dossier.id);
      await persistTelegramDossierRef(params.dossier.id, chatId, msg.message_id);
    }
  }

  if (!sentToAny) {
    delete params.dossier.camillePendingReview;
    return { ok: false, error: "telegram_send_failed" };
  }

  review.updatedAt = new Date().toISOString();
  params.dossier.updatedAt = review.updatedAt;

  addEvent(params.dossier, {
    type: "AI_DECISION",
    actor: { kind: "AI", label: "Camille" },
    message: "Brouillon client envoyé sur Telegram — en attente de validation.",
    meta: { reviewId: review.id, gmailId: params.gmailId, autoDraft: true },
  });

  return { ok: true, reviewId: review.id };
}

export async function tryQueueCamilleReplyForValidation(params: {
  dossier: Dossier;
  gmailId: string;
  clientEmail: string;
  emailSubject: string;
  clientMessage: string;
  replyHtml: string;
  replyPlain?: string;
  reason?: string;
  attachmentNames?: string[];
  extraTelegramLabel?: string;
}): Promise<{ queued: boolean; reviewId?: string; error?: string }> {
  if (!isCamilleDraftBeforeSendEnabled()) {
    return { queued: false };
  }

  const { stripHtmlForTelegram } = await import("./camilleTelegramActionNotify");
  const proposedPlain =
    String(params.replyPlain || "").trim() ||
    stripHtmlForTelegram(params.replyHtml).slice(0, 8000);

  const result = await createCamilleDraftForConfirm({
    dossier: params.dossier,
    gmailId: params.gmailId,
    clientEmail: params.clientEmail,
    emailSubject: params.emailSubject,
    clientMessage: params.clientMessage,
    proposedPlain,
    proposedHtml: params.replyHtml,
    reason: params.reason,
    attachmentNames: params.attachmentNames,
    extraTelegramLabel: params.extraTelegramLabel,
  });

  if (result.ok) {
    return { queued: true, reviewId: result.reviewId };
  }
  return { queued: false, error: result.error };
}

export function findDossierWithPendingReviewReply(
  dossiers: Dossier[],
  chatId: string,
  replyToMessageId?: number,
): Dossier | null {
  return findDossierWithReviewReply(dossiers, chatId, replyToMessageId);
}

async function draftClientReplyFromStaffGuidanceInner(
  dossier: Dossier,
  review: CamillePendingReview,
  staffAnswer: string,
  allDossiers?: Dossier[],
  options?: { previousDraft?: string; revisionNote?: string },
): Promise<string> {
  const ctx = buildCamilleContextBlock(dossier, review.attachmentNames || [], allDossiers);
  const knowledgeBlock = await buildCamilleKnowledgePromptBlock(null, undefined, {
    clientMessage: review.fullClientMessage,
    subscriptionPhase: ctx.subscriptionPhase,
    studySent: ctx.studySent,
  });
  const playbooksBlock = await buildPlaybooksPromptBlock(
    review.fullClientMessage,
    dossier,
  );
  const conversationTail = getConversationTailForAi(dossier, 15, 800, {
    clientPhaseOnly: !isLeadDossier(dossier) && Boolean(dossier.leadPromotedAt),
  });
  const prenom = dossier.formData?.assures?.[0]?.prenom || "";

  const response = await generateContentWithRetry({
    model: "gemini-2.5-flash",
    contents: [
      { role: "user", parts: [{ text: CAMILLE_PERSONA_PROMPT }] },
      { role: "user", parts: [{ text: knowledgeBlock }] },
      { role: "user", parts: [{ text: playbooksBlock || "Aucun playbook similaire." }] },
      {
        role: "user",
        parts: [
          {
            text: `
Dossier : ${dossier.id}
Client : ${prenom} ${dossier.formData?.assures?.[0]?.nom || ""}

${ctx.dossierSituationBlock}

Consigne VALIDÉE par l'équipe (à respecter strictement) :
"""
${staffAnswer}
"""
${options?.previousDraft ? `
Brouillon précédent (à faire évoluer selon la consigne) :
"""
${options.previousDraft.slice(0, 3500)}
"""
` : ""}
${options?.revisionNote ? `
Modification demandée par l'équipe :
"""
${options.revisionNote}
"""
` : ""}
${ctx.studyKpiSummary ? `KPI étude (référence interne) : ${ctx.studyKpiSummary}` : ""}

Règle : si l'équipe affirme explicitement un fait métier (ex. frais de courtage appliqués pour un adhérent CLUB), tu le suis même si le KPI automatique affiche 0 € — sans inventer d'autres chiffres.

Mail client à traiter :
"""
${review.fullClientMessage.slice(0, 6000)}
"""

Contexte pièces :
${ctx.documentSummary}

Fil récent :
${conversationTail}

Rédige UNIQUEMENT le corps du mail client (pas de Bonjour ni signature).
Réponds en JSON : { "messageToClient": "..." }
`,
          },
        ],
      },
    ],
    config: { responseMimeType: "application/json", temperature: 0.35 },
  });

  let plain = "";
  try {
    const parsed = JSON.parse(response.text || "{}");
    plain = String(parsed.messageToClient || "").trim();
  } catch {
    plain = String(response.text || "").trim();
  }

  const { text } = sanitizeCamilleClientMessage(plain, dossier, {
    inboundAttachmentNames: review.attachmentNames,
    clientMessage: review.fullClientMessage,
    allDossiers,
  });
  return text;
}

export async function draftClientReplyFromStaffGuidance(
  dossier: Dossier,
  review: CamillePendingReview,
  staffAnswer: string,
  allDossiers?: Dossier[],
): Promise<string> {
  return draftClientReplyFromStaffGuidanceInner(dossier, review, staffAnswer, allDossiers);
}

export async function reviseDraftFromStaffFeedback(
  dossier: Dossier,
  review: CamillePendingReview,
  feedback: string,
  chatId: string,
  allDossiers?: Dossier[],
): Promise<{ ok: boolean; summary: string }> {
  const note = String(feedback || "").trim();
  if (note.length < 5) {
    return { ok: false, summary: "Précisez la modification souhaitée sur le brouillon." };
  }

  const mergedGuidance = [review.staffAnswer, note].filter(Boolean).join("\n\nModification : ");
  review.staffAnswer = mergedGuidance;
  review.staffAnswerAt = new Date().toISOString();
  review.updatedAt = review.staffAnswerAt;

  await sendTelegramMessage(chatId, "⏳ Je révise le brouillon…", { dossierId: dossier.id });

  let plain = await draftClientReplyFromStaffGuidanceInner(
    dossier,
    review,
    mergedGuidance,
    allDossiers,
    {
      previousDraft: review.proposedClientPlain,
      revisionNote: note,
    },
  );
  const prenom = dossier.formData?.assures?.[0]?.prenom || "";
  const nom = dossier.formData?.assures?.[0]?.nom || "";
  review.proposedClientPlain = plain;
  review.proposedClientHtml = wrapCamilleHtmlReply(plain, prenom, nom, dossier);
  review.status = "awaiting_confirm";
  review.updatedAt = new Date().toISOString();
  dossier.camillePendingReview = review;

  const name = borrowerDisplayName(dossier);
  const preview = escapeTelegramHtml(plain.slice(0, 1800));
  const confirmBody = [
    `<b>✏️ ${escapeTelegramHtml(dossier.id)} — ${escapeTelegramHtml(name)}</b>`,
    `<b>Brouillon révisé</b> (envoi uniquement si vous validez) :`,
    ``,
    `<i>« ${preview} »</i>`,
    ``,
    `<b>Envoyer ce mail au client ?</b>`,
  ].join("\n");

  const msg = await sendTelegramMessage(chatId, confirmBody, {
    dossierId: dossier.id,
    reply_markup: reviewConfirmKeyboard(dossier.id),
  });

  if (msg?.message_id) {
    review.telegramConfirmMessageId = msg.message_id;
    review.telegramChatId = chatId;
    registerTelegramDossierContext(chatId, msg.message_id, dossier.id);
    await persistTelegramDossierRef(dossier.id, chatId, msg.message_id);
  }

  return { ok: true, summary: "Brouillon révisé — validez ou demandez une autre modification." };
}

export async function applyStaffAnswerToReview(
  dossier: Dossier,
  staffAnswer: string,
  chatId: string,
  allDossiers?: Dossier[],
): Promise<{ ok: boolean; summary: string }> {
  const review = getPendingReview(dossier);
  if (!review || review.status !== "awaiting_staff") {
    return { ok: false, summary: "Aucune question en attente sur ce dossier." };
  }

  const answer = String(staffAnswer || "").trim();
  if (answer.length < 3) {
    return { ok: false, summary: "Réponse trop courte — précisez votre consigne." };
  }

  review.staffAnswer = answer;
  review.staffAnswerAt = new Date().toISOString();
  review.status = "awaiting_confirm";
  review.updatedAt = review.staffAnswerAt;

  await sendTelegramMessage(chatId, "⏳ Je rédige le brouillon…", { dossierId: dossier.id });

  const plain = await draftClientReplyFromStaffGuidance(dossier, review, answer, allDossiers);
  const prenom = dossier.formData?.assures?.[0]?.prenom || "";
  const nom = dossier.formData?.assures?.[0]?.nom || "";
  const html = wrapCamilleHtmlReply(plain, prenom, nom, dossier);

  review.proposedClientPlain = plain;
  review.proposedClientHtml = html;
  review.updatedAt = new Date().toISOString();
  dossier.camillePendingReview = review;
  dossier.updatedAt = review.updatedAt;

  const name = borrowerDisplayName(dossier);
  const preview = escapeTelegramHtml(plain.slice(0, 1800));
  const confirmBody = [
    `<b>✅ ${escapeTelegramHtml(dossier.id)} — ${escapeTelegramHtml(name)}</b>`,
    `<b>Brouillon proposé</b> (envoi au client uniquement si vous validez) :`,
    ``,
    `<i>« ${preview} »</i>`,
    ``,
    `<b>Envoyer ce mail au client ?</b>`,
  ].join("\n");

  const msg = await sendTelegramMessage(chatId, confirmBody, {
    dossierId: dossier.id,
    reply_markup: reviewConfirmKeyboard(dossier.id),
  });

  if (msg?.message_id) {
    review.telegramConfirmMessageId = msg.message_id;
    review.telegramChatId = chatId;
    registerTelegramDossierContext(chatId, msg.message_id, dossier.id);
    await persistTelegramDossierRef(dossier.id, chatId, msg.message_id);
  }

  addEvent(dossier, {
    type: "AI_DECISION",
    actor: { kind: "ADMIN", label: "Telegram" },
    message: "Consigne reçue — brouillon client en attente de validation.",
    meta: { reviewId: review.id, staffAnswer: answer.slice(0, 200) },
  });

  return { ok: true, summary: "Brouillon prêt — validez ou annulez ci-dessous." };
}

export async function confirmAndSendReviewReply(
  dossier: Dossier,
  chatId: string,
): Promise<{ ok: boolean; summary: string }> {
  const review = dossier.camillePendingReview as CamillePendingReview | undefined;
  if (!review || review.status !== "awaiting_confirm" || !review.proposedClientHtml) {
    return { ok: false, summary: "Aucun brouillon en attente de validation." };
  }

  const { sendEmailReplyWithGmailAPI, upsertCommunication } = await import("./mailAutomation");
  const sendHtml = review.proposedClientHtml;

  const send = await sendEmailReplyWithGmailAPI(
    null,
    review.clientEmail,
    review.emailSubject.startsWith("Re:") ? review.emailSubject : `Re: ${review.emailSubject}`,
    sendHtml,
  );

  if (!send.ok) {
    return { ok: false, summary: send.error || "Échec envoi Gmail." };
  }

  upsertCommunication(dossier, {
    id: `msg_review_${review.gmailId}`,
    gmailId: send.messageId,
    direction: "outbound",
    from: "Camille (IA)",
    to: review.clientEmail,
    subject: review.emailSubject,
    text: review.proposedClientPlain,
    date: new Date().toISOString(),
  });

  if (!review.autoDraft && review.staffAnswer && review.proposedClientPlain) {
    await saveApprovedPlaybook({
      dossier,
      clientMessage: review.fullClientMessage,
      situationSummary: review.questionForStaff,
      staffGuidance: review.staffAnswer,
      approvedReplyPlain: review.proposedClientPlain,
      approvedBy: chatId,
    });
  }

  review.status = "sent";
  review.updatedAt = new Date().toISOString();
  dossier.camillePendingReview = review;
  dossier.updatedAt = review.updatedAt;

  if (Array.isArray(dossier.processedGmailIds) && review.gmailId) {
    if (!dossier.processedGmailIds.includes(review.gmailId)) {
      dossier.processedGmailIds.push(review.gmailId);
    }
  }

  if (isLeadDossier(dossier)) {
    dossier.status = "PROSPECT";
    (dossier as { isLead?: boolean }).isLead = true;
  } else {
    dossier.status = "EN_COURS";
  }

  addEvent(dossier, {
    type: "EMAIL_SENT",
    actor: { kind: "AI", label: "Camille" },
    message: review.autoDraft
      ? "Mail client envoyé après validation du brouillon Telegram."
      : "Mail client envoyé après validation équipe (playbook enregistré).",
    meta: {
      reviewId: review.id,
      gmailId: review.gmailId,
      template: review.autoDraft ? "CAMILLE_DRAFT_APPROVED" : "CAMILLE_REVIEW_APPROVED",
    },
  });

  const db = await readDB();
  const stored = db.dossiers.find((d) => d.id === dossier.id);
  if (stored) {
    stored.camillePendingReview = review;
    stored.processedGmailIds = dossier.processedGmailIds;
    stored.communications = dossier.communications;
    stored.eventLog = dossier.eventLog;
    stored.updatedAt = dossier.updatedAt;
    await writeDB(db, stored);
  }

  void import("./telegramNotify")
    .then(async ({ notifyTelegramCamilleReplied }) => {
      const { buildTelegramActionFromReply } = await import("./camilleTelegramActionNotify");
      const camilleAction = buildTelegramActionFromReply({
        dossier,
        clientMessage: review.fullClientMessage,
        replyPlain: review.proposedClientPlain || "",
        emailSubject: review.emailSubject,
        actionKind: "autonomous_reply",
      });
      camilleAction.interventionLevel = "none";
      camilleAction.reason = "Mail validé par l'équipe après relecture Telegram.";
      await notifyTelegramCamilleReplied({
        dossier,
        subject: review.emailSubject,
        gmailId: review.gmailId,
        camilleAction,
      });
    })
    .catch(() => undefined);

  return {
    ok: true,
    summary: `Mail envoyé à ${review.clientEmail}. Cas enregistré pour les prochains dossiers similaires.`,
  };
}

export async function cancelPendingReview(
  dossier: Dossier,
  reason?: string,
): Promise<void> {
  const review = dossier.camillePendingReview;
  if (!review) return;
  if (review.gmailId && Array.isArray(dossier.processedGmailIds)) {
    dossier.processedGmailIds = dossier.processedGmailIds.filter((id) => id !== review.gmailId);
  }
  review.status = "cancelled";
  review.updatedAt = new Date().toISOString();
  dossier.camillePendingReview = review as CamillePendingReview;
  addEvent(dossier, {
    type: "AI_DECISION",
    actor: { kind: "ADMIN", label: "Telegram" },
    message: reason || "Validation client annulée.",
    meta: { reviewId: review.id },
  });
}

export async function tryHandleCamilleReviewStaffReply(
  chatId: string,
  replyToMessageId: number | undefined,
  text: string,
): Promise<boolean> {
  if (!text.trim()) return false;

  const {
    findDossierWithReviewReply,
    findDossierWithAwaitingConfirmReview,
    findDossierWithAwaitingStaffReview,
    looksLikeReviewSendConfirmation,
    looksLikeReviewCancel,
    looksLikeReviewRedraft,
    looksLikeReviewStaffGuidance,
  } = await import("./camilleReviewTelegram");

  const db = await readDB();
  let dossier =
    findDossierWithReviewReply(db.dossiers, chatId, replyToMessageId) ||
    (looksLikeReviewSendConfirmation(text)
      ? findDossierWithAwaitingConfirmReview(db.dossiers, chatId)
      : null) ||
    (looksLikeReviewStaffGuidance(text)
      ? findDossierWithAwaitingStaffReview(db.dossiers, chatId)
      : null);

  if (!dossier) return false;

  const review = getPendingReview(dossier);
  if (!review) return false;

  if (review.status === "awaiting_confirm") {
    if (looksLikeReviewCancel(text)) {
      await cancelPendingReview(dossier, "Envoi client annulé par l'équipe.");
      dossier.updatedAt = new Date().toISOString();
      await writeDB(db, dossier);
      await sendTelegramMessage(chatId, `❌ Envoi annulé pour ${dossier.id}.`, {
        dossierId: dossier.id,
      });
      return true;
    }

    if (looksLikeReviewSendConfirmation(text)) {
      const result = await confirmAndSendReviewReply(dossier, chatId);
      dossier.updatedAt = new Date().toISOString();
      await writeDB(db, dossier);
      await sendTelegramMessage(
        chatId,
        result.ok
          ? `📤 ${result.summary}`
          : `❌ ${result.summary}`,
        { dossierId: dossier.id },
      );
      return true;
    }

    if (
      looksLikeReviewRedraft(text) ||
      (looksLikeReviewStaffGuidance(text) &&
        (replyToMessageId || text.trim().length >= 12))
    ) {
      const result = await reviseDraftFromStaffFeedback(dossier, review, text, chatId, db.dossiers);
      dossier.updatedAt = new Date().toISOString();
      await writeDB(db, dossier);
      await sendTelegramMessage(chatId, result.ok ? `✏️ ${result.summary}` : `❌ ${result.summary}`, {
        dossierId: dossier.id,
      });
      return true;
    }

    await sendTelegramMessage(
      chatId,
      `ℹ️ Brouillon en attente pour <b>${dossier.id}</b> — utilisez les boutons <b>Envoyer</b> / <b>Annuler</b>, ou écrivez <code>ok envoie</code> / <code>je valide</code>.`,
      { dossierId: dossier.id, reply_markup: reviewConfirmKeyboard(dossier.id) },
    );
    return true;
  }

  if (review.status === "awaiting_staff") {
    const onQuestion =
      replyToMessageId &&
      Number(review.telegramQuestionMessageId) === Number(replyToMessageId);
    if (!onQuestion && !looksLikeReviewStaffGuidance(text)) return false;
    const result = await applyStaffAnswerToReview(dossier, text, chatId, db.dossiers);
    dossier.updatedAt = new Date().toISOString();
    await writeDB(db, dossier);
    await sendTelegramMessage(chatId, result.ok ? `✅ ${result.summary}` : `❌ ${result.summary}`, {
      dossierId: dossier.id,
    });
    return true;
  }

  return false;
}

export async function handleReviewConfirmCallback(
  chatId: string,
  dossierId: string,
  action: "send" | "reject" | "redraft",
  staffText?: string,
): Promise<void> {
  const db = await readDB();
  const dossier = db.dossiers.find((d) => d.id === dossierId);
  if (!dossier) {
    await sendTelegramMessage(chatId, "Dossier introuvable.");
    return;
  }

  if (action === "send") {
    const result = await confirmAndSendReviewReply(dossier, chatId);
    dossier.updatedAt = new Date().toISOString();
    await writeDB(db, dossier);
    await sendTelegramMessage(
      chatId,
      result.ok ? `📤 ${result.summary}` : `❌ ${result.summary}`,
      { dossierId: dossier.id },
    );
    return;
  }

  if (action === "reject") {
    await cancelPendingReview(dossier, "Envoi client annulé par l'équipe.");
    dossier.updatedAt = new Date().toISOString();
    await writeDB(db, dossier);
    await sendTelegramMessage(chatId, `❌ Envoi annulé pour ${dossierId}.`, { dossierId: dossier.id });
    return;
  }

  if (action === "redraft" && staffText) {
    const review = getPendingReview(dossier);
    if (!review) {
      await sendTelegramMessage(chatId, "Aucune relecture en cours.");
      return;
    }
    review.status = "awaiting_staff";
    review.staffAnswer = undefined;
    dossier.camillePendingReview = review;
    const result = await applyStaffAnswerToReview(dossier, staffText, chatId, db.dossiers);
    dossier.updatedAt = new Date().toISOString();
    await writeDB(db, dossier);
    await sendTelegramMessage(chatId, result.ok ? `✏️ ${result.summary}` : `❌ ${result.summary}`, {
      dossierId: dossier.id,
    });
  }
}
