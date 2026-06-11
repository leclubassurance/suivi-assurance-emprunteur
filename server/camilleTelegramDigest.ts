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
import {
  markTelegramNotified,
  telegramNotifyKey,
  wasTelegramNotifiedRecently,
} from "./telegramNotifyDedup";
import {
  formatCamilleActionTelegramHtml,
  type CamilleTelegramActionDetails,
} from "./camilleTelegramActionNotify";
import { isLeadDossier } from "./leadDossierMerge";
import { extractNewClientMessageText } from "./emailQuoteStrip";

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

function dedupIntervalMs(kind: DossierNewsKind): number {
  if (kind === "escalation") return 6 * 60 * 60 * 1000;
  if (kind === "client_message" || kind === "client_documents") return 24 * 60 * 60 * 1000;
  return 2 * 60 * 60 * 1000;
}

const DIGEST_PROMPT = `
Tu es Camille, assistante assurance du Club Immobilier Français.
Tu envoies à Rémi une notification Telegram sur UN dossier.

Structure OBLIGATOIRE (HTML Telegram : <b>, <i>, •) :
1) Première ligne : <b>✅ RIEN À FAIRE</b> OU <b>⚠️ À SURVEILLER</b> OU <b>🔴 INTERVENTION REQUISE</b>
2) <b>LCIF-XXXXXX</b> — prénom nom — type de nouveauté
3) Contexte dossier en une ligne (phase, étude envoyée oui/non, accord client oui/non)
4) <b>📩 Client</b> : extrait du mail si disponible
5) <b>➡️ Pour vous</b> : une phrase claire — faut-il intervenir ? que faire concrètement ?

Règles :
- Ne jamais être vague (« je me suis occupée du dossier » interdit)
- Ne invente rien
- Escalade / review : 🔴 + consigne de répondre à CE message
- Pas de nom d'assureur
`;

async function buildNewsMessage(
  dossier: Dossier,
  kind: DossierNewsKind,
  details: {
    subject?: string;
    excerpt?: string;
    extra?: string;
    eventId?: string;
    camilleAction?: CamilleTelegramActionDetails;
  },
): Promise<string> {
  if (
    (kind === "camille_replied" || kind === "doc_followup") &&
    details.camilleAction
  ) {
    return formatCamilleActionTelegramHtml(dossier, details.camilleAction);
  }
  if (kind === "client_message" && isLeadDossier(dossier)) {
    const a = dossier.formData?.assures?.[0];
    const clientName = [a?.prenom, a?.nom].filter(Boolean).join(" ") || "Prospect";
    const excerpt = extractNewClientMessageText(details.excerpt || "").slice(0, 500);
    return [
      `<b>📩 ${escapeTelegramHtml(dossier.id)} — ${escapeTelegramHtml(clientName)}</b>`,
      `<i>Prospect pré-formulaire — nouveau message</i>`,
      excerpt ? `<b>Message :</b> <i>« ${escapeTelegramHtml(excerpt)} »</i>` : "",
      ``,
      `<b>➡️ Pour vous :</b> pas de réponse automatique Camille sur les prospects — répondez manuellement depuis Gmail ou l'admin.`,
    ]
      .filter(Boolean)
      .join("\n");
  }
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
  lines.push(``, `<i>Répondez à ce message</i> — j'associe automatiquement ce dossier (pas besoin du numéro LCIF).`);
  if (kind === "escalation") {
    lines.push(`<i>Ex. : « Demande les PDF banque » ou utilisez les boutons après avoir ouvert le fil.</i>`);
  }
  return lines.join("\n");
}

/** Camille informe Rémi d'une nouveauté sur un dossier (Telegram). */
export async function notifyRemiDossierNews(
  dossier: Dossier,
  kind: DossierNewsKind,
  details: {
    subject?: string;
    excerpt?: string;
    extra?: string;
    eventId?: string;
    camilleAction?: CamilleTelegramActionDetails;
  } = {},
): Promise<void> {
  if (!notifyEnabled()) return;

  const key = telegramNotifyKey(dossier.id, kind, details.eventId);
  if (wasTelegramNotifiedRecently(dossier, key, dedupIntervalMs(kind))) return;

  const html = await buildNewsMessage(dossier, kind, details);
  const chatIds = getAllowedChatIdsForNotify();

  for (const chatId of chatIds) {
    try {
      const msg = await sendTelegramMessage(chatId, html, { dossierId: dossier.id });
      if (msg?.message_id) {
        registerTelegramDossierContext(chatId, msg.message_id, dossier.id);
        const { rememberChatDossier } = await import("./camilleTelegramChat");
        rememberChatDossier(chatId, dossier.id);
      }
    } catch (e: any) {
      console.warn(`[Camille digest] ${chatId}:`, e?.message || String(e));
    }
  }

  markTelegramNotified(dossier, key);
}
