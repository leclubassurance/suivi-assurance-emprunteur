/**
 * Prospect pré-formulaire : rédaction IA guidée par intention + garde-fous code.
 */
import { generateContentWithRetry } from "./geminiClient";
import { buildProspectCamilleKnowledgeBlock } from "../shared/lcifKnowledge";
import { getAssurancePlatformUrl } from "../shared/lcifLegalIdentity";
import { extractNewClientMessageText } from "./emailQuoteStrip";
import {
  buildProspectLeadPromptBlock,
  patchProspectReplyHardRules,
  prospectReplyViolatesDocumentChannelRules,
} from "./camilleProspectInbound";
import { prospectReplyViolatesInsurerDisclosureRules } from "../shared/kereisPartners";
import {
  analyzeProspectMessageIntent,
  prospectReplyMatchesIntentStrategy,
  type ProspectIntentAnalysis,
} from "./prospectMessageIntent";

export type ProspectInboundDecision = {
  action: "REPLY" | "REVIEW" | "ESCALATE";
  messageToClient?: string;
  questionForStaff?: string;
  reasonForEscalation?: string;
  model?: string;
  intentPrimary?: string;
};

function prospectModel(): string {
  return process.env.CAMILLE_PROSPECT_MODEL || "gemini-2.5-flash";
}

function prospectTemperature(): number {
  const n = Number(process.env.CAMILLE_PROSPECT_TEMPERATURE || "0.72");
  return Number.isFinite(n) ? Math.min(1, Math.max(0.2, n)) : 0.72;
}

function parseJson<T extends Record<string, unknown>>(text: string, fallback: T): T {
  try {
    return { ...fallback, ...JSON.parse(text || "{}") } as T;
  } catch {
    return fallback;
  }
}

const PROSPECT_PERSONA = `
Tu es Camille, assistante de Charles Victor au Club Immobilier Français (assurance emprunteur).
Tu écris des mails comme une vraie personne : naturel, chaleureux, direct — jamais un script commercial.

Suis le bloc STRATÉGIE D'INTENTION fourni dans le message utilisateur — il prime sur tes réflexes généraux.

PRINCIPES :
- Réponds d'abord à ce que le client vient de dire, avec tes propres mots.
- Plusieurs sujets → traiter chacun dans l'ordre.
- Pas de « Bonjour » dans messageToClient (ajouté automatiquement).
- Référence dossier LCIF-XXXXXX en fin de mail.

DOCUMENTS : lien formulaire + « ne pas envoyer par mail » UNIQUEMENT si la stratégie le demande.

INTERDITS : liste complète assureurs, chiffres inventés, météo inventée, numéro de téléphone.

REVIEW si la stratégie l'indique ou si médical/juridique/menace/chiffrage impossible honnêtement.
`;

async function callProspectLlm(
  userPayload: string,
  temperature: number,
): Promise<Record<string, unknown>> {
  const response = await generateContentWithRetry({
    model: prospectModel(),
    contents: [
      { role: "user", parts: [{ text: PROSPECT_PERSONA }] },
      { role: "user", parts: [{ text: userPayload }] },
    ],
    config: { responseMimeType: "application/json", temperature },
  });
  return parseJson(response.text || "{}", {
    action: "REVIEW",
    messageToClient: null,
    questionForStaff: "Réponse IA invalide — validation équipe",
    reasonForEscalation: null,
  });
}

function patchProspectReplyForSend(
  plain: string,
  dossier: any,
  clientMessage: string | undefined,
  intent: ProspectIntentAnalysis,
): string {
  const needsDocLink = prospectReplyViolatesDocumentChannelRules(plain);
  return patchProspectReplyHardRules(plain, dossier, clientMessage, {
    shouldIncludeFormLink: intent.shouldIncludeFormLink || needsDocLink,
  });
}

function collectProspectReplyIssues(
  plain: string,
  clientMessage: string,
  intent: ProspectIntentAnalysis,
): string[] {
  const issues: string[] = [];
  const text = String(plain || "").toLowerCase();
  const fresh = extractNewClientMessageText(String(clientMessage || "")).trim().toLowerCase();

  issues.push(...prospectReplyMatchesIntentStrategy(plain, clientMessage, intent));

  const cannedPatterns = [
    /merci pour votre message et l'intérêt que vous portez/,
    /pour démarrer, complétez le formulaire sécurisé/,
    /vous pourrez y déposer l'offre de prêt et le tableau/,
    /pas besoin de les envoyer en pièce jointe par email/,
  ];
  for (const re of cannedPatterns) {
    if (re.test(text)) issues.push("formulation script marketing détectée");
  }

  const isShortHi = /^(bonjour|bonsoir|salut|hello|coucou)[\s!.?,]*$/i.test(fresh);
  if (isShortHi) {
    const pushes = [/formulaire/, /pdf/, /tableau/, /offre de prêt/, /gratuite et sans engagement/].filter(
      (re) => re.test(text),
    ).length;
    if (pushes >= 2) issues.push("trop de contenu commercial pour un simple bonjour");
  }

  if (text.length > 80 && fresh.length < 15 && !text.includes("?") && !intent.intents.includes("refusal")) {
    issues.push("réponse longue sans question ouverte pour un message très court");
  }

  return [...new Set(issues)];
}

function collectBlockingReplyIssues(
  plain: string,
  clientMessage: string,
  intent: ProspectIntentAnalysis,
): string[] {
  const issues = collectProspectReplyIssues(plain, clientMessage, intent);
  if (prospectReplyViolatesInsurerDisclosureRules(plain)) {
    issues.push("violation règles assureurs (liste complète ou codes produits)");
  }
  return [...new Set(issues)];
}

function buildUserPayload(params: {
  dossier: any;
  clientMessage: string;
  emailSubject?: string;
  clientEmail: string;
  prenom: string;
  nom: string;
  conversationTail: string;
  intent: ProspectIntentAnalysis;
  correctionHint?: string;
}): string {
  const formUrl = getAssurancePlatformUrl();
  const knowledgeBlock = buildProspectCamilleKnowledgeBlock();
  const correction = params.correctionHint
    ? `\n\nCORRECTION DEMANDÉE (réécris entièrement, plus naturel) :\n${params.correctionHint}\n`
    : "";
  const formLine = params.intent.shouldIncludeFormLink
    ? `Formulaire à inclure si tu cites documents / démarrage : ${formUrl}`
    : `Ne PAS inclure le lien formulaire sur ce mail (stratégie intention).`;

  return `
${knowledgeBlock}

---

${buildProspectLeadPromptBlock(params.dossier)}

---

${params.intent.strategyBlock}

---

Dossier : ${params.dossier.id}
Client : ${params.prenom} ${params.nom} <${params.clientEmail}>
Sujet : ${params.emailSubject || "—"}
${formLine}

Fil de conversation :
${params.conversationTail || "(premier échange)"}

Message client à traiter :
"""
${params.clientMessage.slice(0, 8000)}
"""
${correction}

JSON :
{
  "action": "REPLY" | "REVIEW" | "ESCALATE",
  "messageToClient": "texte plain sans Bonjour ni signature",
  "questionForStaff": "string ou null",
  "reasonForEscalation": "string ou null"
}
`.trim();
}

export async function runProspectInboundReply(params: {
  dossier: any;
  clientMessage: string;
  emailSubject?: string;
  clientEmail: string;
  prenom: string;
  nom: string;
  conversationTail: string;
}): Promise<ProspectInboundDecision> {
  const model = prospectModel();
  const temperature = prospectTemperature();
  const intent = analyzeProspectMessageIntent(params.clientMessage);

  console.log(
    `[Camille prospect] IA (${model}, t=${temperature}) ${params.dossier.id} — intent=${intent.primary} [${intent.intents.join(",")}] formLink=${intent.shouldIncludeFormLink}`,
  );

  if (intent.shouldForceReview) {
    return {
      action: "REVIEW",
      questionForStaff: `Prospect (${intent.primary}) — ${intent.reviewReason || "validation équipe"} : « ${params.clientMessage.slice(0, 320)} »`,
      reasonForEscalation: intent.reviewReason,
      model,
      intentPrimary: intent.primary,
    };
  }

  let parsed = await callProspectLlm(
    buildUserPayload({ ...params, intent }),
    temperature,
  );

  let draft = String(parsed.messageToClient || "").trim();
  let issues = collectBlockingReplyIssues(draft, params.clientMessage, intent);

  if (issues.length > 0 && String(parsed.action || "").toUpperCase() === "REPLY") {
    console.log(`[Camille prospect] Réécriture (${issues.join("; ")}) ${params.dossier.id}`);
    parsed = await callProspectLlm(
      buildUserPayload({
        ...params,
        intent,
        correctionHint: issues.join("\n- "),
      }),
      Math.max(0.5, temperature - 0.1),
    );
    draft = String(parsed.messageToClient || "").trim();
    issues = collectBlockingReplyIssues(draft, params.clientMessage, intent);
  }

  let action = String(parsed.action || "REVIEW").toUpperCase();

  if (action === "ESCALATE") {
    return {
      action: "ESCALATE",
      reasonForEscalation:
        String(parsed.reasonForEscalation || "").trim() || "Escalade prospect",
      model,
      intentPrimary: intent.primary,
    };
  }

  if (draft.length < 8) {
    return {
      action: "REVIEW",
      questionForStaff: `Réponse IA vide ou trop courte (${intent.primary}) — « ${params.clientMessage.slice(0, 300)} »`,
      model,
      intentPrimary: intent.primary,
    };
  }

  const hadDocViolation = prospectReplyViolatesDocumentChannelRules(draft);
  let plain = patchProspectReplyForSend(draft, params.dossier, params.clientMessage, intent);
  if (hadDocViolation && !prospectReplyViolatesDocumentChannelRules(plain)) {
    console.log(`[Camille prospect] Lien formulaire injecté avant envoi (${params.dossier.id})`);
  }

  let postIssues = collectBlockingReplyIssues(plain, params.clientMessage, intent);

  // L'IA a mis REVIEW mais le texte est exploitable après injection formulaire → envoyer.
  if (action === "REVIEW" && postIssues.length === 0) {
    console.log(
      `[Camille prospect] REVIEW annulé — réponse patchée OK (${params.dossier.id}, intent=${intent.primary})`,
    );
    action = "REPLY";
  }

  if (action === "REVIEW") {
    return {
      action: "REVIEW",
      questionForStaff:
        String(parsed.questionForStaff || "").trim() ||
        `Camille (${intent.primary}) — ${postIssues.join(", ") || "validation équipe"} — « ${params.clientMessage.slice(0, 280)} »`,
      reasonForEscalation: String(parsed.reasonForEscalation || "").trim() || undefined,
      model,
      intentPrimary: intent.primary,
    };
  }

  if (postIssues.length > 0) {
    return {
      action: "REVIEW",
      questionForStaff: `Camille (${intent.primary}) — ${postIssues.join(", ")} — consigne pour : « ${params.clientMessage.slice(0, 280)} »`,
      model,
      intentPrimary: intent.primary,
    };
  }

  return { action: "REPLY", messageToClient: plain, model, intentPrimary: intent.primary };
}

/** @deprecated alias */
export const runProspectInboundReplyPipeline = runProspectInboundReply;

/** Détecte les réponses type script marketing (à éviter). */
export function prospectReplyLooksRobotic(plain: string, clientMessage?: string): string[] {
  const intent = analyzeProspectMessageIntent(String(clientMessage || ""));
  return collectProspectReplyIssues(plain, String(clientMessage || ""), intent);
}
