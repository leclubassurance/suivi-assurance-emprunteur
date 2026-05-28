import { readDB, writeDB } from "./db";
import { addEvent, type Dossier } from "./dossierModel";
import { executeCamilleStaffDirective } from "./camilleStaffDirective";

/** message_id Telegram → dossier (mémoire courte, complété par Firestore via dossier.camilleEscalation) */
const alertMessageToDossier = new Map<string, string>();

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

export async function sendTelegramMessage(chatId: string, text: string, replyMarkup?: unknown) {
  if (!isTelegramEnabled()) return null;
  return telegramApi("sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 4000),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: replyMarkup,
  });
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

export async function handleTelegramWebhookUpdate(update: any): Promise<void> {
  const message = update?.message;
  if (!message?.chat?.id || message.from?.is_bot) return;

  const chatId = String(message.chat.id);
  const allowed = getAllowedChatIds();
  if (!allowed.includes(chatId)) {
    await sendTelegramMessage(
      chatId,
      "⛔ Non autorisé. Ajoutez votre chat_id dans TELEGRAM_ALLOWED_CHAT_IDS sur Railway.",
    );
    return;
  }

  const text = String(message.text || "").trim();
  if (!text) return;

  if (text === "/start" || text.startsWith("/start ")) {
    await sendTelegramMessage(
      chatId,
      `Bonjour. Je suis le relais Camille (LCIF assurance emprunteur).\n\n<b>Votre chat_id :</b> <code>${chatId}</code>\n\nCollez-le dans Railway → TELEGRAM_ALLOWED_CHAT_IDS.\n\nQuand une escalade arrive, <b>répondez au message d'alerte</b> avec votre consigne : Camille écrira au client.\n\nVous pouvez aussi envoyer : <code>LCIF-123456 Demande les PDF banque</code>`,
    );
    return;
  }

  const replyId = message.reply_to_message?.message_id as number | undefined;
  const dossier = await findDossierForTelegramReply(chatId, replyId, text);

  if (!dossier) {
    if (text.startsWith("/")) {
      await sendTelegramMessage(
        chatId,
        "Commandes :\n/start — aide\n\nPour agir : répondez à une alerte escalade, ou envoyez :\n<code>LCIF-XXXXXX votre consigne</code>",
      );
    } else {
      await sendTelegramMessage(
        chatId,
        "Je n'ai pas trouvé de dossier. Répondez à une alerte 🟠 ou précisez <code>LCIF-123456</code> + votre consigne.",
      );
    }
    return;
  }

  let instruction = text;
  const lcif = text.match(/LCIF-\d{6}/i)?.[0];
  if (lcif) {
    instruction = text.replace(new RegExp(lcif, "i"), "").trim();
  }
  if (!instruction) {
    await sendTelegramMessage(chatId, "Précisez votre consigne après le numéro de dossier.");
    return;
  }

  await sendTelegramMessage(chatId, `⏳ Dossier <b>${dossier.id}</b> — Camille traite votre consigne…`);

  const result = await executeCamilleStaffDirective(dossier, instruction, { channel: "telegram" });

  const db = await readDB();
  const stored = db.dossiers.find((d: any) => d.id === dossier.id);
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
      message: `Consigne Telegram exécutée (${result.action}).`,
      meta: { instructionPreview: instruction.slice(0, 300) },
    });
  } else {
    await sendTelegramMessage(
      chatId,
      `❌ <b>${escapeHtml(dossier.id)}</b>\n${escapeHtml(result.summary)}`,
    );
  }
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
