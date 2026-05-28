/**
 * Alertes escalade : email (défaut) + canaux optionnels plus réactifs (Slack, Discord, ntfy).
 */

export type EscalationAlertPayload = {
  dossierId: string;
  clientEmail: string;
  reason: string;
  excerpt: string;
  reminder?: boolean;
};

function appBaseUrl() {
  const u = String(process.env.APP_URL || process.env.VITE_API_URL || "").trim().replace(/\/$/, "");
  return u || null;
}

function buildPlainSummary(p: EscalationAlertPayload) {
  const title = p.reminder ? "Rappel escalade Camille" : "Escalade Camille — action requise";
  return [
    title,
    `Dossier: ${p.dossierId}`,
    `Client: ${p.clientEmail}`,
    `Raison: ${p.reason || "—"}`,
    p.excerpt ? `Extrait: ${p.excerpt.slice(0, 400)}` : "",
    appBaseUrl() ? `Admin: ${appBaseUrl()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function postJsonWebhook(url: string, body: unknown, label: string) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[Alert ${label}] HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (e: any) {
    console.warn(`[Alert ${label}]`, e?.message || String(e));
    return false;
  }
}

/** Slack incoming webhook */
async function notifySlack(p: EscalationAlertPayload) {
  const url = String(process.env.AI_ESCALATION_SLACK_WEBHOOK_URL || "").trim();
  if (!url) return false;
  const text = buildPlainSummary(p);
  return postJsonWebhook(url, { text }, "Slack");
}

/** Discord incoming webhook */
async function notifyDiscord(p: EscalationAlertPayload) {
  const url = String(process.env.AI_ESCALATION_DISCORD_WEBHOOK_URL || "").trim();
  if (!url) return false;
  const content = buildPlainSummary(p).slice(0, 1900);
  return postJsonWebhook(url, { content }, "Discord");
}

/**
 * ntfy.sh — notifications push mobile (gratuit, sans compte si topic secret).
 * Ex: AI_ESCALATION_NTFY_TOPIC=lcif-assurance-secret-xyz
 * S'abonner sur l'app ntfy au même topic.
 */
async function notifyNtfy(p: EscalationAlertPayload) {
  const topic = String(process.env.AI_ESCALATION_NTFY_TOPIC || "").trim();
  if (!topic) return false;
  const title = p.reminder ? `Rappel ${p.dossierId}` : `Escalade ${p.dossierId}`;
  try {
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers: {
        Title: title,
        Priority: p.reminder ? "default" : "high",
        Tags: "email,bell",
      },
      body: buildPlainSummary(p),
    });
    return res.ok;
  } catch (e: any) {
    console.warn("[Alert ntfy]", e?.message || String(e));
    return false;
  }
}

export async function notifyEscalationSideChannels(p: EscalationAlertPayload) {
  const results = await Promise.allSettled([notifySlack(p), notifyDiscord(p), notifyNtfy(p)]);
  const sent = results.filter((r) => r.status === "fulfilled" && r.value === true).length;
  if (sent > 0) {
    console.log(`[Alert] ${sent} canal(aux) instantané(s) notifié(s) pour ${p.dossierId}`);
  }
}
