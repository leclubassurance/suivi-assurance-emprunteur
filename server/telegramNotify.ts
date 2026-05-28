import { sendTelegramMessage, isTelegramEnabled, getAllowedChatIdsForNotify } from "./telegramCamille";

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function notifyEnabled() {
  if (!isTelegramEnabled()) return false;
  const v = (process.env.TELEGRAM_NOTIFY_ENABLED || "true").toLowerCase();
  return v !== "false" && v !== "0";
}

/** Broadcast à tous les chats autorisés */
export async function notifyTelegramStaff(html: string) {
  if (!notifyEnabled()) return;
  const ids = getAllowedChatIdsForNotify();
  for (const chatId of ids) {
    try {
      await sendTelegramMessage(chatId, html);
    } catch (e: any) {
      console.warn(`[Telegram notify] ${chatId}:`, e?.message || String(e));
    }
  }
}

export async function notifyTelegramNewDossier(params: {
  dossierId: string;
  clientEmail: string;
  clientName?: string;
}) {
  await notifyTelegramStaff(
    [
      `<b>📁 Nouveau dossier</b>`,
      `<b>${escapeHtml(params.dossierId)}</b>`,
      `${escapeHtml(params.clientName || "Client")} — ${escapeHtml(params.clientEmail)}`,
      ``,
      `Demandez : <code>${escapeHtml(params.dossierId)} état ?</code>`,
    ].join("\n"),
  );
}

export async function notifyTelegramClientInbound(params: {
  dossierId: string;
  clientEmail: string;
  subject: string;
  excerpt: string;
}) {
  await notifyTelegramStaff(
    [
      `<b>📩 Mail client</b>`,
      `<b>${escapeHtml(params.dossierId)}</b> — ${escapeHtml(params.clientEmail)}`,
      `<i>${escapeHtml(params.subject.slice(0, 120))}</i>`,
      `<code>${escapeHtml(params.excerpt.slice(0, 400))}</code>`,
      ``,
      `Répondez ici avec une consigne ou posez une question sur ce dossier.`,
    ].join("\n"),
  );
}
