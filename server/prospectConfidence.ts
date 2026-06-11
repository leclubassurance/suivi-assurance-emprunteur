/**
 * Confiance & risques prospect — même logique que le pipeline client (0-10),
 * avec un seuil de REVIEW relevé pour laisser Camille répondre seule.
 */
import type { ProspectMessageIntent } from "./prospectMessageIntent";

export type ProspectRiskAssessment = {
  riskFlags: string[];
  /** Indice heuristique avant LLM (1-10). */
  confidenceHint: number;
};

const HARD_RISK_FLAGS = new Set(["menace", "juridique"]);

export function prospectReviewConfidenceThreshold(): number {
  const n = Number(process.env.CAMILLE_PROSPECT_REVIEW_CONFIDENCE ?? "5");
  return Number.isFinite(n) ? Math.min(9, Math.max(2, n)) : 5;
}

export function prospectMinSendConfidence(): number {
  const n = Number(process.env.CAMILLE_PROSPECT_MIN_SEND_CONFIDENCE ?? "4");
  return Number.isFinite(n) ? Math.min(8, Math.max(1, n)) : 4;
}

export function clampProspectConfidence(n: unknown, fallback = 6): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(10, Math.max(0, Math.round(v)));
}

export function assessProspectRisk(
  clientMessage: string,
  intents: ProspectMessageIntent[],
): ProspectRiskAssessment {
  const msgLower = String(clientMessage || "").toLowerCase();
  const riskFlags: string[] = [];
  let confidence = 8;

  if (intents.includes("aggressive")) {
    riskFlags.push("menace");
    confidence = 2;
  }
  if (/avocat|tribunal|contentieux|plainte officielle|réclamation officielle|discrimination/i.test(msgLower)) {
    if (!riskFlags.includes("juridique")) riskFlags.push("juridique");
    confidence -= 3;
  }
  if (intents.includes("medical_legal")) {
    if (!riskFlags.includes("medical")) riskFlags.push("medical");
    confidence -= 1;
  }
  if (intents.includes("pricing")) {
    if (!riskFlags.includes("commercial")) riskFlags.push("commercial");
    confidence -= 1;
  }
  if (intents.includes("refusal")) {
    riskFlags.push("refus");
    confidence -= 1;
  }
  if (intents.includes("unclear") && intents.length <= 2) {
    confidence -= 2;
  }
  if (
    intents.some((i) =>
      ["wants_study", "faq_insurance", "faq_process", "documents", "insurers", "club_identity"].includes(
        i,
      ),
    )
  ) {
    confidence += 1;
  }

  if (riskFlags.length === 0) riskFlags.push("aucun");

  return {
    riskFlags: [...new Set(riskFlags)],
    confidenceHint: Math.min(10, Math.max(1, confidence)),
  };
}

export function isHardProspectQualityIssue(issue: string): boolean {
  const i = issue.toLowerCase();
  return (
    i.includes("violation règles assureurs") ||
    i.includes("relance commerciale après un refus")
  );
}

export function hasHardProspectRisk(riskFlags: string[]): boolean {
  return riskFlags.some((f) => HARD_RISK_FLAGS.has(f.toLowerCase()));
}

export function shouldProspectRequireReview(params: {
  llmAction: string;
  confidence: number;
  riskFlags: string[];
  hardQualityIssues: string[];
  unsafeReply: boolean;
  aggressiveIntent: boolean;
}): { review: boolean; reason?: string } {
  if (params.aggressiveIntent) {
    return { review: true, reason: "message agressif ou menaçant" };
  }
  if (params.unsafeReply) {
    return { review: true, reason: "réponse IA risquée (chiffre inventé ou hors-sujet)" };
  }
  if (params.hardQualityIssues.length > 0) {
    return { review: true, reason: params.hardQualityIssues.join(", ") };
  }

  const threshold = prospectReviewConfidenceThreshold();
  const minSend = prospectMinSendConfidence();

  if (params.confidence < minSend) {
    return { review: true, reason: `confiance trop basse (${params.confidence}/10)` };
  }

  if (hasHardProspectRisk(params.riskFlags) && params.confidence < 7) {
    return { review: true, reason: `risque ${params.riskFlags.join("/")} avec confiance ${params.confidence}/10` };
  }

  const llmWantsReview = params.llmAction === "REVIEW";
  if (llmWantsReview && params.confidence < threshold) {
    return { review: true, reason: `IA incertaine (${params.confidence}/10)` };
  }

  return { review: false };
}
