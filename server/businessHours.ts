/** Plages horaires Paris — sync Gmail et réponses client Camille. */

export function getParisParts(d: Date) {
  const fmt = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const weekday = (parts.find((p) => p.type === "weekday")?.value || "").toLowerCase();
  const hour = Number(parts.find((p) => p.type === "hour")?.value || "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value || "0");
  return { weekday, hour, minute };
}

/** Lun–ven 8h–19h (Paris). */
export function isWithinBusinessHours(now = new Date()): boolean {
  const { weekday, hour } = getParisParts(now);
  const isWeekend = weekday.startsWith("sam") || weekday.startsWith("dim");
  if (isWeekend) return false;
  const start = Number(process.env.BUSINESS_HOURS_START || "8");
  const end = Number(process.env.BUSINESS_HOURS_END || "19");
  return hour >= start && hour < end;
}

export function getGmailAutosyncIntervalMs(now = new Date()): number {
  if (isWithinBusinessHours(now)) {
    return Number(process.env.GMAIL_AUTOSYNC_INTERVAL_BUSINESS_MS || 120_000);
  }
  return Number(process.env.GMAIL_AUTOSYNC_INTERVAL_OFFHOURS_MS || 1_200_000);
}

/** Délai avant réponse Camille (plus court en journée). */
export function getCamilleReplyDelayMs(now = new Date()): number {
  if (!isWithinBusinessHours(now)) return 0;
  const base = Number(process.env.CAMILLE_REPLY_DELAY_MS || "12000");
  const jitter = Number(process.env.CAMILLE_REPLY_DELAY_JITTER_MS || "8000");
  return base + Math.floor(Math.random() * Math.max(0, jitter));
}
