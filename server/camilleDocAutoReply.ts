import { buildCamilleContextBlock } from "./camilleMail";
import { generateCamilleDocumentFollowUpEmail } from "./camilleDocumentFollowUp";
import {
  assessLoanDocFollowUpAssessment,
  shouldScheduleLoanDocFollowUp,
} from "./camilleClientMessage";
import { resolveLoanDocPresence } from "./loanDocPresence";
import { hasStudyBeenSent } from "./dossierLifecycle";
import { sendEmailReplyWithGmailAPI } from "./mailAutomation";
import { canCamilleEmailClient } from "./camilleClientEmailGuard";
import { addEvent } from "./dossierModel";

/** Escalade liée aux pièces de prêt → réponse client, pas alerte Rémi. */
export function isDocRelatedClientIssue(
  dossier: any,
  reason?: string,
  clientText?: string,
): boolean {
  if (hasStudyBeenSent(dossier)) return false;

  const blob = `${reason || ""} ${clientText || ""}`.toLowerCase();
  if (
    /m[eé]dical|juridique|menace|r[eé]clamation agressive|contentieux|avocat|tribunal|n[eé]gociation commerciale|montant d.[eé]conom|devis chiffr|€\s*\d|euros?\s*\d/i.test(
      blob,
    )
  ) {
    return false;
  }

  const loan = resolveLoanDocPresence(dossier);
  const ctx = buildCamilleContextBlock(dossier);
  if (!loan.exploitable) return true;
  if (ctx.certainDocProblems) return true;
  if ((ctx.uncertainDocSignals || []).length > 0) return true;
  if (/document|pi[eè]ce|offre|tableau|amortissement|pdf|envoy|reçu|banque|déjà envoy/i.test(blob)) {
    return true;
  }
  return false;
}

/**
 * Envoie un mail client de précision documents (OCR) au lieu d'escalader vers Rémi.
 */
export async function tryCamilleDocClarificationInsteadOfEscalation(
  dossier: any,
  options?: { clientMessage?: string; reason?: string },
): Promise<{ sent: boolean; html?: string; subject?: string; skipReason?: string }> {
  if (!isDocRelatedClientIssue(dossier, options?.reason, options?.clientMessage)) {
    return { sent: false, skipReason: "not_doc_related" };
  }

  const scheduleCheck = shouldScheduleLoanDocFollowUp(dossier);
  if (!scheduleCheck.allowed && scheduleCheck.reason === "docs_exploitable") {
    return { sent: false, skipReason: "docs_ok" };
  }

  const assessment = assessLoanDocFollowUpAssessment(dossier);
  const loan = resolveLoanDocPresence(dossier);
  if (
    !assessment.certain &&
    assessment.uncertainSignals.length === 0 &&
    loan.exploitable
  ) {
    return { sent: false, skipReason: "no_doc_issue" };
  }

  const gate = canCamilleEmailClient(dossier);
  if (!gate.ok) {
    return { sent: false, skipReason: gate.reason };
  }

  const clientEmail = String(dossier?.formData?.assures?.[0]?.email || "").trim();
  if (!clientEmail) return { sent: false, skipReason: "no_email" };

  const { subject, html } = await generateCamilleDocumentFollowUpEmail(dossier, assessment);
  const send = await sendEmailReplyWithGmailAPI(null, clientEmail, subject, html);

  if (!send?.ok) {
    return { sent: false, skipReason: send?.error || "send_failed" };
  }

  addEvent(dossier, {
    type: "EMAIL_SENT",
    actor: { kind: "AI", label: "Camille" },
    message: "Mail client envoyé (précision documents OCR) — pas d'escalade.",
    meta: {
      template: "CAMILLE_DOC_CLARIFY",
      to: clientEmail,
      subject,
      reason: options?.reason,
      problems: assessment.problems,
    },
  });

  return { sent: true, html, subject };
}
