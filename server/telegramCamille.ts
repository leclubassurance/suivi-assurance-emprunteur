import { readDB, writeDB } from "./db";
import { addEvent, type Dossier } from "./dossierModel";

/** message_id Telegram → dossier (mémoire courte, complété par Firestore via dossier.camilleEscalation) */
const alertMessageToDossier = new Map<string, string>();

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

/** Envoi Telegram (token seul) — utilisé pour /start avant chat_id autorisé */
export async function sendTelegramRaw(chatId: string, text: string, replyMarkup?: unknown) {
  if (!getBotToken()) {
    console.warn("[Telegram] TELEGRAM_BOT_TOKEN manquant — impossible d'envoyer");
    return null;
  }
  try {
    return await telegramApi("sendMessage", {
      chat_id: chatId,
      text: text.slice(0, 4000),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    });
  } catch (e: any) {
    console.error("[Telegram] sendMessage:", e?.message || String(e));
    try {
      return await telegramApi("sendMessage", {
        chat_id: chatId,
        text: text.replace(/<[^>]+>/g, "").slice(0, 4000),
        disable_web_page_preview: true,
      });
    } catch (e2: any) {
      console.error("[Telegram] sendMessage fallback:", e2?.message || String(e2));
      return null;
    }
  }
}

export async function sendTelegramMessage(chatId: string, text: string, replyMarkup?: unknown) {
  if (!isTelegramEnabled()) return null;
  return sendTelegramRaw(chatId, text, replyMarkup);
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
}) {
  if (!isTelegramEnabled()) return;

  const chatIds = getAllowedChatIds();
  const title = params.reminder ? "🔔 Rappel escalade" : "🟠 Escalade Camille";
  const text = [
    `<b>${title}</b>`,
    ``,
    `<b>Dossier :</b> ${escapeHtml(params.dossier.id)}`,
    `<b>Client :</b> ${escapeHtml(params.clientEmail)}`,
    `<b>Raison :</b> ${escapeHtml(params.reason || "—")}`,
    ``,
    `<i>Répondez à CE message</i> avec votre consigne (ex. « Demande les PDF banque offre + tableau »).`,
    `Camille enverra le mail au client automatiquement.`,
    ``,
    `<code>${escapeHtml(params.excerpt.slice(0, 500))}</code>`,
  ].join("\n");

  for (const chatId of chatIds) {
    try {
      const msg = await sendTelegramMessage(chatId, text);
      if (msg?.message_id) {
        const key = `${chatId}:${msg.message_id}`;
        alertMessageToDossier.set(key, params.dossier.id);
        if (!params.dossier.camilleEscalation) {
          params.dossier.camilleEscalation = { lastAt: new Date().toISOString() };
        }
        params.dossier.camilleEscalation = {
          ...params.dossier.camilleEscalation,
          telegramChatId: chatId,
          telegramAlertMessageId: msg.message_id,
        } as any;
      }
    } catch (e: any) {
      console.warn("[Telegram] envoi alerte:", e?.message || String(e));
    }
  }
}

async function findDossierForTelegramReply(
  chatId: string,
  replyToMessageId: number | undefined,
  text: string,
): Promise<Dossier | null> {
  const db = await readDB();
  if (replyToMessageId) {
    const key = `${chatId}:${replyToMessageId}`;
    const fromMem = alertMessageToDossier.get(key);
    if (fromMem) {
      const d = db.dossiers.find((x: any) => x.id === fromMem);
      if (d) return d;
    }
    for (const d of db.dossiers) {
      const esc = d.camilleEscalation as any;
      if (
        esc &&
        String(esc.telegramChatId) === String(chatId) &&
        Number(esc.telegramAlertMessageId) === Number(replyToMessageId)
      ) {
        return d;
      }
    }
  }

  const lcif = text.match(/LCIF-\d{6}/i)?.[0]?.toUpperCase();
  if (lcif) {
    return db.dossiers.find((d: any) => String(d.id).toUpperCase() === lcif) || null;
  }

  return null;
}

async function isReplyToEscalationAlert(chatId: string, replyToMessageId?: number): Promise<boolean> {
  if (!replyToMessageId) return false;
  const key = `${chatId}:${replyToMessageId}`;
  if (alertMessageToDossier.has(key)) return true;
  const db = await readDB();
  for (const d of db.dossiers) {
    const esc = d.camilleEscalation as any;
    if (
      esc &&
      String(esc.telegramChatId) === String(chatId) &&
      Number(esc.telegramAlertMessageId) === Number(replyToMessageId)
    ) {
      return true;
    }
  }
  return false;
}

export async function handleTelegramWebhookUpdate(update: any): Promise<void> {
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
    answerCamilleTelegramQuestion,
    handleStaffDirectiveFromTelegram,
    buildDossierDetailBlock,
    buildPortfolioSummaryAsync,
    getHelpTelegramText,
  } = await import("./camilleTelegramChat");

  if (text === "/start" || text.startsWith("/start ")) {
    await sendTelegramRaw(
      chatId,
      `Bonjour, je suis <b>Camille</b> (LCIF assurance emprunteur), disponible 24h/24.\n\n<b>chat_id :</b> <code>${chatId}</code>\n\nTapez <code>/help</code> pour les commandes.\n\nExemples :\n• <code>LCIF-123456 quel est l'état ?</code>\n• <code>/dossiers</code>\n• <code>LCIF-123456 Demande les PDF banque</code>`,
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
  const replyToAlert = await isReplyToEscalationAlert(chatId, replyId);
  const intent = classifyTelegramIntent(text, replyToAlert);

  if (intent === "HELP") {
    await sendTelegramMessage(chatId, getHelpTelegramText());
    return;
  }

  if (intent === "LIST_DOSSIERS") {
    const list = await buildPortfolioSummaryAsync(15);
    await sendTelegramMessage(
      chatId,
      `<b>Dossiers récents</b>\n<pre>${escapeHtml(list)}</pre>`,
    );
    return;
  }

  let dossier: Dossier | null = await findDossierForTelegramReply(chatId, replyId, text);
  const lcifFromText = extractLcifId(text);
  if (!dossier && lcifFromText) dossier = await findDossierById(lcifFromText);
  if (!dossier && intent === "ASK_QUESTION") {
    const remembered = getRememberedDossierId(chatId);
    if (remembered) dossier = await findDossierById(remembered);
  }
  if (dossier) rememberChatDossier(chatId, dossier.id);

  if (intent === "DOSSIER_INFO") {
    if (!dossier) {
      await sendTelegramMessage(chatId, "Dossier introuvable. Indiquez <code>LCIF-123456</code>.");
      return;
    }
    const detail = buildDossierDetailBlock(dossier);
    await sendTelegramMessage(chatId, `<b>${escapeHtml(dossier.id)}</b>\n<pre>${escapeHtml(detail)}</pre>`);
    return;
  }

  if (intent === "STAFF_DIRECTIVE") {
    if (!dossier) {
      await sendTelegramMessage(
        chatId,
        "Précisez le dossier : <code>LCIF-123456</code> + votre consigne, ou répondez à une alerte 🟠.",
      );
      return;
    }
    let instruction = text;
    if (lcifFromText) instruction = text.replace(new RegExp(lcifFromText, "i"), "").trim();
    if (!instruction && replyToAlert) instruction = text;
    if (!instruction) {
      await sendTelegramMessage(chatId, "Ajoutez votre consigne après le numéro de dossier.");
      return;
    }

    await sendTelegramMessage(chatId, `⏳ <b>${escapeHtml(dossier.id)}</b> — j'envoie au client…`);
    const result = await handleStaffDirectiveFromTelegram(dossier, instruction, chatId);

    const db = await readDB();
    const stored = db.dossiers.find((d: any) => d.id === dossier!.id);
    if (stored) {
      stored.updatedAt = new Date().toISOString();
      await writeDB(db, stored);
    }

    if (result.ok) {
      const icon = result.action === "SEND_TO_CLIENT" ? "✅" : "✔️";
      await sendTelegramMessage(
        chatId,
        `${icon} <b>${escapeHtml(dossier.id)}</b>\n${escapeHtml(result.summary)}`,
      );
      addEvent(dossier, {
        type: "AI_DECISION",
        actor: { kind: "ADMIN", label: "Telegram" },
        message: `Consigne Telegram (${result.action}).`,
        meta: { instructionPreview: instruction.slice(0, 300) },
      });
    } else {
      await sendTelegramMessage(
        chatId,
        `❌ <b>${escapeHtml(dossier.id)}</b>\n${escapeHtml(result.summary)}`,
      );
    }
    return;
  }

  await sendTelegramMessage(chatId, "⏳ Je regarde…");
  const portfolio = await buildPortfolioSummaryAsync(10);
  const answer = await answerCamilleTelegramQuestion(text, { dossier, portfolioLines: portfolio });
  const plain = answer.replace(/</g, "‹").replace(/>/g, "›");
  await sendTelegramMessage(chatId, plain);
}

export async function registerTelegramWebhook(publicBaseUrl: string) {
  if (!getBotToken()) throw new Error("TELEGRAM_BOT_TOKEN manquant");
  const url = `${publicBaseUrl.replace(/\/$/, "")}/api/telegram/webhook`;
  const body: Record<string, unknown> = { url, allowed_updates: ["message"] };
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
