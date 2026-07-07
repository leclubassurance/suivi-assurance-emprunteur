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

/** Jour (0=dimanche…6=samedi) et heure (0-23) en fuseau Europe/Paris. */
export function parisDayHour(now = new Date()): { day: number; hour: number } {
  const weekdayShort = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    weekday: "short",
  }).format(now);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = map[weekdayShort] ?? new Date(now).getDay();
  return { day, hour: parisHourMinute(now).hour };
}

export function isRailwayEcoMode(): boolean {
  return envFlag("RAILWAY_ECO_MODE", "false");
}

/**
 * Coupe automatique du mode test (Paris).
 * Ex. untilH=1 → actif le soir et entre minuit et 00:59, coupé de 01:00 à 18:00.
 * CAMILLE_TEST_MODE_UNTIL_PARIS_H=off pour désactiver la coupe horaire.
 */
function isPastCamilleTestCutoff(now = new Date()): boolean {
  const untilRaw = String(process.env.CAMILLE_TEST_MODE_UNTIL_PARIS_H ?? "1").trim().toLowerCase();
  if (!untilRaw || untilRaw === "off" || untilRaw === "false" || untilRaw === "none") {
    return false;
  }

  const untilH = Number(untilRaw);
  if (!Number.isFinite(untilH) || untilH < 0 || untilH > 23) return false;

  const resumeH = Number(process.env.CAMILLE_TEST_MODE_RESUME_PARIS_H || "18");
  const { hour } = parisHourMinute(now);

  if (untilH <= resumeH) {
    return hour >= untilH && hour < resumeH;
  }
  return hour >= untilH || hour < resumeH;
}

/** Tests Camille : sync Gmail 24h/24, cooldown réduit, intervalle court (jusqu'à 01:00 Paris par défaut). */
export function isCamilleTestMode(now = new Date()): boolean {
  if (!envFlag("CAMILLE_TEST_MODE", "false")) return false;
  return !isPastCamilleTestCutoff(now);
}

export function getCamilleTestModeUntilParisH(): number | null {
  const untilRaw = String(process.env.CAMILLE_TEST_MODE_UNTIL_PARIS_H ?? "1").trim().toLowerCase();
  if (!untilRaw || untilRaw === "off" || untilRaw === "false" || untilRaw === "none") return null;
  const untilH = Number(untilRaw);
  return Number.isFinite(untilH) ? untilH : null;
}

/** Sync Gmail autorisée (plage horaire Paris optionnelle). */
export function isGmailAutosyncWindowOpen(now = new Date()): boolean {
  if (isCamilleTestMode()) return true;

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
  if (isCamilleTestMode()) {
    return Number(process.env.GMAIL_AUTOSYNC_INTERVAL_MS || 120_000);
  }
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
  if (isCamilleTestMode()) {
    const base = Number(process.env.CAMILLE_TEST_REPLY_DELAY_MS || "3000");
    const jitter = Number(process.env.CAMILLE_TEST_REPLY_DELAY_JITTER_MS || "2000");
    return base + Math.floor(Math.random() * Math.max(0, jitter));
  }
  const base = Number(process.env.CAMILLE_REPLY_DELAY_MS || "12000");
  const jitter = Number(process.env.CAMILLE_REPLY_DELAY_JITTER_MS || "8000");
  return base + Math.floor(Math.random() * Math.max(0, jitter));
}
