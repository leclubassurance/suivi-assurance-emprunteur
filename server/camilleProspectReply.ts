/**
 * Pipeline prospect pré-formulaire : analyse → plan → rédaction → critique.
 * Chemin par défaut pour s'adapter aux formulations variées sans règles au cas par cas.
 */
import { generateContentWithRetry } from "./geminiClient";
import { buildProspectCamilleKnowledgeBlock } from "../shared/lcifKnowledge";
import { getAssurancePlatformUrl } from "../shared/lcifLegalIdentity";
import {
  buildProspectLeadPromptBlock,
  isSimpleProspectGreeting,
  patchProspectReplyHardRules,
} from "./camilleProspectInbound";

export { isSimpleProspectGreeting };

export type ProspectAnalyzeResult = {
  clientIntent: string;
  clientPoints: string[];
  primaryTopic: string;
  riskFlags: string[];
  mustHonor: string[];
  forbiddenMoves: string[];
  confidence: number;
};

export type ProspectPlanResult = {
  action: "REPLY" | "REVIEW" | "ESCALATE";
  reasoning: string;
  questionForStaff?: string | null;
  reasonForEscalation?: string | null;
  replyStrategy?: {
    tone?: string;
    keyPoints?: string[];
    mustInclude?: string[];
    mustAvoid?: string[];
  } | null;
};

export type ProspectInboundDecision = {
  action: "REPLY" | "REVIEW" | "ESCALATE";
  messageToClient?: string;
  questionForStaff?: string;
  reasonForEscalation?: string;
  pipeline?: {
    analyze: ProspectAnalyzeResult;
    plan: ProspectPlanResult;
    critiqueApproved?: boolean;
    model: string;
  };
};

function prospectPipelineEnabled(): boolean {
  const raw = String(process.env.CAMILLE_PROSPECT_PIPELINE_ENABLED ?? "true").toLowerCase();
  return raw !== "false" && raw !== "0";
}

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

async function callJsonStep<T extends Record<string, unknown>>(
  systemPrompt: string,
  userPrompt: string,
  fallback: T,
  temperature: number,
): Promise<T> {
  const response = await generateContentWithRetry({
    model: prospectModel(),
    contents: [
      { role: "user", parts: [{ text: systemPrompt }] },
      { role: "user", parts: [{ text: userPrompt }] },
    ],
    config: { responseMimeType: "application/json", temperature },
  });
  return parseJson(response.text || "{}", fallback);
}

function buildProspectOperationalBlock(params: {
  dossier: any;
  clientMessage: string;
  emailSubject?: string;
  clientEmail: string;
  prenom: string;
  nom: string;
  conversationTail: string;
}): string {
  const formUrl = getAssurancePlatformUrl();
  return `
Dossier : ${params.dossier.id} (PROSPECT — pré-formulaire, pas encore complété)
Client : ${params.prenom} ${params.nom} <${params.clientEmail}>
Sujet : ${params.emailSubject || "—"}
Lien formulaire obligatoire si vous invitez à démarrer l'étude : ${formUrl}

${buildProspectLeadPromptBlock(params.dossier)}

Fil récent :
${params.conversationTail || "(vide)"}

Message client (répondre à TOUT ce qui est pertinent ci-dessous — ne pas ignorer une question) :
"""
${params.clientMessage.slice(0, 8000)}
"""
`.trim();
}

const PROSPECT_ANALYZE_PROMPT = `
Tu analyses un mail prospect PRÉ-FORMULAIRE (assurance emprunteur LCIF).
Ne rédige pas de réponse client.

Extrais chaque point / question distinct(e) du client dans clientPoints (même ton informel, taquin ou hors-sujet).
primaryTopic : assureurs | documents | lemoine | gratuité | club | relationnel | hors_sujet | général | autre
riskFlags : medical | juridique | menace | chiffrage | aucun
forbiddenMoves : ce qu'il faudra éviter dans la réponse (ex. liste complète assureurs, codes produits, météo inventée…)
confidence : 0-10

JSON :
{
  "clientIntent": "string",
  "clientPoints": ["string"],
  "primaryTopic": "string",
  "riskFlags": ["string"],
  "mustHonor": ["string"],
  "forbiddenMoves": ["string"],
  "confidence": number
}
`;

const PROSPECT_PLAN_PROMPT = `
Tu planifies la réponse Camille à un prospect pré-formulaire.

Règles :
- REPLY si tu peux répondre avec la doc métier (FAQ prospect).
- REVIEW si médical/juridique/menace/chiffrage personnalisé ou doute sérieux.
- ESCALATE rare (menace, contentieux).
- replyStrategy.mustInclude : chaque point client à traiter explicitement.
- Inclure le lien formulaire SEULEMENT si le client demande comment démarrer / documents / étude — PAS sur une simple question relationnelle ou hors-sujet seule.
- Liste complète assureurs : mustAvoid — renvoyer vers Charles plus tard.
- Humain/IA : mustInclude transparence (Camille assistante, Charles conseiller).
- Hors-sujet (météo…) : mustInclude refus poli + retour assurance emprunteur.

JSON :
{
  "action": "REPLY" | "REVIEW" | "ESCALATE",
  "reasoning": "string",
  "questionForStaff": "string ou null",
  "reasonForEscalation": "string ou null",
  "replyStrategy": {
    "tone": "string",
    "keyPoints": ["string"],
    "mustInclude": ["string"],
    "mustAvoid": ["string"]
  } ou null
}
`;

const PROSPECT_DRAFT_PROMPT = `
Tu rédiges le mail prospect (5 à 14 lignes). Pas de Bonjour (ajouté automatiquement).
Réponds à CHAQUE point listé dans le plan (mustInclude). Ton humain, pas robotique.
Respecte mustAvoid. Pas de téléphone. Pas de chiffres d'économie inventés.

JSON : { "messageToClient": "string" }
`;

const PROSPECT_CRITIQUE_PROMPT = `
Tu critiques un brouillon mail prospect.

Rejeter (approved=false) si :
- une question du client est ignorée (ex. humain/IA, météo, assureurs…),
- paragraphe générique « offre de prêt + tableau » alors que le client n'en parlait pas,
- liste complète des assureurs ou codes produits internes,
- demande d'envoyer des PDF par email,
- promesse de montant d'économie,
- invention météo / faits externes,
- ton inadapté.

Si corrigeable : revisedMessage complet. Sinon suggestedAction REVIEW.

JSON :
{
  "approved": boolean,
  "issues": ["string"],
  "revisedMessage": "string ou null",
  "suggestedAction": "REPLY" | "REVIEW" | null
}
`;

function buildProspectMinimalFallback(dossier: any): string {
  const formUrl = getAssurancePlatformUrl();
  return [
    `Merci pour votre message.`,
    `Je reste à votre disposition pour vos questions sur l'assurance emprunteur.`,
    `L'étude d'économie est gratuite et sans engagement.`,
    `Pour lancer votre dossier : ${formUrl}`,
    `Référence interne : ${dossier.id}.`,
  ].join("\n\n");
}

export async function runProspectInboundReplyPipeline(params: {
  dossier: any;
  clientMessage: string;
  emailSubject?: string;
  clientEmail: string;
  prenom: string;
  nom: string;
  conversationTail: string;
}): Promise<ProspectInboundDecision> {
  if (!prospectPipelineEnabled()) {
    return {
      action: "REVIEW",
      questionForStaff: `Pipeline prospect désactivé — comment répondre ? « ${params.clientMessage.slice(0, 300)} »`,
      reasonForEscalation: "CAMILLE_PROSPECT_PIPELINE_ENABLED=false",
    };
  }

  const knowledgeBlock = buildProspectCamilleKnowledgeBlock();
  const operationalBlock = buildProspectOperationalBlock(params);
  const model = prospectModel();

  console.log(`[Camille prospect] Analyse (${model})… ${params.dossier.id}`);
  const analyze = await callJsonStep(
    PROSPECT_ANALYZE_PROMPT,
    [knowledgeBlock, operationalBlock].join("\n\n---\n\n"),
    {
      clientIntent: "non déterminé",
      clientPoints: [],
      primaryTopic: "autre",
      riskFlags: [],
      mustHonor: [],
      forbiddenMoves: [],
      confidence: 3,
    },
    0.15,
  );

  console.log(
    `[Camille prospect] Plan — topic=${analyze.primaryTopic}, points=${analyze.clientPoints?.length || 0}`,
  );
  const plan = await callJsonStep(
    PROSPECT_PLAN_PROMPT,
    [
      `ANALYSE:\n${JSON.stringify(analyze, null, 2)}`,
      knowledgeBlock,
      operationalBlock,
    ].join("\n\n---\n\n"),
    {
      action: "REVIEW",
      reasoning: "Planification échouée",
      questionForStaff: "Comment répondre à ce prospect ?",
      reasonForEscalation: null,
      replyStrategy: null,
    },
    0.2,
  );

  const basePipeline = { analyze, plan, model };

  if (plan.action === "REVIEW") {
    return {
      action: "REVIEW",
      questionForStaff:
        String(plan.questionForStaff || plan.reasoning || "").trim() ||
        `Comment répondre au prospect ? « ${params.clientMessage.slice(0, 350)} »`,
      reasonForEscalation: plan.reasonForEscalation || undefined,
      pipeline: basePipeline,
    };
  }

  if (plan.action === "ESCALATE") {
    return {
      action: "ESCALATE",
      reasonForEscalation: plan.reasonForEscalation || plan.reasoning || "Escalade prospect",
      pipeline: basePipeline,
    };
  }

  console.log(`[Camille prospect] Rédaction (${model})…`);
  const draft = await callJsonStep(
    PROSPECT_DRAFT_PROMPT,
    [
      `ANALYSE:\n${JSON.stringify(analyze, null, 2)}`,
      `PLAN:\n${JSON.stringify(plan, null, 2)}`,
      knowledgeBlock,
      operationalBlock,
    ].join("\n\n---\n\n"),
    { messageToClient: "" },
    0.35,
  );

  console.log(`[Camille prospect] Critique (${model})…`);
  const critique = await callJsonStep(
    PROSPECT_CRITIQUE_PROMPT,
    [
      `ANALYSE:\n${JSON.stringify(analyze, null, 2)}`,
      `PLAN:\n${JSON.stringify(plan, null, 2)}`,
      `BROUILLON:\n${draft.messageToClient}`,
      knowledgeBlock,
      operationalBlock,
    ].join("\n\n---\n\n"),
    { approved: true, issues: [], revisedMessage: null, suggestedAction: null },
    0.1,
  );

  let plain = String(critique.revisedMessage || draft.messageToClient || "").trim();

  if (!critique.approved && !plain) {
    if (critique.suggestedAction === "REVIEW") {
      return {
        action: "REVIEW",
        questionForStaff:
          critique.issues.join("; ") ||
          `Brouillon prospect refusé — comment répondre ? « ${params.clientMessage.slice(0, 300)} »`,
        pipeline: { ...basePipeline, critiqueApproved: false },
      };
    }
    plain = buildProspectMinimalFallback(params.dossier);
  }

  if (!plain) {
    return {
      action: "REVIEW",
      questionForStaff: `Réponse prospect vide — comment traiter ? « ${params.clientMessage.slice(0, 300)} »`,
      pipeline: { ...basePipeline, critiqueApproved: false },
    };
  }

  plain = patchProspectReplyHardRules(plain, params.dossier, params.clientMessage);

  return {
    action: "REPLY",
    messageToClient: plain,
    pipeline: { ...basePipeline, critiqueApproved: critique.approved !== false },
  };
}
