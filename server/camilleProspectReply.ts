/**
 * Prospect pré-formulaire : 100 % rédaction IA.
 * La base de connaissances = contraintes métier, pas des textes à copier-coller.
 */
import { generateContentWithRetry } from "./geminiClient";
import { buildProspectCamilleKnowledgeBlock } from "../shared/lcifKnowledge";
import { getAssurancePlatformUrl } from "../shared/lcifLegalIdentity";
import { extractNewClientMessageText } from "./emailQuoteStrip";
import {
  buildProspectLeadPromptBlock,
  patchProspectReplyHardRules,
  prospectReplyViolatesInsurerDisclosureRules,
} from "./camilleProspectInbound";

export type ProspectInboundDecision = {
  action: "REPLY" | "REVIEW" | "ESCALATE";
  messageToClient?: string;
  questionForStaff?: string;
  reasonForEscalation?: string;
  model?: string;
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

PRINCIPES DE CONVERSATION :
- Réponds d'abord à ce que le client vient de dire, avec tes propres mots.
- Un simple « Bonjour » → réponse courte et humaine (2-4 phrases), une question ouverte. Pas de discours marketing.
- Plusieurs sujets dans le même mail → traiter chacun (humour, IA, météo, assurance…).
- Varie tes formulations ; ne répète pas les mêmes phrases d'un mail à l'autre.
- La FAQ / doc métier t'indique quoi dire ou ne pas dire — tu reformules, tu ne recopies pas un bloc.
- Pas de « Bonjour » dans messageToClient (ajouté automatiquement).
- Référence dossier en fin de mail : LCIF-XXXXXX (fournie dans le contexte).

INTERDITS MÉTIER (non négociables) :
- Liste complète des assureurs → Charles communiquera la suite ; 2-4 exemples max si question assureurs.
- Codes produits, chiffres d'économie inventés, météo inventée.
- Demander PDF / offre / tableau / CNI / RIB par email (formulaire en ligne uniquement).
- Numéro de téléphone.

REVIEW si médical, juridique, menace, chiffrage personnalisé, ou impossibilité de répondre honnêtement.
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

/** Détecte les réponses type script marketing (à éviter). */
export function prospectReplyLooksRobotic(plain: string, clientMessage?: string): string[] {
  const issues: string[] = [];
  const text = String(plain || "").toLowerCase();
  const fresh = extractNewClientMessageText(String(clientMessage || "")).trim().toLowerCase();

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

  if (text.length > 80 && fresh.length < 15 && !text.includes("?")) {
    issues.push("réponse longue sans question ouverte pour un message très court");
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
  correctionHint?: string;
}): string {
  const formUrl = getAssurancePlatformUrl();
  const knowledgeBlock = buildProspectCamilleKnowledgeBlock();
  const correction = params.correctionHint
    ? `\n\nCORRECTION DEMANDÉE (réécris entièrement, plus naturel) :\n${params.correctionHint}\n`
    : "";

  return `
${knowledgeBlock}

---

${buildProspectLeadPromptBlock(params.dossier)}

Dossier : ${params.dossier.id}
Client : ${params.prenom} ${params.nom} <${params.clientEmail}>
Sujet : ${params.emailSubject || "—"}
Formulaire (si tu invites à démarrer) : ${formUrl}

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
  console.log(`[Camille prospect] IA (${model}, t=${temperature}) ${params.dossier.id}`);

  let parsed = await callProspectLlm(
    buildUserPayload(params),
    temperature,
  );

  const issues = [
    ...prospectReplyLooksRobotic(String(parsed.messageToClient || ""), params.clientMessage),
  ];
  if (prospectReplyViolatesInsurerDisclosureRules(String(parsed.messageToClient || ""))) {
    issues.push("violation règles assureurs (liste complète ou codes produits)");
  }

  if (issues.length > 0 && String(parsed.action || "").toUpperCase() === "REPLY") {
    console.log(`[Camille prospect] Réécriture (${issues.join("; ")}) ${params.dossier.id}`);
    parsed = await callProspectLlm(
      buildUserPayload({
        ...params,
        correctionHint: issues.join("\n- "),
      }),
      Math.max(0.5, temperature - 0.1),
    );
  }

  const action = String(parsed.action || "REVIEW").toUpperCase();
  if (action === "REVIEW") {
    return {
      action: "REVIEW",
      questionForStaff:
        String(parsed.questionForStaff || "").trim() ||
        `Comment répondre ? « ${params.clientMessage.slice(0, 350)} »`,
      reasonForEscalation: String(parsed.reasonForEscalation || "").trim() || undefined,
      model,
    };
  }
  if (action === "ESCALATE") {
    return {
      action: "ESCALATE",
      reasonForEscalation:
        String(parsed.reasonForEscalation || "").trim() || "Escalade prospect",
      model,
    };
  }

  let plain = String(parsed.messageToClient || "").trim();
  if (plain.length < 8) {
    return {
      action: "REVIEW",
      questionForStaff: `Réponse IA vide ou trop courte — « ${params.clientMessage.slice(0, 300)} »`,
      model,
    };
  }

  plain = patchProspectReplyHardRules(plain, params.dossier, params.clientMessage);

  const postIssues = [
    ...prospectReplyLooksRobotic(plain, params.clientMessage),
  ];
  if (prospectReplyViolatesInsurerDisclosureRules(plain)) {
    postIssues.push("assureurs");
  }
  if (postIssues.length > 0) {
    return {
      action: "REVIEW",
      questionForStaff: `Camille n'a pas produit une réponse satisfaisante (${postIssues.join(", ")}) — votre consigne pour : « ${params.clientMessage.slice(0, 280)} »`,
      model,
    };
  }

  return { action: "REPLY", messageToClient: plain, model };
}

export const runProspectInboundReplyPipeline = runProspectInboundReply;
