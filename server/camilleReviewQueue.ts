import { addEvent, newId, type Dossier } from "./dossierModel";
import { readDB, writeDB } from "./db";
import { generateContentWithRetry } from "./geminiClient";
import { buildCamilleContextBlock, wrapCamilleHtmlReply } from "./camilleMail";
import { sanitizeCamilleClientMessage } from "./camilleClientMessage";
import { buildPlaybooksPromptBlock, saveApprovedPlaybook } from "./camillePlaybooks";
import { buildCamilleKnowledgePromptBlock } from "./camilleKnowledgeDrive";
import { CAMILLE_PERSONA_PROMPT } from "./camillePersona";
import { getConversationTailForAi } from "./gmailConversation";
import { registerTelegramDossierContext } from "./telegramCamille";
import { isTelegramEnabled, sendTelegramMessage } from "./telegramCamille";
import { escapeTelegramHtml, reviewConfirmKeyboard } from "./telegramUi";
import { borrowerDisplayName } from "./telegramUi";
import { persistTelegramDossierRef } from "./telegramDossierRefs";

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

/** Sujets où Camille doit demander avant de répondre seule. */
export function shouldForceReviewHeuristic(clientMessage: string, dossier: any): boolean {
  const blob = String(clientMessage || "").toLowerCase();
  if (/m[eé]dical|juridique|menace|avocat|tribunal|contentieux/i.test(blob)) return true;
  if (/multi|monsieur|madame|second pr[eê]t|co-emprunteur|autre contrat|partie monsieur/i.test(blob)) {
    return true;
  }
  if (/€\s*\d|[eé]conom.*\d|combien.*(gagn|économ|co[uû]t)/i.test(blob)) return true;
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

  const name = borrowerDisplayName(params.dossier);
  const excerpt = escapeTelegramHtml(review.clientMessageExcerpt.slice(0, 450));
  const question = escapeTelegramHtml(review.questionForStaff);

  const body = [
    `<b>🤔 ${escapeTelegramHtml(params.dossier.id)} — ${escapeTelegramHtml(name)}</b>`,
    ``,
    `<b>Mail client</b> (extrait) :`,
    `<i>« ${excerpt} »</i>`,
    review.reason ? `\n<i>Raison : ${escapeTelegramHtml(review.reason)}</i>` : "",
    ``,
    `<b>❓ Ma question</b> (répondez à ce message — pas de brouillon tant que vous n'avez pas guidé) :`,
    question,
    ``,
    `<i>Je rédigerai ensuite un brouillon pour votre validation avant envoi au client.</i>`,
  ]
    .filter(Boolean)
    .join("\n");

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

export function findDossierWithPendingReviewReply(
  dossiers: Dossier[],
  chatId: string,
  replyToMessageId?: number,
): Dossier | null {
  if (!replyToMessageId) return null;
  for (const d of dossiers) {
    const r = getPendingReview(d);
    if (!r || r.status !== "awaiting_staff") continue;
    if (
      String(r.telegramChatId) === String(chatId) &&
      Number(r.telegramQuestionMessageId) === Number(replyToMessageId)
    ) {
      return d;
    }
  }
  return null;
}

export async function draftClientReplyFromStaffGuidance(
  dossier: Dossier,
  review: CamillePendingReview,
  staffAnswer: string,
  allDossiers?: Dossier[],
): Promise<string> {
  const ctx = buildCamilleContextBlock(dossier, review.attachmentNames || [], allDossiers);
  const knowledgeBlock = await buildCamilleKnowledgePromptBlock(null);
  const playbooksBlock = await buildPlaybooksPromptBlock(
    review.fullClientMessage,
    dossier,
  );
  const conversationTail = getConversationTailForAi(dossier);
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

  const send = await sendEmailReplyWithGmailAPI(
    null,
    review.clientEmail,
    review.emailSubject.startsWith("Re:") ? review.emailSubject : `Re: ${review.emailSubject}`,
    review.proposedClientHtml,
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

  if (review.staffAnswer && review.proposedClientPlain) {
    saveApprovedPlaybook({
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

  addEvent(dossier, {
    type: "EMAIL_SENT",
    actor: { kind: "AI", label: "Camille" },
    message: "Mail client envoyé après validation équipe (playbook enregistré).",
    meta: { reviewId: review.id, gmailId: review.gmailId, template: "CAMILLE_REVIEW_APPROVED" },
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
  if (!replyToMessageId || !text.trim()) return false;

  const db = await readDB();
  const dossier = findDossierWithPendingReviewReply(db.dossiers, chatId, replyToMessageId);
  if (!dossier) return false;

  const result = await applyStaffAnswerToReview(dossier, text, chatId, db.dossiers);
  dossier.updatedAt = new Date().toISOString();
  await writeDB(db, dossier);

  await sendTelegramMessage(chatId, result.ok ? `✅ ${result.summary}` : `❌ ${result.summary}`, {
    dossierId: dossier.id,
  });
  return true;
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
