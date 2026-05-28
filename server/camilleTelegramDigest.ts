import type { Dossier } from "./dossierModel";
import { buildDossierDetailBlock } from "./camilleTelegramChat";
import { generateContentWithRetry } from "./geminiClient";
import {
  sendTelegramMessage,
  isTelegramEnabled,
  getAllowedChatIdsForNotify,
  registerTelegramDossierContext,
} from "./telegramCamille";
import { escapeTelegramHtml } from "./telegramUi";

export type DossierNewsKind =
  | "new_dossier"
  | "client_message"
  | "client_documents"
  | "camille_replied"
  | "staff_outbound"
  | "escalation"
  | "doc_followup"
  | "status_change";

const KIND_LABEL: Record<DossierNewsKind, string> = {
  new_dossier: "Nouveau dossier créé",
  client_message: "Nouveau message du client",
  client_documents: "Nouvelles pièces reçues par email",
  camille_replied: "Camille a répondu au client",
  staff_outbound: "L'équipe a écrit au client",
  escalation: "Intervention requise (escalade)",
  doc_followup: "Relance documents envoyée au client",
  status_change: "Changement de statut",
};

function notifyEnabled() {
  if (!isTelegramEnabled()) return false;
  const v = (process.env.TELEGRAM_NOTIFY_ENABLED || "true").toLowerCase();
  return v !== "false" && v !== "0";
}

function newsDedupKey(dossierId: string, kind: DossierNewsKind, eventId?: string) {
  return `${dossierId}:${kind}:${eventId || ""}`;
}

function shouldSkipDuplicate(dossier: Dossier, key: string, kind: DossierNewsKind): boolean {
  const staff = (dossier as any).camilleTelegramStaff as { lastNewsKey?: string; lastNewsAt?: string } | undefined;
  if (!staff?.lastNewsKey || staff.lastNewsKey !== key) return false;
  if (kind === "escalation") return false;
  const last = new Date(staff.lastNewsAt || 0).getTime();
  return Date.now() - last < 90_000;
}

function markNotified(dossier: Dossier, key: string) {
  (dossier as any).camilleTelegramStaff = {
    ...((dossier as any).camilleTelegramStaff || {}),
    lastNewsKey: key,
    lastNewsAt: new Date().toISOString(),
  };
}

const DIGEST_PROMPT = `
Tu es Camille, assistante assurance du Club Immobilier Français.
Tu envoies à Rémi une notification Telegram sur UN dossier : ce qui vient de se passer (nouveauté), l'essentiel du contexte, et ce qu'il peut faire s'il le souhaite.

Règles :
- Français, ton pro et chaleureux, 4 à 10 lignes
- HTML Telegram simple : <b>, <i>, listes à puces avec •
- Commence par une ligne titre : <b>📌 LCIF-XXXXXX</b> — type de nouveauté
- Cite le client (prénom nom) une fois
- Ne invente rien : base-toi uniquement sur les faits fournis
- Termine par une ligne : <i>Posez-moi une question sur ce dossier (avec ou sans le numéro).</i>
- Pour une escalade : indique clairement qu'il peut répondre à CE message pour envoyer un mail au client (ex. « Demande les PDF banque »)
- Pas de boutons, pas de nom d'assureur
`;

async function buildNewsMessage(
  dossier: Dossier,
  kind: DossierNewsKind,
  details: { subject?: string; excerpt?: string; extra?: string; eventId?: string },
): Promise<string> {
  const a = dossier.formData?.assures?.[0];
  const clientName = [a?.prenom, a?.nom].filter(Boolean).join(" ") || "Client";
  const facts = [
    `Type : ${KIND_LABEL[kind]}`,
    `Client : ${clientName}`,
    details.subject ? `Sujet / objet : ${details.subject}` : "",
    details.excerpt ? `Extrait :\n${details.excerpt.slice(0, 1200)}` : "",
    details.extra ? `Détail : ${details.extra}` : "",
    ``,
    `État dossier (données internes) :`,
    buildDossierDetailBlock(dossier),
  ]
    .filter(Boolean)
    .join("\n");

  if (!process.env.GEMINI_API_KEY || String(process.env.GEMINI_API_KEY).includes("MY_GEMINI")) {
    return fallbackNewsHtml(dossier, kind, details, clientName);
  }

  try {
    const response = await generateContentWithRetry({
      model: "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [{ text: DIGEST_PROMPT }] },
        { role: "user", parts: [{ text: facts }] },
      ],
      config: { temperature: 0.35 },
    });
    const text = String(response.text || "").trim();
    if (text.length > 40) return text;
  } catch (e: any) {
    console.warn("[Camille digest]", e?.message || String(e));
  }
  return fallbackNewsHtml(dossier, kind, details, clientName);
}

function fallbackNewsHtml(
  dossier: Dossier,
  kind: DossierNewsKind,
  details: { subject?: string; excerpt?: string },
  clientName: string,
) {
  const lines = [
    `<b>📌 ${escapeTelegramHtml(dossier.id)}</b>`,
    escapeTelegramHtml(KIND_LABEL[kind]),
    `👤 ${escapeTelegramHtml(clientName)}`,
  ];
  if (details.subject) lines.push(`<i>${escapeTelegramHtml(details.subject.slice(0, 120))}</i>`);
  if (details.excerpt) lines.push(`<code>${escapeTelegramHtml(details.excerpt.slice(0, 300))}</code>`);
  lines.push(``, `<i>Posez-moi une question sur ce dossier.</i>`);
  if (kind === "escalation") {
    lines.push(`<i>Répondez ici pour qu'j'envoie un mail au client selon votre consigne.</i>`);
  }
  return lines.join("\n");
}

/** Camille informe Rémi d'une nouveauté sur un dossier (Telegram). */
export async function notifyRemiDossierNews(
  dossier: Dossier,
  kind: DossierNewsKind,
  details: { subject?: string; excerpt?: string; extra?: string; eventId?: string } = {},
): Promise<void> {
  if (!notifyEnabled()) return;

  const key = newsDedupKey(dossier.id, kind, details.eventId);
  if (shouldSkipDuplicate(dossier, key, kind)) return;

  const html = await buildNewsMessage(dossier, kind, details);
  const chatIds = getAllowedChatIdsForNotify();

  for (const chatId of chatIds) {
    try {
      const msg = await sendTelegramMessage(chatId, html);
      if (msg?.message_id) {
        registerTelegramDossierContext(chatId, msg.message_id, dossier.id);
        const { rememberChatDossier } = await import("./camilleTelegramChat");
        rememberChatDossier(chatId, dossier.id);
      }
    } catch (e: any) {
      console.warn(`[Camille digest] ${chatId}:`, e?.message || String(e));
    }
  }

  markNotified(dossier, key);
}
