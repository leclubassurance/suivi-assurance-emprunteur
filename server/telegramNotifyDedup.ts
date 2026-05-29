/** Anti-spam Telegram : mémoire process + clés persistées sur le dossier. */

const MEMORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const memoryUntil = new Map<string, number>();

function pruneMemory() {
  const now = Date.now();
  if (memoryUntil.size < 500) return;
  for (const [k, until] of memoryUntil) {
    if (until <= now) memoryUntil.delete(k);
  }
}

export function telegramNotifyKey(dossierId: string, kind: string, eventId?: string) {
  return `${dossierId}:${kind}:${eventId || ""}`;
}

export function wasTelegramNotifiedRecently(
  dossier: any,
  key: string,
  minIntervalMs = 90_000,
): boolean {
  const now = Date.now();
  const memUntil = memoryUntil.get(key);
  if (memUntil && memUntil > now) return true;

  const keys: string[] = (dossier?.camilleTelegramStaff?.notifiedKeys as string[]) || [];
  const atList: string[] = (dossier?.camilleTelegramStaff?.notifiedAt as string[]) || [];
  const idx = keys.indexOf(key);
  if (idx >= 0 && atList[idx]) {
    const t = new Date(atList[idx]).getTime();
    if (Number.isFinite(t) && now - t < minIntervalMs) return true;
  }

  return false;
}

export function markTelegramNotified(dossier: any, key: string) {
  pruneMemory();
  memoryUntil.set(key, Date.now() + MEMORY_TTL_MS);

  const staff = { ...(dossier.camilleTelegramStaff || {}) };
  const keys: string[] = [...(staff.notifiedKeys || [])];
  const atList: string[] = [...(staff.notifiedAt || [])];
  const idx = keys.indexOf(key);
  if (idx >= 0) {
    atList[idx] = new Date().toISOString();
  } else {
    keys.push(key);
    atList.push(new Date().toISOString());
  }
  const max = 80;
  staff.notifiedKeys = keys.slice(-max);
  staff.notifiedAt = atList.slice(-max);
  staff.lastNewsKey = key;
  staff.lastNewsAt = new Date().toISOString();
  dossier.camilleTelegramStaff = staff;
}
