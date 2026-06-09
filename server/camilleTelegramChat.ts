import { readDB } from "./db";
import type { Dossier } from "./dossierModel";
import { computeDocumentChecklist } from "../shared/documentChecklist";
import { buildCamilleContextBlock } from "./camilleMail";
import { assessCertainLoanDocProblems } from "./loanDocCertainty";
import { generateContentWithRetry } from "./geminiClient";
import { buildCamilleKnowledgePromptBlock } from "./camilleKnowledgeDrive";
import { getLastClientInbound } from "./dossierLifecycle";
import { executeCamilleStaffDirective } from "./camilleStaffDirective";

const chatLastDossierId = new Map<string, string>();

const INTERNAL_ASSISTANT_PROMPT = `
Tu es Camille, assistante interne du Club Immobilier Français (assurance emprunteur).
Rémi te parle librement sur Telegram : réponds à TOUTE question (état dossier, pièces, mails, escalade, historique, prochaine étape, comparaison entre dossiers récents, etc.).

Tu as des données dossier structurées ci-dessous. Ne invente rien ; si une info manque, dis-le.
Réponds en français, clair et utile (5 à 20 lignes selon la question).
Texte simple : puces avec •, pas de HTML ni markdown.

Quand Rémi demande d'écrire au client, tu rédiges le mail (via un autre module) — ici tu confirmes seulement l'état du dossier si c'est une question.

Ne jamais citer de nom d'assureur. Pas de téléphone client.

Si un « Rapport OCR pièces prêt » est fourni, base-toi exclusivement dessus pour les documents.
Ne dis jamais que les fichiers sont des images si le rapport indique PDF ou OCR réussi avec des caractères lus.
`;

/** Consigne pour envoyer un mail client (langage naturel). */
export function looksLikeStaffDirective(text: string): boolean {
  const t = text.trim();
  const lower = t.toLowerCase();
  if (/\b(qu'est-ce|quest ce|que demande|a demandé|demande-t-il|demande t il|il a demandé|est-ce que)\b/i.test(lower)) {
    return false;
  }
  if (/^(envoie|mail|écris|ecris|demande|relance|dis-lui|transmet|renvoie|écris-lui|ecris-lui|préviens|previens)\b/i.test(t)) {
    return true;
  }
  if (/\b(mail au client|envoie au client|écris au client|ecris au client|envoie-lui|écris-lui)\b/i.test(lower)) {
    return true;
  }
  if (/\b(demande (lui|leur|au client)|relance (le|la|les) client)\b/i.test(lower)) return true;
  if (/\b(tu peux|peux-tu|pourrais-tu|je veux que tu)\b.*\b(envoyer|écrire|mail|relancer|demander)\b/i.test(lower)) {
    return true;
  }
  if (
    /\b(envoie|envoyer|écris|ecris|relance|relancer|demande|demander|transmet|renvoie|renvoyer)\b/i.test(lower) &&
    /\b(lui|leur|client|mail|pdf|offre|tableau|document|pi[eè]ce)\b/i.test(lower)
  ) {
    return true;
  }
  return false;
}

export function extractLcifId(text: string): string | null {
  return text.match(/LCIF-\d{6}/i)?.[0]?.toUpperCase() || null;
}

function normalizeForSearch(s: string): string {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type DossierResolveResult =
  | { kind: "found"; dossier: Dossier }
  | { kind: "ambiguous"; matches: Array<{ dossier: Dossier; label: string }> }
  | { kind: "none" };

/** Cible un dossier via LCIF-… ou le nom / prénom des emprunteurs (assurés). */
export async function resolveDossierFromText(text: string): Promise<DossierResolveResult> {
  const lcif = extractLcifId(text);
  if (lcif) {
    const d = await findDossierById(lcif);
    return d ? { kind: "found", dossier: d } : { kind: "none" };
  }

  const normalizedText = normalizeForSearch(text);
  if (normalizedText.length < 2) return { kind: "none" };

  const db = await readDB();
  const scored: Array<{ dossier: Dossier; score: number; label: string }> = [];

  for (const d of db.dossiers || []) {
    const assures = Array.isArray(d.formData?.assures) ? d.formData.assures : [];
    let bestForDossier = 0;
    let bestLabel = "";

    for (const a of assures) {
      const prenom = normalizeForSearch(String(a?.prenom || ""));
      const nom = normalizeForSearch(String(a?.nom || ""));
      const full = [prenom, nom].filter(Boolean).join(" ");
      const display = [a?.prenom, a?.nom].filter(Boolean).join(" ") || d.id;
      if (!full && !nom) continue;

      let score = 0;
      if (full.length >= 4 && normalizedText.includes(full)) score = 100;
      else if (nom.length >= 3 && normalizedText.includes(nom)) score = 75;
      else if (prenom.length >= 3 && normalizedText.includes(prenom)) score = 55;

      if (score === 0 && full) {
        const tokens = normalizedText.split(" ").filter(Boolean);
        for (let i = 0; i < tokens.length - 1; i++) {
          if (`${tokens[i]} ${tokens[i + 1]}` === full) {
            score = 100;
            break;
          }
        }
      }

      if (score > bestForDossier) {
        bestForDossier = score;
        bestLabel = `${display} — ${d.id}`;
      }
    }

    if (bestForDossier > 0) {
      scored.push({ dossier: d, score: bestForDossier, label: bestLabel });
    }
  }

  scored.sort((a, b) => b.score - a.score || b.dossier.id.localeCompare(a.dossier.id));
  if (scored.length === 0) return { kind: "none" };

  const bestScore = scored[0].score;
  const strong = scored.filter((s) => s.score >= bestScore - 5 && s.score >= 75);
  const weakTies = scored.filter((s) => s.score === 55);

  if (strong.length > 1) {
    return {
      kind: "ambiguous",
      matches: strong.slice(0, 6).map((s) => ({ dossier: s.dossier, label: s.label })),
    };
  }
  if (weakTies.length > 1 && bestScore === 55) {
    return {
      kind: "ambiguous",
      matches: weakTies.slice(0, 6).map((s) => ({ dossier: s.dossier, label: s.label })),
    };
  }

  return { kind: "found", dossier: scored[0].dossier };
}

/** Retire LCIF et noms emprunteurs du texte (consigne mail). */
export function stripDossierRefsFromText(text: string, dossier: Dossier): string {
  let t = text;
  t = t.replace(new RegExp(dossier.id, "i"), " ");
  const assures = Array.isArray(dossier.formData?.assures) ? dossier.formData.assures : [];
  for (const a of assures) {
    const parts = [a?.prenom, a?.nom].filter(Boolean) as string[];
    const full = parts.join(" ");
    for (const p of [full, ...parts]) {
      if (p && p.length >= 2) {
        const esc = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        t = t.replace(new RegExp(esc, "gi"), " ");
      }
    }
  }
  return t.replace(/\s+/g, " ").trim();
}

export function primaryBorrowerLabel(d: Dossier): string {
  const a = d.formData?.assures?.[0];
  return [a?.prenom, a?.nom].filter(Boolean).join(" ") || d.id;
}

export function rememberChatDossier(chatId: string, dossierId: string) {
  if (chatId && dossierId) chatLastDossierId.set(chatId, dossierId);
}

export function getRememberedDossierId(chatId: string): string | null {
  return chatLastDossierId.get(chatId) || null;
}

/** Dossier actif pour la conversation : mémoire chat → dernier mail client → dossier le plus récent. */
export async function getDefaultDossierForChat(chatId: string): Promise<Dossier | null> {
  const remembered = getRememberedDossierId(chatId);
  if (remembered) {
    const d = await findDossierById(remembered);
    if (d) return d;
  }

  const db = await readDB();
  const dossiers = [...(db.dossiers || [])];
  if (!dossiers.length) return null;

  let best: { d: Dossier; score: number } | null = null;
  for (const d of dossiers) {
    let score = new Date(d.updatedAt || d.createdAt || 0).getTime();
    const lastIn = getLastClientInbound(d);
    if (lastIn?.date) score = Math.max(score, new Date(lastIn.date).getTime()) + 1e9;
    const esc = d.camilleEscalation as { lastAt?: string; resolvedAt?: string } | undefined;
    if (esc?.lastAt && !esc?.resolvedAt) score += 2e12;
    if (!best || score > best.score) best = { d, score };
  }
  return best?.d || null;
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
    `Phase souscription: ${ctx.subscriptionPhaseLabel || "—"}`,
    `Étude envoyée: ${ctx.studySent ? "oui" : "non"} | Accord client: ${ctx.clientAcceptedInsurance ? "oui" : "non"}`,
    `Pièces manquantes checklist: ${missing.length ? missing.join(", ") : "aucune"}`,
    `Docs prêt OK (offre+tableau présents): ${ctx.loanDocsOk ? "oui" : "non"}`,
    `Problème doc certain: ${docProb.certain ? "oui — " + docProb.problems.map((p) => p.kind).join(", ") : "non"}`,
    `Escalade active: ${esc?.lastAt && !esc?.resolvedAt ? "oui (" + (esc.reason || "") + ")" : "non"}`,
    `Rapport OCR pièces prêt:\n${ctx.documentAnalysisReport || "—"}`,
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

export type TelegramChatIntent = "HELP" | "LIST_DOSSIERS" | "STAFF_DIRECTIVE" | "ASK_QUESTION";

export function classifyTelegramIntent(text: string, hasReplyToAlert: boolean): TelegramChatIntent {
  const t = text.trim();

  if (/^\/help\b/i.test(t) || /^\/aide\b/i.test(t)) return "HELP";
  if (/^\/dossiers\b/i.test(t)) return "LIST_DOSSIERS";
  if (hasReplyToAlert && t.length >= 3) return "STAFF_DIRECTIVE";

  const lcif = extractLcifId(t);
  if (lcif) {
    const afterId = t.replace(new RegExp(lcif, "i"), "").trim();
    if (afterId.length < 3) return "ASK_QUESTION";
    if (looksLikeStaffDirective(afterId) || looksLikeStaffDirective(t)) return "STAFF_DIRECTIVE";
    return "ASK_QUESTION";
  }

  if (looksLikeStaffDirective(t)) return "STAFF_DIRECTIVE";
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
  const knowledgeBlock = await buildCamilleKnowledgePromptBlock(null);

  const response = await generateContentWithRetry({
    model: "gemini-2.5-flash",
    contents: [
      { role: "user", parts: [{ text: INTERNAL_ASSISTANT_PROMPT }] },
      { role: "user", parts: [{ text: knowledgeBlock }] },
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

export async function answerCamillePortfolioBrief(): Promise<string> {
  const portfolio = await buildPortfolioSummaryAsync(15);
  return answerCamilleTelegramQuestion(
    "Quels dossiers ont eu une activité récente et quelles nouveautés dois-je surveiller en priorité ? Synthèse pour l'équipe.",
    { dossier: null, portfolioLines: portfolio },
  );
}

export function getHelpTelegramText(): string {
  return [
    "<b>Camille — votre assistante</b>",
    "",
    "<b>1. Alertes</b> — répondez au message de Camille : votre texte est relié au bon dossier automatiquement.",
    "",
    "<b>2. Boutons</b> — si plusieurs clients, j'affiche des boutons avec le <b>nom uniquement</b> (pas le numéro LCIF).",
    "",
    "<b>3. Actions rapides</b> après sélection :",
    "• 📧 Mail PDF banque",
    "• 📋 État du dossier",
    "• ✅ Pris en charge (clôt escalade)",
    "",
    "<b>Exemples de texte libre :</b>",
    "• <code>Demande-lui l'offre et le tableau en PDF</code>",
    "• <code>Où en est-on ?</code>",
    "",
    "<code>/dossiers</code> — liste · choix client par boutons si besoin",
  ].join("\n");
}
