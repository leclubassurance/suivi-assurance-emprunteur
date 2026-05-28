import { readDB, writeDB } from "./db";
import type { Dossier } from "./dossierModel";

export type TelegramMessageRef = {
  chatId: string;
  messageId: number;
  at: string;
};

const memoryRefs = new Map<string, string>();

function memoryKey(chatId: string, messageId: number) {
  return `${chatId}:${messageId}`;
}

export function registerTelegramRefInMemory(chatId: string, messageId: number, dossierId: string) {
  memoryRefs.set(memoryKey(chatId, messageId), dossierId.toUpperCase());
}

export function getDossierIdFromMemory(chatId: string, messageId: number): string | undefined {
  return memoryRefs.get(memoryKey(chatId, messageId));
}

export async function persistTelegramDossierRef(dossierId: string, chatId: string, messageId: number) {
  try {
    const db = await readDB();
    const dossier = db.dossiers.find((d: any) => d.id === dossierId);
    if (!dossier) return;

    if (!dossier.camilleTelegramStaff) dossier.camilleTelegramStaff = {};
    const refs: TelegramMessageRef[] = Array.isArray(dossier.camilleTelegramStaff.messageRefs)
      ? [...dossier.camilleTelegramStaff.messageRefs]
      : [];

    refs.push({ chatId: String(chatId), messageId: Number(messageId), at: new Date().toISOString() });
    dossier.camilleTelegramStaff.messageRefs = refs.slice(-40);
    dossier.camilleTelegramStaff.lastNewsAt = dossier.camilleTelegramStaff.lastNewsAt || new Date().toISOString();

    if (dossier.camilleEscalation) {
      dossier.camilleEscalation.telegramChatId = chatId;
      dossier.camilleEscalation.telegramAlertMessageId = messageId;
    }

    await writeDB(db, dossier);
  } catch (e: any) {
    console.warn("[Telegram refs] persist:", e?.message || String(e));
  }
}

export function findDossierByTelegramRef(dossiers: Dossier[], chatId: string, messageId: number): Dossier | null {
  const fromMem = getDossierIdFromMemory(chatId, messageId);
  if (fromMem) {
    const d = dossiers.find((x) => x.id === fromMem);
    if (d) return d;
  }

  for (const d of dossiers) {
    const refs = d.camilleTelegramStaff?.messageRefs || [];
    if (
      refs.some(
        (r) => String(r.chatId) === String(chatId) && Number(r.messageId) === Number(messageId),
      )
    ) {
      return d;
    }
    const esc = d.camilleEscalation;
    if (
      esc &&
      String(esc.telegramChatId) === String(chatId) &&
      Number(esc.telegramAlertMessageId) === Number(messageId)
    ) {
      return d;
    }
  }
  return null;
}
