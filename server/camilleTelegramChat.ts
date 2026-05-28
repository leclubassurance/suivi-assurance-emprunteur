import { readDB } from "./db";
import type { Dossier } from "./dossierModel";
import { computeDocumentChecklist } from "../shared/documentChecklist";
import { buildCamilleContextBlock } from "./camilleMail";
import { assessCertainLoanDocProblems } from "./loanDocCertainty";
import { generateContentWithRetry } from "./geminiClient";
import { executeCamilleStaffDirective } from "./camilleStaffDirective";

const chatLastDossierId = new Map<string, string>();

const INTERNAL_ASSISTANT_PROMPT = `
Tu es Camille, assistante interne du Club Immobilier Français (assurance emprunteur).
Tu parles à Rémi ou l'équipe via Telegram — ton ton est professionnel, synthétique, utile.

Tu as accès à des données dossier (statut, pièces, escalade, derniers échanges). Ne invente rien.
Si une info manque, dis-le clairement.

Tu peux :
- résumer l'état d'un dossier
- lister pièces manquantes / problèmes documents certains
- expliquer la prochaine action recommandée
- rappeler comment envoyer une consigne client : "LCIF-123456 votre consigne" ou répondre à une alerte 🟠

Ne jamais citer de nom d'assureur. Pas de téléphone client.

Réponds en français, 5 à 20 lignes max, format adapté Telegram (pas de HTML complexe, tu peux utiliser des listes à puces simples).
`;

export function extractLcifId(text: string): string | null {
  return text.match(/LCIF-\d{6}/i)?.[0]?.toUpperCase() || null;
}

export function rememberChatDossier(chatId: string, dossierId: string) {
  if (chatId && dossierId) chatLastDossierId.set(chatId, dossierId);
}

export function getRememberedDossierId(chatId: string): string | null {
  return chatLastDossierId.get(chatId) || null;
}

export async function findDossierById(id: string): Promise<Dossier | null> {
  const db = await readDB();
  const lcif = id.toUpperCase();
  return db.dossiers.find((d: any) => String(d.id).toUpperCase() === lcif) || null;
}

function dossierHeader(d: Dossier) {
  const a = d.formData?.assures?.[0];
  const name = [a?.prenom, a?.nom].filter(Boolean).join(" ") || "—";
  const email = a?.email || "—";
  return `${d.id} | ${d.status} | ${name} | ${email}`;
}

export function buildDossierDetailBlock(d: Dossier): string {
  const checklist = computeDocumentChecklist(d.formData?.documents || []);
  const ctx = buildCamilleContextBlock(d);
  const docProb = assessCertainLoanDocProblems(d);
  const esc = d.camilleEscalation as any;
  const lastComms = (d.communications || [])
    .slice(-4)
    .map((c: any) => `${c.date?.slice(0, 10) || "?"} ${c.direction}: ${String(c.subject || c.text || "").slice(0, 80)}`)
    .join("\n");

  const missing = checklist.filter((c) => !c.ok).map((c) => c.label);
  const lines = [
    dossierHeader(d),
    `Créé: ${d.createdAt?.slice(0, 10) || "?"}`,
    `Pièces manquantes checklist: ${missing.length ? missing.join(", ") : "aucune"}`,
    `Docs prêt OK (offre+tableau présents): ${ctx.loanDocsOk ? "oui" : "non"}`,
    `Problème doc certain: ${docProb.certain ? "oui — " + docProb.problems.map((p) => p.kind).join(", ") : "non"}`,
    `Escalade active: ${esc?.lastAt && !esc?.resolvedAt ? "oui (" + (esc.reason || "") + ")" : "non"}`,
    `Derniers échanges:\n${lastComms || "—"}`,
  ];
  return lines.join("\n");
}

export async function buildPortfolioSummaryAsync(limit = 12): Promise<string> {
  const db = await readDB();
  const sorted = [...(db.dossiers || [])].sort(
    (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime(),
  );
  if (sorted.length === 0) return "Aucun dossier en base.";
  return sorted
    .slice(0, limit)
    .map((d) => dossierHeader(d))
    .join("\n");
}

export type TelegramChatIntent =
  | "HELP"
  | "LIST_DOSSIERS"
  | "DOSSIER_INFO"
  | "STAFF_DIRECTIVE"
  | "ASK_QUESTION";

export function classifyTelegramIntent(text: string, hasReplyToAlert: boolean): TelegramChatIntent {
  const t = text.trim();
  const lower = t.toLowerCase();

  if (/^\/help\b/i.test(t) || /^\/aide\b/i.test(t)) return "HELP";
  if (/^\/dossiers\b/i.test(t)) return "LIST_DOSSIERS";
  if (/^\/dossier\b/i.test(t)) return "DOSSIER_INFO";

  if (hasReplyToAlert) return "STAFF_DIRECTIVE";

  const lcif = extractLcifId(t);
  if (lcif) {
    const directiveVerbs =
      /\b(demande|envoie|envoyer|relance|écris|ecris|mail|dis-lui|precise|explique|transmet|renvoyer|renvoie)\b/i;
    const questionVerbs =
      /\b(état|etat|statut|documents?|manque|résumé|resume|qui|quoi|comment|pourquoi|dernier|échange|escalade)\b/i;
    const afterId = t.replace(new RegExp(lcif, "i"), "").trim();
    if (afterId.length < 4) return "DOSSIER_INFO";
    if (directiveVerbs.test(lower) && !questionVerbs.test(lower)) return "STAFF_DIRECTIVE";
    if (questionVerbs.test(lower)) return "ASK_QUESTION";
    if (afterId.length > 15) return "STAFF_DIRECTIVE";
    return "ASK_QUESTION";
  }

  return "ASK_QUESTION";
}

export async function answerCamilleTelegramQuestion(
  userMessage: string,
  options?: { dossier?: Dossier | null; portfolioLines?: string },
): Promise<string> {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes("MY_GEMINI")) {
    return "GEMINI_API_KEY non configurée sur Railway — je ne peux pas répondre aux questions pour l'instant.";
  }

  const dossierBlock = options?.dossier ? buildDossierDetailBlock(options.dossier) : "Aucun dossier ciblé.";
  const portfolio = options?.portfolioLines || (await buildPortfolioSummaryAsync(10));

  const response = await generateContentWithRetry({
    model: "gemini-2.5-flash",
    contents: [
      { role: "user", parts: [{ text: INTERNAL_ASSISTANT_PROMPT }] },
      {
        role: "user",
        parts: [
          {
            text: `Dossiers récents:\n${portfolio}\n\n---\nDossier ciblé:\n${dossierBlock}\n\n---\nQuestion équipe:\n${userMessage.slice(0, 3000)}`,
          },
        ],
      },
    ],
    config: { temperature: 0.4 },
  });

  return String(response.text || "").trim() || "Je n'ai pas pu formuler une réponse.";
}

export async function handleStaffDirectiveFromTelegram(
  dossier: Dossier,
  instruction: string,
  chatId: string,
) {
  rememberChatDossier(chatId, dossier.id);
  return executeCamilleStaffDirective(dossier, instruction, { channel: "telegram" });
}

export function getHelpTelegramText(): string {
  return [
    "<b>Camille — LCIF Assurance</b> (24h/24)",
    "",
    "<b>Questions</b>",
    "• État d'un dossier : <code>LCIF-123456 quel est l'état ?</code>",
    "• Fiche dossier : <code>/dossier LCIF-123456</code>",
    "• Liste récente : <code>/dossiers</code>",
    "• Question générale sans numéro (dossiers récents utilisés)",
    "",
    "<b>Actions client</b>",
    "• <code>LCIF-123456 Demande les PDF banque…</code>",
    "• Ou répondre à une alerte 🟠",
    "",
    "<b>Alertes automatiques</b>",
    "🟠 Escalade · 📩 Mail client · 📁 Nouveau dossier",
    "",
    "/help — cette aide",
  ].join("\n");
}
