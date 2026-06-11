/**
 * Prospect pré-formulaire : rédaction IA guidée par intention + garde-fous code.
 */
import { generateContentWithRetry } from "./geminiClient";
import { buildProspectCamilleKnowledgeBlock } from "../shared/lcifKnowledge";
import { getAssurancePlatformUrl } from "../shared/lcifLegalIdentity";
import { extractNewClientMessageText } from "./emailQuoteStrip";
import {
  buildProspectLeadPromptBlock,
  isUnsafeProspectLlmReply,
  patchProspectReplyHardRules,
} from "./camilleProspectInbound";
import {
  clampProspectConfidence,
  isHardProspectQualityIssue,
  shouldProspectRequireReview,
} from "./prospectConfidence";
import type { CamilleAnalyzeResult } from "./camilleReasoningPipeline";
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
  confidence?: number;
  riskFlags?: string[];
  analyze?: CamilleAnalyzeResult;
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
Tu es Camille, experte assurance emprunteur au Club Immobilier Français (Kereis, Loi Lemoine, substitution).
Tu écris comme une vraie personne : naturel, chaleureux, direct — jamais un script commercial.

Suis le bloc STRATÉGIE D'INTENTION fourni — il prime sur tes réflexes généraux.

PRINCIPES :
- Réponds d'abord à ce que le client vient de dire, avec tes propres mots.
- Plusieurs sujets → traiter chacun dans l'ordre.
- Pas de « Bonjour » dans messageToClient (ajouté automatiquement).
- Référence dossier LCIF-XXXXXX en fin de mail.
- Par défaut : REPLY — tu maîtrises la FAQ prospect (process, Lemoine, garanties, documents, Kereis).

DOCUMENTS : lien formulaire + « ne pas envoyer par mail » UNIQUEMENT si la stratégie le demande.

INTERDITS :
- Phrases toutes faites : « Merci pour votre message et l'intérêt que vous portez », « complétez le formulaire sécurisé », « gratuite et sans engagement » en bloc, « pas besoin de les envoyer en pièce jointe ».
- Liste complète assureurs, chiffres d'économie inventés, météo inventée, numéro de téléphone.
- Copier un modèle : chaque mail doit sonner comme une vraie conversation email.

REVIEW seulement si tu ne peux vraiment pas répondre honnêtement (confidence < 5) ou menace/litige actif.
ESCALATE : menace grave, insulte, impasse totale — rare en prospect.
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
    confidence: 4,
    riskFlags: ["aucun"],
    messageToClient: null,
    questionForStaff: "Réponse IA invalide — validation équipe",
    reasonForEscalation: null,
  });
}

function mergeProspectRiskFlags(...groups: unknown[]): string[] {
  const flags = groups
    .flatMap((g) => (Array.isArray(g) ? g : []))
    .map((f) => String(f || "").trim().toLowerCase())
    .filter((f) => f && f !== "aucun");
  return flags.length ? [...new Set(flags)] : ["aucun"];
}

function buildProspectAnalyzeResult(params: {
  clientMessage: string;
  intent: ProspectIntentAnalysis;
  confidence: number;
  riskFlags: string[];
}): CamilleAnalyzeResult {
  return {
    clientIntent: params.clientMessage.slice(0, 200),
    primaryTopic: params.intent.primary,
    openQuestions: [],
    riskFlags: params.riskFlags,
    dossierFactsToHonor: [],
    forbiddenMoves: ["chiffres inventés", "liste complète assureurs"],
    confidence: params.confidence,
  };
}

function splitQualityIssues(issues: string[]): { hard: string[]; soft: string[] } {
  const hard = issues.filter(isHardProspectQualityIssue);
  const soft = issues.filter((i) => !isHardProspectQualityIssue(i));
  return { hard, soft };
}

function patchProspectReplyForSend(
  plain: string,
  dossier: any,
  clientMessage: string | undefined,
  intent: ProspectIntentAnalysis,
): string {
  return patchProspectReplyHardRules(plain, dossier, clientMessage, {
    shouldIncludeFormLink: intent.shouldIncludeFormLink,
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
  "confidence": 0-10,
  "riskFlags": ["medical" | "juridique" | "menace" | "commercial" | "aucun"],
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

  const riskFlags = mergeProspectRiskFlags(intent.riskFlags, []);
  let confidence = intent.confidenceHint;

  console.log(
    `[Camille prospect] IA (${model}, t=${temperature}) ${params.dossier.id} — intent=${intent.primary} [${intent.intents.join(",")}] formLink=${intent.shouldIncludeFormLink} confHint=${confidence}/10 risks=${riskFlags.join(",")}`,
  );

  if (intent.shouldForceReview) {
    return {
      action: "REVIEW",
      questionForStaff: `Prospect (${intent.primary}) — ${intent.reviewReason || "validation équipe"} : « ${params.clientMessage.slice(0, 320)} »`,
      reasonForEscalation: intent.reviewReason,
      model,
      intentPrimary: intent.primary,
      confidence,
      riskFlags,
      analyze: buildProspectAnalyzeResult({
        clientMessage: params.clientMessage,
        intent,
        confidence,
        riskFlags,
      }),
    };
  }

  let parsed = await callProspectLlm(
    buildUserPayload({ ...params, intent }),
    temperature,
  );

  let draft = String(parsed.messageToClient || "").trim();
  let issues = collectBlockingReplyIssues(draft, params.clientMessage, intent);
  confidence = clampProspectConfidence(parsed.confidence, intent.confidenceHint);
  const mergedRiskFlags = mergeProspectRiskFlags(riskFlags, parsed.riskFlags);

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
    confidence = clampProspectConfidence(parsed.confidence, confidence);
  }

  let action = String(parsed.action || "REPLY").toUpperCase();
  const analyze = buildProspectAnalyzeResult({
    clientMessage: params.clientMessage,
    intent,
    confidence,
    riskFlags: mergeProspectRiskFlags(mergedRiskFlags, parsed.riskFlags),
  });

  if (action === "ESCALATE" && confidence >= 5 && !intent.intents.includes("aggressive")) {
    console.log(
      `[Camille prospect] ESCALATE → REPLY (conf=${confidence}/10) ${params.dossier.id}`,
    );
    action = "REPLY";
  }

  if (action === "ESCALATE") {
    return {
      action: "ESCALATE",
      reasonForEscalation:
        String(parsed.reasonForEscalation || "").trim() || "Escalade prospect",
      model,
      intentPrimary: intent.primary,
      confidence,
      riskFlags: analyze.riskFlags,
      analyze,
    };
  }

  if (draft.length < 8) {
    return {
      action: "REVIEW",
      questionForStaff: `Réponse IA vide ou trop courte (${intent.primary}, conf=${confidence}/10) — « ${params.clientMessage.slice(0, 300)} »`,
      model,
      intentPrimary: intent.primary,
      confidence,
      riskFlags: analyze.riskFlags,
      analyze,
    };
  }

  let plain = patchProspectReplyForSend(draft, params.dossier, params.clientMessage, intent);

  let postIssues = collectBlockingReplyIssues(plain, params.clientMessage, intent);

  if (isUnsafeProspectLlmReply(plain, params.clientMessage) && confidence >= 5) {
    console.log(`[Camille prospect] Réécriture (réponse risquée) ${params.dossier.id}`);
    parsed = await callProspectLlm(
      buildUserPayload({
        ...params,
        intent,
        correctionHint:
          "Ta réponse précédente était risquée ou hors-sujet. Réécris entièrement : réponds au mail du client, sans chiffre inventé, sans phrase toute faite, ton naturel.",
      }),
      Math.max(0.5, temperature - 0.15),
    );
    draft = String(parsed.messageToClient || "").trim();
    confidence = clampProspectConfidence(parsed.confidence, confidence);
    plain = patchProspectReplyForSend(draft, params.dossier, params.clientMessage, intent);
    postIssues = collectBlockingReplyIssues(plain, params.clientMessage, intent);
  }
  const { hard: hardIssues, soft: softIssues } = splitQualityIssues(postIssues);

  if (action === "REVIEW" && hardIssues.length === 0 && softIssues.length === 0 && confidence >= 6) {
    console.log(
      `[Camille prospect] REVIEW IA annulé — conf=${confidence}/10 (${params.dossier.id}, intent=${intent.primary})`,
    );
    action = "REPLY";
  }

  const unsafe = isUnsafeProspectLlmReply(plain, params.clientMessage);
  const reviewGate = shouldProspectRequireReview({
    llmAction: action,
    confidence,
    riskFlags: analyze.riskFlags,
    hardQualityIssues: hardIssues,
    unsafeReply: unsafe,
    aggressiveIntent: intent.intents.includes("aggressive"),
  });

  if (reviewGate.review) {
    if (
      softIssues.length > 0 &&
      hardIssues.length === 0 &&
      !unsafe &&
      confidence >= 6 &&
      plain.length >= 40
    ) {
      console.log(
        `[Camille prospect] Qualité soft ignorée (conf=${confidence}/10) — envoi ${params.dossier.id}: ${softIssues.join("; ")}`,
      );
    } else {
      return {
        action: "REVIEW",
        questionForStaff:
          String(parsed.questionForStaff || "").trim() ||
          `Camille (${intent.primary}, conf=${confidence}/10) — ${reviewGate.reason || softIssues.join(", ") || "validation équipe"} — « ${params.clientMessage.slice(0, 280)} »`,
        reasonForEscalation: String(parsed.reasonForEscalation || "").trim() || undefined,
        model,
        intentPrimary: intent.primary,
        confidence,
        riskFlags: analyze.riskFlags,
        analyze,
      };
    }
  }

  console.log(
    `[Camille prospect] Envoi auto conf=${confidence}/10 risks=${analyze.riskFlags.join(",")} ${params.dossier.id}`,
  );

  return {
    action: "REPLY",
    messageToClient: plain,
    model,
    intentPrimary: intent.primary,
    confidence,
    riskFlags: analyze.riskFlags,
    analyze,
  };
}

/** @deprecated alias */
export const runProspectInboundReplyPipeline = runProspectInboundReply;

/** Détecte les réponses type script marketing (à éviter). */
export function prospectReplyLooksRobotic(plain: string, clientMessage?: string): string[] {
  const intent = analyzeProspectMessageIntent(String(clientMessage || ""));
  return collectProspectReplyIssues(plain, String(clientMessage || ""), intent);
}
