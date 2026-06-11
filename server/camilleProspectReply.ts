/**
 * Réponse prospect : 1 salutation courte (sans LLM) ou 1 appel LLM structuré.
 * Volontairement simple — pas de pipeline multi-étapes.
 */
import { generateContentWithRetry } from "./geminiClient";
import { buildProspectCamilleKnowledgeBlock } from "../shared/lcifKnowledge";
import { getAssurancePlatformUrl } from "../shared/lcifLegalIdentity";
import {
  buildProspectLeadPromptBlock,
  buildProspectPureGreetingReplyPlain,
  isPureProspectGreeting,
  patchProspectReplyHardRules,
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

function parseJson<T extends Record<string, unknown>>(text: string, fallback: T): T {
  try {
    return { ...fallback, ...JSON.parse(text || "{}") } as T;
  } catch {
    return fallback;
  }
}

const PROSPECT_REPLY_PROMPT = `
Tu es Camille, assistante de Charles Victor (Club Immobilier Français — assurance emprunteur).
Tu rédiges un mail prospect qui n'a pas encore rempli le formulaire en ligne.

STYLE (obligatoire) :
- Comme une personne professionnelle et chaleureuse — PAS un robot commercial.
- Longueur adaptée au message : 2 à 4 lignes si le client dit juste bonjour ; 5 à 12 lignes si questions détaillées.
- Répondre à CHAQUE point du client (y compris taquineries, « êtes-vous humaine », météo…).
- Pas de formule « Bonjour » (ajoutée automatiquement).

INTERDITS :
- Coller le bloc marketing (gratuit + formulaire + PDF) si le client n'a demandé que bonjour ou une question simple.
- Liste complète des assureurs — renvoyer vers Charles ; 2-4 exemples max si question assureurs.
- Codes produits, chiffres d'économie inventés, météo inventée.
- Demander offre/tableau/CNI/RIB par email (formulaire en ligne uniquement).
- Numéro de téléphone.

FORMULAIRE :
- Lien à inclure SEULEMENT si le client veut démarrer / demande comment envoyer des documents / question sur la suite concrète.
- URL : fournie dans le contexte.

REVIEW si : médical, juridique, menace, chiffrage personnalisé, doute sérieux.
Sinon REPLY.

JSON uniquement :
{
  "action": "REPLY" | "REVIEW" | "ESCALATE",
  "messageToClient": "string ou null",
  "questionForStaff": "string ou null",
  "reasonForEscalation": "string ou null"
}
`;

export async function runProspectInboundReply(params: {
  dossier: any;
  clientMessage: string;
  emailSubject?: string;
  clientEmail: string;
  prenom: string;
  nom: string;
  conversationTail: string;
}): Promise<ProspectInboundDecision> {
  if (isPureProspectGreeting(params.clientMessage)) {
    return {
      action: "REPLY",
      messageToClient: buildProspectPureGreetingReplyPlain(params.dossier),
      model: "template",
    };
  }

  const formUrl = getAssurancePlatformUrl();
  const knowledgeBlock = buildProspectCamilleKnowledgeBlock();
  const context = `
Dossier : ${params.dossier.id} (prospect pré-formulaire)
Client : ${params.prenom} ${params.nom} <${params.clientEmail}>
Formulaire (si pertinent) : ${formUrl}

${buildProspectLeadPromptBlock(params.dossier)}

Fil récent :
${params.conversationTail || "(vide)"}

Message client :
"""
${params.clientMessage.slice(0, 8000)}
"""
`.trim();

  const model = prospectModel();
  console.log(`[Camille prospect] Réponse unique (${model}) ${params.dossier.id}`);

  const response = await generateContentWithRetry({
    model,
    contents: [
      { role: "user", parts: [{ text: PROSPECT_REPLY_PROMPT }] },
      { role: "user", parts: [{ text: `${knowledgeBlock}\n\n---\n\n${context}` }] },
    ],
    config: { responseMimeType: "application/json", temperature: 0.4 },
  });

  const parsed = parseJson(response.text || "{}", {
    action: "REVIEW",
    messageToClient: null,
    questionForStaff: `Comment répondre au prospect ? « ${params.clientMessage.slice(0, 300)} »`,
    reasonForEscalation: null,
  });

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
  if (plain.length < 10) {
    return {
      action: "REVIEW",
      questionForStaff: `Réponse prospect trop courte — que dire ? « ${params.clientMessage.slice(0, 300)} »`,
      model,
    };
  }

  plain = patchProspectReplyHardRules(plain, params.dossier, params.clientMessage);
  return { action: "REPLY", messageToClient: plain, model };
}

/** @deprecated Alias */
export const runProspectInboundReplyPipeline = runProspectInboundReply;
