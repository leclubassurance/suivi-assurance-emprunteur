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

/** Envoi Telegram (token seul) — utilisé pour /start avant chat_id autorisé */
export async function sendTelegramRaw(chatId: string, text: string) {
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

export async function sendTelegramMessage(chatId: string, text: string) {
  if (!isTelegramEnabled()) return null;
  return sendTelegramRaw(chatId, text);
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
  await sendTelegramMessage(chatId, `⏳ <b>${escapeHtml(dossier.id)}</b> — j'envoie au client…`);
  const result = await handleStaffDirectiveFromTelegram(dossier, instruction, chatId);
  const db = await readDB();
  const stored = db.dossiers.find((d: any) => d.id === dossier.id);
  if (stored) {
    stored.updatedAt = new Date().toISOString();
    await writeDB(db, stored);
  }
  if (result.ok) {
    const icon = result.action === "SEND_TO_CLIENT" ? "✅" : "✔️";
    await sendTelegramMessage(chatId, `${icon} <b>${escapeHtml(dossier.id)}</b>\n${escapeHtml(result.summary)}`);
    addEvent(dossier, {
      type: "AI_DECISION",
      actor: { kind: "ADMIN", label: "Telegram" },
      message: `Consigne (${result.action}).`,
      meta: { channel: "telegram" },
    });
  } else {
    await sendTelegramMessage(chatId, `❌ <b>${escapeHtml(dossier.id)}</b>\n${escapeHtml(result.summary)}`);
  }
}

async function answerAndSend(
  chatId: string,
  userMessage: string,
  dossier: Dossier | null,
) {
  const { answerCamilleTelegramQuestion, buildPortfolioSummaryAsync, getRememberedDossierId, findDossierById } =
    await import("./camilleTelegramChat");
  const { escapeTelegramHtml } = await import("./telegramUi");

  let target = dossier;
  if (!target) {
    const remembered = getRememberedDossierId(chatId);
    if (remembered) target = await findDossierById(remembered);
  }

  const portfolio = await buildPortfolioSummaryAsync(12);
  const answer = await answerCamilleTelegramQuestion(userMessage, {
    dossier: target,
    portfolioLines: portfolio,
  });

  const footer = target ? `\n\n<i>Dossier : ${escapeTelegramHtml(target.id)}</i>` : "";
  await sendTelegramMessage(chatId, `${escapeTelegramHtml(answer)}${footer}`);
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
    getHelpTelegramText,
    buildPortfolioSummaryAsync,
    answerCamillePortfolioBrief,
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
      await sendTelegramMessage(
        chatId,
        `<b>Plusieurs dossiers :</b>\n${resolved.matches.map((m) => `• ${escapeHtml(m.label)}`).join("\n")}\n\nPrécisez le numéro LCIF.`,
      );
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

  const { resolveDossierFromText, stripDossierRefsFromText, primaryBorrowerLabel } = await import(
    "./camilleTelegramChat",
  );

  let dossier: Dossier | null = await findDossierForTelegramReply(chatId, replyId, text);
  const lcifFromText = extractLcifId(text);
  if (!dossier && lcifFromText) dossier = await findDossierById(lcifFromText);

  if (!dossier) {
    const resolved = await resolveDossierFromText(text);
    if (resolved.kind === "ambiguous") {
      await sendTelegramMessage(
        chatId,
        `<b>Plusieurs dossiers correspondent :</b>\n${resolved.matches.map((m) => `• ${escapeHtml(m.label)}`).join("\n")}\n\nPrécisez le numéro <code>LCIF-…</code> ou le nom complet.`,
      );
      return;
    }
    if (resolved.kind === "found") dossier = resolved.dossier;
  }

  if (dossier) rememberChatDossier(chatId, dossier.id);

  if (intent === "STAFF_DIRECTIVE") {
    if (!dossier) {
      await sendTelegramMessage(
        chatId,
        "Précisez le dossier (<code>LCIF-…</code> ou nom emprunteur) ou répondez à une alerte Camille.",
      );
      return;
    }
    let instruction = stripDossierRefsFromText(text, dossier);
    if (!instruction) instruction = text;
    await runStaffDirectiveFlow(chatId, dossier, instruction);
    return;
  }

  let question = text;
  if (dossier) {
    const after = stripDossierRefsFromText(text, dossier);
    if (after.length < 5) {
      const who = primaryBorrowerLabel(dossier);
      question = `Quelles sont les nouveautés et l'état actuel du dossier ${dossier.id} (${who}) ? Que dois-je savoir ?`;
    }
  }

  await sendTelegramMessage(chatId, "⏳ …");
  await answerAndSend(chatId, question, dossier);
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
