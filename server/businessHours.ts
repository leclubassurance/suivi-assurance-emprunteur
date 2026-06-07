/** Délais Camille / sync Gmail — mode éco configurable (Railway). */

function envFlag(name: string, defaultValue = "false"): boolean {
  const raw = String(process.env[name] ?? defaultValue).toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "no";
}

function parisHourMinute(now = new Date()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return { hour, minute };
}

export function isRailwayEcoMode(): boolean {
  return envFlag("RAILWAY_ECO_MODE", "false");
}

/** Sync Gmail autorisée (plage horaire Paris optionnelle). */
export function isGmailAutosyncWindowOpen(now = new Date()): boolean {
  const businessOnly =
    envFlag("GMAIL_AUTOSYNC_BUSINESS_HOURS_ONLY", isRailwayEcoMode() ? "true" : "false");
  if (!businessOnly) return true;

  const startH = Number(process.env.GMAIL_AUTOSYNC_BUSINESS_START_H || "8");
  const endH = Number(process.env.GMAIL_AUTOSYNC_BUSINESS_END_H || "20");
  const { hour } = parisHourMinute(now);
  if (!Number.isFinite(startH) || !Number.isFinite(endH)) return true;
  if (startH === endH) return true;
  if (startH < endH) return hour >= startH && hour < endH;
  return hour >= startH || hour < endH;
}

export function getGmailAutosyncIntervalMs(): number {
  if (isRailwayEcoMode()) {
    return Number(process.env.GMAIL_AUTOSYNC_INTERVAL_MS || process.env.GMAIL_AUTOSYNC_ECO_INTERVAL_MS || 300_000);
  }
  return Number(
    process.env.GMAIL_AUTOSYNC_INTERVAL_MS ||
      process.env.GMAIL_AUTOSYNC_INTERVAL_BUSINESS_MS ||
      120_000,
  );
}

/** Délai avant envoi réponse Camille (~12–20 s par défaut). */
export function getCamilleReplyDelayMs(): number {
  const base = Number(process.env.CAMILLE_REPLY_DELAY_MS || "12000");
  const jitter = Number(process.env.CAMILLE_REPLY_DELAY_JITTER_MS || "8000");
  return base + Math.floor(Math.random() * Math.max(0, jitter));
}
