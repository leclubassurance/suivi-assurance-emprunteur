/** Délais Camille / sync Gmail (24h/24 — pas de plage horaire). */

export function getGmailAutosyncIntervalMs(): number {
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
