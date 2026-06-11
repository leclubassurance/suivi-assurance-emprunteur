import { hasStudyBeenSent } from "./dossierLifecycle";
import { clientHasAcceptedInsuranceChange } from "./insuranceAcceptance";
import {
  countMentionedKereisPartnersInText,
  KEREIS_PARTNER_INSURERS,
} from "../shared/kereisPartners";
import {
  messagePromisesFutureStudy,
  messageRequestsMissingIdentityDocs,
  messageRequestsMissingLoanDocs,
} from "./camilleClientMessage";
import type { CamilleReasoningDecision } from "./camilleReasoningPipeline";

/** Mode prod : brouillon Telegram obligatoire avant envoi des réponses IA libres. */
export function isCamilleProductionSafeMode(): boolean {
  const raw = String(process.env.CAMILLE_PRODUCTION_SAFE_MODE ?? "true").toLowerCase();
  return raw !== "false" && raw !== "0";
}

export function getClientMinAutoSendConfidence(): number {
  const n = Number(process.env.CAMILLE_CLIENT_MIN_SEND_CONFIDENCE ?? "8");
  return Number.isFinite(n) ? Math.min(10, Math.max(0, n)) : 8;
}

export function getClientReviewConfidence(): number {
  const n = Number(process.env.CAMILLE_CLIENT_REVIEW_CONFIDENCE ?? "6");
  return Number.isFinite(n) ? Math.min(10, Math.max(0, n)) : 6;
}

export type ClientReplyValidationKind =
  | "autonomous_reply"
  | "playbook"
  | "template_identity"
  | "template_complementary_docs"
  | "doc_clarify"
  | "doc_followup"
  | "cooldown_ack"
  | "staff_directive";

/** Réponses pré-validées (playbooks, templates) — envoi direct autorisé. */
export function isPreApprovedClientReplyKind(kind: ClientReplyValidationKind): boolean {
  return (
    kind === "playbook" ||
    kind === "template_identity" ||
    kind === "template_complementary_docs" ||
    kind === "cooldown_ack" ||
    kind === "staff_directive"
  );
}

export function isHighConfidenceAutoSendAllowed(confidence?: number): boolean {
  const enabled =
    String(process.env.CAMILLE_ALLOW_HIGH_CONFIDENCE_AUTO ?? "true").toLowerCase() !== "false";
  if (!enabled) return false;
  const min = Number(process.env.CAMILLE_CLIENT_HIGH_CONFIDENCE_AUTO ?? "9");
  const threshold = Number.isFinite(min) ? min : 9;
  return confidence !== undefined && confidence >= threshold;
}

export function shouldQueueClientReplyForValidation(
  kind: ClientReplyValidationKind,
  confidence?: number,
): boolean {
  if (isPreApprovedClientReplyKind(kind)) return false;
  if (isHighConfidenceAutoSendAllowed(confidence)) return false;
  if (!isCamilleProductionSafeMode()) {
    const raw = String(process.env.CAMILLE_DRAFT_BEFORE_SEND ?? "false").toLowerCase();
    return raw === "true" || raw === "1";
  }
  return true;
}

export function extractPipelineConfidence(decision: {
  pipeline?: CamilleReasoningDecision["pipeline"];
}): number | undefined {
  const c = decision.pipeline?.analyze?.confidence;
  return typeof c === "number" && Number.isFinite(c) ? c : undefined;
}

export function shouldForceClientReviewByConfidence(confidence?: number): boolean {
  if (confidence === undefined) return isCamilleProductionSafeMode();
  return confidence < getClientReviewConfidence();
}

export function shouldBlockClientAutoSendByConfidence(confidence?: number): boolean {
  if (confidence === undefined) return isCamilleProductionSafeMode();
  return confidence < getClientMinAutoSendConfidence();
}

export function isUnsafeClientLlmReply(
  plain: string,
  dossier: any,
  context?: { clientMessage?: string },
): { unsafe: boolean; issues: string[] } {
  const issues: string[] = [];
  const text = String(plain || "").trim();
  const lower = text.toLowerCase();

  if (text.length < 20) {
    issues.push("réponse trop courte");
  }

  if (/\b0[1-9](?:[\s.\-]?\d{2}){4}\b/.test(text) || /\b\+33[\s.\-]?\d/.test(text)) {
    issues.push("numéro de téléphone interdit");
  }

  if (countMentionedKereisPartnersInText(text) >= 2) {
    issues.push("énumération excessive de compagnies d'assurance");
  }

  for (const p of KEREIS_PARTNER_INSURERS) {
    for (const ref of String(p.productRefs || "").split(/\s+et\s+/i)) {
      const r = ref.trim();
      if (r.length >= 4 && lower.includes(r.toLowerCase())) {
        issues.push("code produit assureur interne");
        break;
      }
    }
  }

  if (/€\s*\d{2,}|[eé]conomis(ez|r).{0,40}\d+\s*€|vous gagn(ez|erez).{0,30}\d+/i.test(text)) {
    issues.push("promesse chiffrée interdite");
  }

  if (hasStudyBeenSent(dossier) && messagePromisesFutureStudy(text)) {
    issues.push("promet une étude alors qu'elle est déjà envoyée");
  }

  if (
    !hasStudyBeenSent(dossier) &&
    !clientHasAcceptedInsuranceChange(dossier) &&
    messageRequestsMissingIdentityDocs(text)
  ) {
    issues.push("demande CNI/RIB avant étude");
  }

  if (messageRequestsMissingLoanDocs(text)) {
    const loanDocs = (dossier?.formData?.documents || []).some((d: any) =>
      /offre|amort|tableau|pret|prêt/i.test(String(d?.name || d?.category || "")),
    );
    if (loanDocs) {
      issues.push("redemande offre/tableau déjà présents");
    }
  }

  const clientMsg = String(context?.clientMessage || "").toLowerCase();
  if (clientMsg.length >= 15) {
    const asksQuestion = /\?|comment|pourquoi|est-ce que|puis-je|combien|quel(le)?s?/i.test(clientMsg);
    if (asksQuestion && text.length < 80) {
      issues.push("réponse trop brève face à une question client");
    }
  }

  if (
    /formulaire en ligne|complétez le formulaire|déposez.{0,40}pdf.{0,40}formulaire/i.test(text) &&
    hasStudyBeenSent(dossier)
  ) {
    issues.push("renvoie au formulaire après étude envoyée");
  }

  return { unsafe: issues.length > 0, issues };
}

export function buildClientSafetyReviewQuestion(
  issues: string[],
  clientMessage: string,
): string {
  const excerpt = String(clientMessage || "").slice(0, 280);
  if (issues.length) {
    return `Le brouillon Camille présente des risques (${issues.join(" ; ")}). Comment répondre au client ? « ${excerpt} »`;
  }
  return `Valider ou corriger la réponse Camille pour : « ${excerpt} »`;
}
