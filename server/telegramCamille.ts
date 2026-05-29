import { readDB, writeDB } from "./db";
import { addEvent, type Dossier } from "./dossierModel";

import {
  registerTelegramRefInMemory,
  persistTelegramDossierRef,
  findDossierByTelegramRef,
} from "./telegramDossierRefs";

export function registerTelegramDossierContext(chatId: string, messageId: number, dossierId: string) {
  if (!chatId || !messageId || !dossierId) return;
  registerTelegramRefInMemory(chatId, messageId, dossierId);
  void persistTelegramDossierRef(dossierId, chatId, messageId);
}

export function hasTelegramBotToken(): boolean {
  return Boolean(getBotToken());
}

export function isTelegramEnabled(): boolean {
  return Boolean(getBotToken() && getAllowedChatIds().length > 0);
}

function getBotToken() {
  return String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
}

function getAllowedChatIds(): string[] {
  return String(process.env.TELEGRAM_ALLOWED_CHAT_IDS || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getAllowedChatIdsForNotify(): string[] {
  return getAllowedChatIds();
}

function apiUrl(method: string) {
  return `https://api.telegram.org/bot${getBotToken()}/${method}`;
}

async function telegramApi(method: string, body: Record<string, unknown>) {
  const res = await fetch(apiUrl(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    throw new Error(data.description || `Telegram API ${method} failed`);
  }
  return data.result;
}

export type TelegramSendOptions = {
  reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
  /** Enregistre le message pour que « Répondre » cible ce dossier. */
  dossierId?: string;
};

/** Envoi Telegram (token seul) — utilisé pour /start avant chat_id autorisé */
export async function sendTelegramRaw(chatId: string, text: string, options?: TelegramSendOptions) {
  if (!getBotToken()) {
    console.warn("[Telegram] TELEGRAM_BOT_TOKEN manquant — impossible d'envoyer");
    return null;
  }
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: text.slice(0, 4000),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (options?.reply_markup) body.reply_markup = options.reply_markup;

  try {
    const msg = await telegramApi("sendMessage", body);
    if (msg?.message_id && options?.dossierId) {
      registerTelegramDossierContext(chatId, msg.message_id, options.dossierId);
    }
    return msg;
  } catch (e: any) {
    console.error("[Telegram] sendMessage:", e?.message || String(e));
    try {
      const fallbackBody: Record<string, unknown> = {
        chat_id: chatId,
        text: text.replace(/<[^>]+>/g, "").slice(0, 4000),
        disable_web_page_preview: true,
      };
      if (options?.reply_markup) fallbackBody.reply_markup = options.reply_markup;
      const msg = await telegramApi("sendMessage", fallbackBody);
      if (msg?.message_id && options?.dossierId) {
        registerTelegramDossierContext(chatId, msg.message_id, options.dossierId);
      }
      return msg;
    } catch (e2: any) {
      console.error("[Telegram] sendMessage fallback:", e2?.message || String(e2));
      return null;
    }
  }
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  options?: TelegramSendOptions,
) {
  if (!isTelegramEnabled()) return null;
  return sendTelegramRaw(chatId, text, options);
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendTelegramEscalationAlert(params: {
  dossier: Dossier;
  clientEmail: string;
  reason: string;
  excerpt: string;
  reminder?: boolean;
  gmailId?: string;
}) {
  const { notifyTelegramEscalation } = await import("./telegramNotify");
  await notifyTelegramEscalation({
    dossier: params.dossier,
    clientEmail: params.clientEmail,
    reason: params.reason,
    excerpt: params.excerpt,
    reminder: params.reminder,
    gmailId: params.gmailId,
  });

  const chatIds = getAllowedChatIds();
  for (const chatId of chatIds) {
    if (!params.dossier.camilleEscalation) {
      params.dossier.camilleEscalation = { lastAt: new Date().toISOString() };
    }
    params.dossier.camilleEscalation = {
      ...params.dossier.camilleEscalation,
      telegramChatId: chatId,
    } as any;
  }
}

async function findDossierForTelegramReply(
  chatId: string,
  replyToMessageId: number | undefined,
  text: string,
): Promise<Dossier | null> {
  const db = await readDB();
  if (replyToMessageId) {
    const fromRef = findDossierByTelegramRef(db.dossiers, chatId, replyToMessageId);
    if (fromRef) return fromRef;
  }

  const lcif = text.match(/LCIF-\d{6}/i)?.[0]?.toUpperCase();
  if (lcif) {
    return db.dossiers.find((d: any) => String(d.id).toUpperCase() === lcif) || null;
  }

  const { resolveDossierFromText } = await import("./camilleTelegramChat");
  const resolved = await resolveDossierFromText(text);
  if (resolved.kind === "found") return resolved.dossier;

  return null;
}

async function isReplyToCamilleAlert(chatId: string, replyToMessageId?: number): Promise<boolean> {
  if (!replyToMessageId) return false;
  const db = await readDB();
  return Boolean(findDossierByTelegramRef(db.dossiers, chatId, replyToMessageId));
}

async function runStaffDirectiveFlow(chatId: string, dossier: Dossier, instruction: string) {
  const { handleStaffDirectiveFromTelegram } = await import("./camilleTelegramChat");
  const { borrowerDisplayName } = await import("./telegramUi");
  await sendTelegramMessage(
    chatId,
    `⏳ <b>${escapeHtml(borrowerDisplayName(dossier))}</b> — j'envoie au client…`,
    { dossierId: dossier.id },
  );
  const result = await handleStaffDirectiveFromTelegram(dossier, instruction, chatId);
  const db = await readDB();
  const stored = db.dossiers.find((d: any) => d.id === dossier.id);
  if (stored) {
    stored.updatedAt = new Date().toISOString();
    await writeDB(db, stored);
  }
  if (result.ok) {
    const icon = result.action === "SEND_TO_CLIENT" ? "✅" : "✔️";
    await sendTelegramMessage(chatId, `${icon} <b>${escapeHtml(borrowerDisplayName(dossier))}</b>\n${escapeHtml(result.summary)}`, {
      dossierId: dossier.id,
    });
    addEvent(dossier, {
      type: "AI_DECISION",
      actor: { kind: "ADMIN", label: "Telegram" },
      message: `Consigne (${result.action}).`,
      meta: { channel: "telegram" },
    });
  } else {
    await sendTelegramMessage(chatId, `❌ <b>${escapeHtml(borrowerDisplayName(dossier))}</b>\n${escapeHtml(result.summary)}`, {
      dossierId: dossier.id,
    });
  }
}

async function sendDossierSelectedCard(chatId: string, dossier: Dossier) {
  const { borrowerDisplayName, dossierCollaborationKeyboard, formatDossierTelegramCard } =
    await import("./telegramUi");
  const { rememberChatDossier } = await import("./camilleTelegramChat");
  const name = borrowerDisplayName(dossier);
  rememberChatDossier(chatId, dossier.id);
  const card = formatDossierTelegramCard(dossier);
  await sendTelegramMessage(
    chatId,
    [
      `<b>👤 ${escapeHtml(name)}</b>`,
      `<i>Dossier sélectionné — répondez à ce message</i> pour votre question ou consigne (j'associe automatiquement ce client).`,
      ``,
      card,
    ].join("\n"),
    {
      reply_markup: dossierCollaborationKeyboard(dossier),
      dossierId: dossier.id,
    },
  );
}

async function answerAndSend(
  chatId: string,
  userMessage: string,
  dossier: Dossier | null,
) {
  const { answerCamilleTelegramQuestion, buildPortfolioSummaryAsync, getRememberedDossierId, findDossierById } =
    await import("./camilleTelegramChat");
  const { escapeTelegramHtml, dossierCollaborationKeyboard } = await import("./telegramUi");
  const {
    looksLikeStaffDocExtractionRequest,
    refreshLoanAnalysisIfNeeded,
    buildStaffDocExtractionReply,
  } = await import("./camilleTelegramStaff");

  let target = dossier;
  if (!target) {
    const remembered = getRememberedDossierId(chatId);
    if (remembered) target = await findDossierById(remembered);
  }

  if (target && looksLikeStaffDocExtractionRequest(userMessage)) {
    await sendTelegramMessage(chatId, "⏳ Analyse OCR des pièces reçues…", { dossierId: target.id });
    const refreshed = await refreshLoanAnalysisIfNeeded(target);
    const reply = buildStaffDocExtractionReply(refreshed);
    await sendTelegramMessage(chatId, `<pre>${escapeHtml(reply)}</pre>`, {
      reply_markup: dossierCollaborationKeyboard(refreshed),
      dossierId: refreshed.id,
    });
    return;
  }

  const portfolio = await buildPortfolioSummaryAsync(12);
  const answer = await answerCamilleTelegramQuestion(userMessage, {
    dossier: target,
    portfolioLines: portfolio,
  });

  const name = target ? (await import("./telegramUi")).borrowerDisplayName(target) : "";
  const footer = target
    ? `\n\n<i>${escapeTelegramHtml(name)} — répondez ici pour la suite.</i>`
    : "";
  await sendTelegramMessage(chatId, `${escapeTelegramHtml(answer)}${footer}`, {
    reply_markup: target ? dossierCollaborationKeyboard(target) : undefined,
    dossierId: target?.id,
  });
}

async function handleTelegramCallbackQuery(query: any) {
  const chatId = String(query?.message?.chat?.id || "");
  const data = String(query?.data || "");
  if (!chatId || !data) return;

  try {
    await telegramApi("answerCallbackQuery", { callback_query_id: query.id });
  } catch {
    /* ignore */
  }

  const { parseCallbackData, PRESET_DIRECTIVES, dossierCollaborationKeyboard } = await import("./telegramUi");
  const { findDossierById, rememberChatDossier } = await import("./camilleTelegramChat");
  const parsed = parseCallbackData(data);
  if (!parsed) return;

  const dossier = await findDossierById(parsed.dossierId);
  if (!dossier) {
    await sendTelegramMessage(chatId, "Ce dossier n'est plus en base.");
    return;
  }

  rememberChatDossier(chatId, dossier.id);

  if (parsed.action === "pick" || parsed.action === "info") {
    await sendDossierSelectedCard(chatId, dossier);
    return;
  }

  if (parsed.action === "pdf" || parsed.action === "cni" || parsed.action === "etude") {
    const preset = PRESET_DIRECTIVES[parsed.action as "pdf" | "cni" | "etude"];
    await runStaffDirectiveFlow(chatId, dossier, preset);
    return;
  }

  if (parsed.action === "sum") {
    await sendTelegramMessage(chatId, "⏳ …");
    await answerAndSend(chatId, "Donne l'état complet de ce dossier et la prochaine action recommandée.", dossier);
    return;
  }

  if (parsed.action === "ok") {
    const db = await readDB();
    const stored = db.dossiers.find((d: any) => d.id === dossier.id);
    if (stored?.camilleEscalation) {
      stored.camilleEscalation = {
        ...stored.camilleEscalation,
        resolvedAt: new Date().toISOString(),
      };
      stored.updatedAt = new Date().toISOString();
      await writeDB(db, stored);
    }
    await sendTelegramMessage(
      chatId,
      `✅ Escalade clôturée pour <b>${escapeHtml((await import("./telegramUi")).borrowerDisplayName(dossier))}</b>.`,
      { dossierId: dossier.id, reply_markup: dossierCollaborationKeyboard(dossier) },
    );
    return;
  }
}

export async function handleTelegramWebhookUpdate(update: any): Promise<void> {
  if (update?.callback_query) {
    await handleTelegramCallbackQuery(update.callback_query);
    return;
  }

  const message = update?.message;
  if (!message?.chat?.id) return;
  if (message.from?.is_bot) return;

  const chatId = String(message.chat.id);
  const text = String(message.text || "").trim();

  console.log(`[Telegram] message chatId=${chatId} text=${text.slice(0, 80)}`);

  if (!getBotToken()) {
    console.warn("[Telegram] webhook reçu mais TELEGRAM_BOT_TOKEN absent sur Railway");
    return;
  }

  const {
    classifyTelegramIntent,
    extractLcifId,
    findDossierById,
    rememberChatDossier,
    getRememberedDossierId,
    getDefaultDossierForChat,
    getHelpTelegramText,
    buildPortfolioSummaryAsync,
    answerCamillePortfolioBrief,
    primaryBorrowerLabel,
    looksLikeStaffDirective,
  } = await import("./camilleTelegramChat");
  const { escapeTelegramHtml } = await import("./telegramUi");

  if (text === "/start" || text.startsWith("/start ")) {
    await sendTelegramRaw(
      chatId,
      [
        `Bonjour Rémi 👋 Je suis <b>Camille</b>, assistante assurance du <b>Club Immobilier Français</b>.`,
        ``,
        `Je vous <b>préviens</b> dès qu'il se passe quelque chose sur un dossier.`,
        `Vous pouvez me <b>poser n'importe quelle question</b> — librement, sans commandes compliquées.`,
        ``,
        `Tapez <code>/help</code> pour quelques exemples.`,
      ].join("\n"),
    );
    return;
  }

  const allowed = getAllowedChatIds();
  if (!allowed.includes(chatId)) {
    await sendTelegramRaw(
      chatId,
      `⛔ Chat non autorisé.\n\n<b>chat_id :</b> <code>${chatId}</code>\n\nRailway → TELEGRAM_ALLOWED_CHAT_IDS`,
    );
    return;
  }

  if (!text) return;

  const replyId = message.reply_to_message?.message_id as number | undefined;
  const replyToCamille = await isReplyToCamilleAlert(chatId, replyId);
  const intent = classifyTelegramIntent(text, replyToCamille);

  if (intent === "HELP" || /^\/help\b/i.test(text) || /^\/aide\b/i.test(text)) {
    await sendTelegramMessage(chatId, getHelpTelegramText());
    return;
  }

  if (/^\/nouveaut/i.test(text)) {
    await sendTelegramMessage(chatId, "⏳ Je regarde l'activité récente…");
    const brief = await answerCamillePortfolioBrief();
    await sendTelegramMessage(chatId, escapeTelegramHtml(brief));
    return;
  }

  if (/^\/dossiers\b/i.test(text)) {
    const list = await buildPortfolioSummaryAsync(15);
    await sendTelegramMessage(
      chatId,
      `<b>Dossiers récents</b>\n\n<pre>${escapeHtml(list)}</pre>\n\n<i>Posez une question sur l'un d'eux.</i>`,
    );
    return;
  }

  if (/^\/dossier\b/i.test(text)) {
    const arg = text.replace(/^\/dossier\s*/i, "").trim();
    const { resolveDossierFromText, primaryBorrowerLabel } = await import("./camilleTelegramChat");
    const resolved = await resolveDossierFromText(arg || text);
    if (resolved.kind === "ambiguous") {
      const { buildDossierPickerKeyboard } = await import("./telegramUi");
      await sendTelegramMessage(chatId, "<b>Quel client ?</b>\n<i>Choisissez un nom ci-dessous.</i>", {
        reply_markup: buildDossierPickerKeyboard(resolved.matches.map((m) => m.dossier)),
      });
      return;
    }
    if (resolved.kind === "none") {
      await sendTelegramMessage(chatId, "Indiquez <code>/dossier LCIF-123456</code> ou <code>/dossier Nom Prénom</code>.");
      return;
    }
    const d = resolved.dossier;
    rememberChatDossier(chatId, d.id);
    await sendTelegramMessage(chatId, "⏳ …");
    await answerAndSend(
      chatId,
      `Quelles sont les nouveautés et l'état du dossier ${d.id} (${primaryBorrowerLabel(d)}) ?`,
      d,
    );
    return;
  }

  if (text === "/actif" || text.startsWith("/actif ")) {
    const remembered = getRememberedDossierId(chatId);
    if (!remembered) {
      await sendTelegramMessage(
        chatId,
        "Aucun dossier en mémoire. Indiquez un <code>LCIF-…</code>, un nom d'emprunteur, ou attendez une alerte Camille.",
      );
      return;
    }
    await answerAndSend(chatId, `Où en est le dossier ${remembered} ? Quelles sont les nouveautés ?`, await findDossierById(remembered));
    return;
  }

  const { resolveDossierFromText, stripDossierRefsFromText } = await import("./camilleTelegramChat");

  let dossier: Dossier | null = await findDossierForTelegramReply(chatId, replyId, text);
  const lcifFromText = extractLcifId(text);
  if (!dossier && lcifFromText) dossier = await findDossierById(lcifFromText);

  if (!dossier) {
    const resolved = await resolveDossierFromText(text);
    if (resolved.kind === "ambiguous") {
      const { buildDossierPickerKeyboard } = await import("./telegramUi");
      await sendTelegramMessage(chatId, "<b>Quel client ?</b>\n<i>Appuyez sur le nom, puis répondez à mon message.</i>", {
        reply_markup: buildDossierPickerKeyboard(resolved.matches.map((m) => m.dossier)),
      });
      return;
    }
    if (resolved.kind === "found") dossier = resolved.dossier;
  }

  if (!dossier) {
    dossier = await getDefaultDossierForChat(chatId);
  }

  if (dossier) rememberChatDossier(chatId, dossier.id);

  const wantsEmail =
    intent === "STAFF_DIRECTIVE" || looksLikeStaffDirective(text) || (replyToCamille && text.length >= 3);

  if (wantsEmail && dossier) {
    let instruction = stripDossierRefsFromText(text, dossier);
    if (!instruction || instruction.length < 8) {
      instruction =
        text.trim() ||
        "Rédige un mail au client pour préciser les documents de prêt nécessaires (offre + tableau en PDF banque), en t'appuyant sur l'analyse OCR. Ne pas demander CNI ni RIB.";
    }
    await runStaffDirectiveFlow(chatId, dossier, instruction);
    return;
  }

  if (!dossier) {
    const db = await readDB();
    const recent = [...(db.dossiers || [])]
      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
      .slice(0, 5);
    if (recent.length > 0) {
      const { buildDossierPickerKeyboard } = await import("./telegramUi");
      await sendTelegramMessage(chatId, "<b>Sur quel client ?</b>", {
        reply_markup: buildDossierPickerKeyboard(recent),
      });
    } else {
      await sendTelegramMessage(chatId, "Aucun dossier en base pour l'instant.");
    }
    return;
  }

  let question = stripDossierRefsFromText(text, dossier);
  if (!question || question.length < 5) {
    const who = primaryBorrowerLabel(dossier);
    question = `État du dossier ${dossier.id} (${who}) : pièces, mails récents, prochaine action pour l'équipe.`;
  }

  await sendTelegramMessage(chatId, "⏳ …");
  await answerAndSend(chatId, question, dossier);
}

export async function registerTelegramWebhook(publicBaseUrl: string) {
  if (!getBotToken()) throw new Error("TELEGRAM_BOT_TOKEN manquant");
  const url = `${publicBaseUrl.replace(/\/$/, "")}/api/telegram/webhook`;
  const body: Record<string, unknown> = { url, allowed_updates: ["message", "callback_query"] };
  const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
  if (secret) body.secret_token = secret;
  await telegramApi("setWebhook", body);
  return url;
}

export async function getTelegramWebhookInfo() {
  if (!getBotToken()) return { ok: false, error: "TELEGRAM_BOT_TOKEN manquant" };
  const info = await telegramApi("getWebhookInfo", {});
  return {
    ok: true,
    url: info?.url,
    has_custom_certificate: info?.has_custom_certificate,
    pending_update_count: info?.pending_update_count,
    last_error_message: info?.last_error_message,
    last_error_date: info?.last_error_date,
    botTokenConfigured: true,
    allowedChatIds: getAllowedChatIds(),
    webhookSecretConfigured: Boolean(String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim()),
  };
}
