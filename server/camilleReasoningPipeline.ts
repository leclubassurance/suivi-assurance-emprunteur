import { generateContentWithRetry } from "./geminiClient";
import { CAMILLE_PERSONA_PROMPT } from "./camillePersona";
import type { buildCamilleContextBlock } from "./camilleMail";
import { getCamilleMemoryBlock } from "./camilleDossierMemory";

export type CamilleCtx = ReturnType<typeof buildCamilleContextBlock>;

export type CamilleOperationalInput = {
  dossierId: string;
  clientEmail: string;
  prenom: string;
  nom: string;
  emailSubject?: string;
  emailText: string;
  attachmentNames: string[];
  ctx: CamilleCtx;
  staffHandling: boolean;
  staffOutbound: string;
  conversationTail: string;
  needsReply: boolean;
  multiDossierPrompt?: string;
  multiDossierAmbiguous?: boolean;
  studySent: boolean;
  clientAccepted: boolean;
  missingLoanLabels: string[];
  /** Mémoire narrative dossier (cohérence fil). */
  memoryBlock?: string;
  formJourneyBlock?: string;
};

export type CamilleAnalyzeResult = {
  clientIntent: string;
  primaryTopic: string;
  openQuestions: string[];
  riskFlags: string[];
  dossierFactsToHonor: string[];
  forbiddenMoves: string[];
  confidence: number;
};

export type CamillePlanResult = {
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

export type CamilleDraftResult = {
  messageToClient: string;
};

export type CamilleCritiqueResult = {
  approved: boolean;
  issues: string[];
  revisedMessage?: string | null;
  suggestedAction?: "REPLY" | "REVIEW" | "ESCALATE" | null;
};

export type CamilleReasoningDecision = {
  action: "REPLY" | "REVIEW" | "ESCALATE";
  messageToClient?: string;
  questionForStaff?: string;
  reasonForEscalation?: string;
  pipeline: {
    enabled: boolean;
    analyzeModel: string;
    draftModel: string;
    analyze: CamilleAnalyzeResult;
    plan: CamillePlanResult;
    draft?: CamilleDraftResult;
    critique?: CamilleCritiqueResult;
  };
};

function reasoningEnabled(): boolean {
  const raw = String(process.env.CAMILLE_REASONING_ENABLED ?? "true").toLowerCase();
  return raw !== "false" && raw !== "0";
}

function analyzeModel(): string {
  return process.env.CAMILLE_REASONING_MODEL || "gemini-2.5-pro";
}

function draftModel(): string {
  return process.env.CAMILLE_REASONING_DRAFT_MODEL || process.env.CAMILLE_REASONING_MODEL || "gemini-2.5-pro";
}

function parseJson<T extends Record<string, unknown>>(text: string, fallback: T): T {
  try {
    const parsed = JSON.parse(text || "{}");
    return { ...fallback, ...parsed } as T;
  } catch {
    return fallback;
  }
}

async function callJsonStep<T extends Record<string, unknown>>(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  fallback: T,
  temperature: number,
): Promise<T> {
  const response = await generateContentWithRetry({
    model,
    contents: [
      { role: "user", parts: [{ text: systemPrompt }] },
      { role: "user", parts: [{ text: userPrompt }] },
    ],
    config: { responseMimeType: "application/json", temperature },
  });
  return parseJson(response.text || "{}", fallback);
}

/** Bloc opérationnel dossier (extrait de aiAssistant pour le pipeline). */
export function buildCamilleOperationalPromptBlock(input: CamilleOperationalInput): string {
  const {
    dossierId,
    clientEmail,
    prenom,
    nom,
    emailSubject,
    emailText,
    attachmentNames,
    ctx,
    staffHandling,
    staffOutbound,
    conversationTail,
    needsReply,
    multiDossierPrompt,
    multiDossierAmbiguous,
    studySent,
    clientAccepted,
    missingLoanLabels,
  } = input;

  const memorySection = input.memoryBlock
    ? `\n${input.memoryBlock}\n`
    : "";

  const newAttachmentsLine =
    attachmentNames.length > 0 ? attachmentNames.join(", ") : "Aucune pièce jointe dans cet email";

  return `
Dossier : ${dossierId}
Client : ${prenom} ${nom} <${clientEmail}>
Sujet email : ${emailSubject || "—"}

${ctx.dossierSituationBlock}
${memorySection}
${input.formJourneyBlock || ""}

État des pièces (source de vérité — ne pas contredire) :
${ctx.documentSummary}

Analyse automatique OCR/PDF (ne pas contredire) :
${ctx.documentAnalysisReport || "Non disponible"}

Consignes rédaction client (si besoin de préciser des documents) :
${ctx.loanClientGuidance || "—"}

Signaux internes (ne pas révéler au client) :
${(ctx.qualityIssues || []).length ? (ctx.qualityIssues || []).join("\n") : "Aucun"}
docsReliability: ${ctx.docsReliability || "unknown"}
certainDocProblems: ${ctx.certainDocProblems ? "true" : "false"}
uncertainDocSignals: ${(ctx.uncertainDocSignals || []).join("; ") || "aucun"}
staffActivelyHandling: ${staffHandling ? "true" : "false"}
emails récents équipe vers client:
${staffOutbound}
clientSafeReason: ${ctx.clientSafeReason || "N/A"}

Pièces à demander au client (selon phase) : ${
    studySent
      ? clientAccepted
        ? missingLoanLabels.join(", ") || "Aucune — CNI/RIB déjà reçus ou non requis pour l'instant"
        : "Aucune — attendre l'accord client pour le changement d'assurance (ne pas demander CNI/RIB)"
      : missingLoanLabels.join(", ") || "Aucune — offre et tableau OK côté analyse"
  }
Étude déjà envoyée au client (studySent) : ${studySent ? "OUI — ne jamais promettre une étude à venir" : "NON"}
${ctx.lastStudyOutbound?.date ? `Dernière étude envoyée : ${ctx.lastStudyOutbound.date.slice(0, 16)} — « ${ctx.lastStudyOutbound.subject.slice(0, 80)} »` : ""}
${ctx.studyKpiSummary ? `KPI étude (interne — ne pas reciter au client) : ${ctx.studyKpiSummary}` : ""}
${ctx.plannedInsuranceChangeLabel ? `Date prévue du changement d'assurance (étude Charles — à mentionner si le client demande les délais) : ${ctx.plannedInsuranceChangeLabel}` : ""}
Phase souscription : ${ctx.subscriptionPhaseLabel || "—"}
Conduite phase : ${ctx.subscriptionGuidance || "—"}
Client a accepté le changement d'assurance : ${clientAccepted ? "OUI — CNI/RIB autorisés si manquants" : "NON — interdiction absolue de demander CNI/RIB"}
Offre + tableau présents : ${ctx.loanDocsPresent ? "OUI" : "NON"}
Offre validée : ${ctx.loanOffreExploitable ? "OUI" : "NON"}
Tableau validé : ${ctx.loanAmortExploitable ? "OUI" : "NON"}
Exploitables pour l'étude : ${ctx.loanDocsOk ? "OUI" : "NON"}
${
    studySent && attachmentNames.length > 0
      ? `
CAS — PIÈCES COMPLÉMENTAIRES APRÈS ÉTUDE (PJ dans cet email, client pas encore d'accord explicite) :
- Remercier pour les documents complémentaires transmis après l'étude des économies.
- Vérifier avec Charles si cela impacte l'étude déjà envoyée.
- Demander si le client est satisfait(e) de l'étude reçue.
- Proposer la substitution si pas d'impact — NE PAS demander CNI/RIB dans ce mail.`
      : ""
  }

Pièces jointes reçues DANS CET EMAIL : ${newAttachmentsLine}

Fil de conversation récent :
${conversationTail}

Message client sans réponse outbound après lui : ${needsReply ? "OUI — répondre maintenant" : "non"}
${multiDossierAmbiguous ? "\nIMPORTANT : plusieurs contrats actifs — ne pas mélanger les prêts.\n" : ""}
${multiDossierPrompt || ""}

Email du client :
"""
${emailText.slice(0, 8000)}
"""`.trim();
}

const ANALYZE_PROMPT = `
Tu es le module d'ANALYSE de Camille (assurance emprunteur LCIF).
Lis le contexte dossier, la doc métier et le mail client. Ne rédige PAS de réponse client.

Extrais l'intention, les sujets, les risques et les faits dossier à respecter absolument.
primaryTopic : documents | kereis | substitution | etude | remerciement | reclamation | question_generale | autre
riskFlags : medical | juridique | menace | commercial | multi_contrat | aucun
confidence : 0-10 (certitude sur ce que le client demande vraiment)

JSON uniquement :
{
  "clientIntent": "string",
  "primaryTopic": "string",
  "openQuestions": ["string"],
  "riskFlags": ["string"],
  "dossierFactsToHonor": ["string"],
  "forbiddenMoves": ["string"],
  "confidence": number
}
`;

const PLAN_PROMPT = `
Tu es le module de PLANIFICATION de Camille (assurance emprunteur LCIF).
À partir de l'analyse et du contexte, décide l'action et la stratégie de réponse.

Règles décision :
- REPLY si tu peux répondre avec certitude (documents, Kereis, substitution, relance étude, remerciement).
- REVIEW si doute réel, multi-contrat ambigu, sujet commercial sensible sans certitude — PAS de brouillon client.
- ESCALATE seulement : médical complexe, juridique, menace, réclamation agressive, impasse après plusieurs échanges.
- Si hésitation REPLY vs ESCALATE sur sujet métier : préférer REVIEW.
- Si confidence < 6 ou riskFlags graves (médical, juridique, menace) : préférer REVIEW.
- Si confidence 6-7 sur sujet routinier (documents, relance étude, remerciement, Kereis) : REPLY (brouillon validation si besoin).
- Si hésitation REPLY vs ESCALATE sur sujet métier routinier : REPLY avec prudence, pas REVIEW systématique.
- CNI/RIB uniquement si clientAccepted=true.
- studySent=true : ne jamais promettre une étude à venir.
JSON uniquement :
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
  } ou null si pas REPLY
}
`;

const DRAFT_PROMPT = `
Tu es le module de RÉDACTION de Camille (assurance emprunteur LCIF).
Rédige le corps du mail client selon le plan validé. 5 à 14 lignes, chaleureux, professionnel.

Règles messageToClient :
- Pas de Bonjour ni formule d'accueil (ajouté automatiquement).
- Pas de téléphone, pas de nom d'assureur.
- Ne jamais dire document illisible/refusé.
- Respecter strictement mustInclude / mustAvoid du plan.
- S'appuyer sur la doc Drive/RAG pour Kereis et objections.

JSON uniquement :
{ "messageToClient": "string" }
`;

const CRITIQUE_PROMPT = `
Tu es le module de CRITIQUE QUALITÉ de Camille (assurance emprunteur LCIF).
Vérifie le brouillon contre les règles métier et le contexte dossier.

Rejeter (approved=false) si le brouillon :
- demande CNI/RIB sans accord client,
- promet une étude alors que studySent=true,
- redemande offre/tableau déjà exploitables,
- contredit le fil ou l'équipe,
- mentionne téléphone ou assureur,
- est hors sujet ou trop vague.
Si corrigeable : fournir revisedMessage corrigé (même contraintes, pas de Bonjour).
Si non corrigeable : suggestedAction REVIEW ou ESCALATE.

JSON uniquement :
{
  "approved": boolean,
  "issues": ["string"],
  "revisedMessage": "string ou null",
  "suggestedAction": "REPLY" | "REVIEW" | "ESCALATE" | null
}
`;

async function stepAnalyze(
  knowledgeBlock: string,
  playbooksBlock: string,
  operationalBlock: string,
): Promise<CamilleAnalyzeResult> {
  const user = [
    CAMILLE_PERSONA_PROMPT,
    knowledgeBlock,
    playbooksBlock,
    operationalBlock,
  ].join("\n\n---\n\n");

  return callJsonStep(
    analyzeModel(),
    ANALYZE_PROMPT,
    user,
    {
      clientIntent: "non déterminé",
      primaryTopic: "autre",
      openQuestions: [],
      riskFlags: [],
      dossierFactsToHonor: [],
      forbiddenMoves: [],
      confidence: 3,
    },
    0.15,
  );
}

async function stepPlan(
  analyze: CamilleAnalyzeResult,
  knowledgeBlock: string,
  operationalBlock: string,
): Promise<CamillePlanResult> {
  const user = [
    `ANALYSE :\n${JSON.stringify(analyze, null, 2)}`,
    knowledgeBlock,
    operationalBlock,
  ].join("\n\n---\n\n");

  return callJsonStep(
    analyzeModel(),
    PLAN_PROMPT,
    user,
    {
      action: "REVIEW",
      reasoning: "Planification échouée — revue équipe",
      questionForStaff: "Le pipeline n'a pas pu planifier — que répondre au client ?",
      reasonForEscalation: null,
      replyStrategy: null,
    },
    0.2,
  );
}

async function stepDraft(
  analyze: CamilleAnalyzeResult,
  plan: CamillePlanResult,
  knowledgeBlock: string,
  operationalBlock: string,
): Promise<CamilleDraftResult> {
  const user = [
    `ANALYSE :\n${JSON.stringify(analyze, null, 2)}`,
    `PLAN :\n${JSON.stringify(plan, null, 2)}`,
    knowledgeBlock,
    operationalBlock,
  ].join("\n\n---\n\n");

  return callJsonStep(
    draftModel(),
    DRAFT_PROMPT,
    user,
    { messageToClient: "" },
    0.35,
  );
}

async function stepCritique(
  analyze: CamilleAnalyzeResult,
  plan: CamillePlanResult,
  draft: CamilleDraftResult,
  operationalBlock: string,
): Promise<CamilleCritiqueResult> {
  const user = [
    `ANALYSE :\n${JSON.stringify(analyze, null, 2)}`,
    `PLAN :\n${JSON.stringify(plan, null, 2)}`,
    `BROUILLON :\n${draft.messageToClient}`,
    operationalBlock,
  ].join("\n\n---\n\n");

  return callJsonStep(
    analyzeModel(),
    CRITIQUE_PROMPT,
    user,
    {
      approved: true,
      issues: [],
      revisedMessage: null,
      suggestedAction: null,
    },
    0.1,
  );
}

export function isCamilleReasoningEnabled(): boolean {
  return reasoningEnabled();
}

export async function runCamilleReasoningPipeline(params: {
  knowledgeBlock: string;
  playbooksBlock: string;
  operational: CamilleOperationalInput;
}): Promise<CamilleReasoningDecision> {
  const operationalBlock = buildCamilleOperationalPromptBlock(params.operational);
  const aModel = analyzeModel();
  const dModel = draftModel();

  console.log(`[Camille Phase 3] Analyse (${aModel})…`);
  const analyze = await stepAnalyze(params.knowledgeBlock, params.playbooksBlock, operationalBlock);

  console.log(
    `[Camille Phase 3] Plan — topic=${analyze.primaryTopic}, confidence=${analyze.confidence}, risks=${analyze.riskFlags.join(",") || "—"}`,
  );
  const plan = await stepPlan(analyze, params.knowledgeBlock, operationalBlock);

  const basePipeline = {
    enabled: true,
    analyzeModel: aModel,
    draftModel: dModel,
    analyze,
    plan,
  };

  if (plan.action === "REVIEW") {
    return {
      action: "REVIEW",
      messageToClient: undefined,
      questionForStaff: String(plan.questionForStaff || plan.reasoning || "").trim() || undefined,
      reasonForEscalation: plan.reasonForEscalation || undefined,
      pipeline: basePipeline,
    };
  }

  if (plan.action === "ESCALATE") {
    return {
      action: "ESCALATE",
      reasonForEscalation: plan.reasonForEscalation || plan.reasoning || "Escalade planifiée",
      pipeline: basePipeline,
    };
  }

  console.log(`[Camille Phase 3] Rédaction (${dModel})…`);
  const draft = await stepDraft(analyze, plan, params.knowledgeBlock, operationalBlock);

  console.log(`[Camille Phase 3] Critique (${aModel})…`);
  const critique = await stepCritique(analyze, plan, draft, operationalBlock);

  if (!critique.approved) {
    const revised = String(critique.revisedMessage || "").trim();
    const allowRevisedAutoReply =
      String(process.env.CAMILLE_PRODUCTION_SAFE_MODE ?? "true").toLowerCase() === "false";
    if (allowRevisedAutoReply && revised.length >= 20) {
      console.log(`[Camille Phase 3] Brouillon corrigé après critique (${critique.issues.length} issue(s))`);
      return {
        action: "REPLY",
        messageToClient: revised,
        pipeline: { ...basePipeline, draft, critique },
      };
    }
    const fallback = critique.suggestedAction || "REVIEW";
    if (fallback === "ESCALATE") {
      return {
        action: "ESCALATE",
        reasonForEscalation: critique.issues.join("; ") || "Critique qualité — escalade",
        pipeline: { ...basePipeline, draft, critique },
      };
    }
    return {
      action: "REVIEW",
      messageToClient: revised || draft.messageToClient,
      questionForStaff:
        critique.issues.join("; ") ||
        plan.questionForStaff ||
        "Le brouillon n'a pas passé la critique qualité — validation équipe requise",
      pipeline: { ...basePipeline, draft, critique },
    };
  }

  const plain = String(draft.messageToClient || "").trim();
  return {
    action: "REPLY",
    messageToClient: plain,
    pipeline: { ...basePipeline, draft, critique },
  };
}

/** Fallback single-shot (phase 1) si pipeline désactivé. */
export async function runCamilleLegacySingleShot(contents: { role: string; parts: { text: string }[] }[]): Promise<{
  action: string;
  messageToClient?: string;
  questionForStaff?: string;
  reasonForEscalation?: string;
}> {
  const response = await generateContentWithRetry({
    model: "gemini-2.5-flash",
    contents,
    config: { responseMimeType: "application/json", temperature: 0.35 },
  });
  return parseJson(response.text || "{}", {
    action: "ESCALATE",
    reasonForEscalation: "Erreur technique de l'IA (JSON invalide)",
  });
}
