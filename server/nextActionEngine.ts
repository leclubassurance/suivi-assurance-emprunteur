import { Dossier, addEvent } from "./dossierModel";
import { detectMissingDocs, getPrimaryClientEmail, isDossierStale } from "./rules";
import { templateMissingDocsFollowup, templateGenericFollowup } from "./emailTemplates";

export type NextAction =
  | {
      kind: "SEND_EMAIL";
      template: string;
      to: string;
      subject: string;
      html: string;
      auto: boolean;
      reason: string;
    }
  | {
      kind: "ALERT";
      title: string;
      detail: string;
      severity: "info" | "warning" | "critical";
      auto: boolean;
      reason: string;
    }
  | {
      kind: "NO_ACTION";
      reason: string;
    };

export function proposeNextActions(dossier: Dossier): NextAction[] {
  const actions: NextAction[] = [];
  const to = getPrimaryClientEmail(dossier);
  if (!to) {
    actions.push({ kind: "ALERT", title: "Email client manquant", detail: "Impossible d'envoyer des relances sans email.", severity: "critical", auto: false, reason: "No primary email." });
    return actions;
  }

  const missing = detectMissingDocs(dossier);
  if (missing.length > 0 && isDossierStale(dossier, 7)) {
    actions.push({
      kind: "SEND_EMAIL",
      template: "FOLLOWUP_MISSING_DOCS",
      to,
      subject: `Documents manquants — Dossier ${dossier.id}`,
      html: templateMissingDocsFollowup(dossier, missing),
      auto: true,
      reason: "Pièces bloquantes manquantes + dossier inactif >7j.",
    });
  }

  if (missing.length === 0 && dossier.status === "EN_ATTENTE_CLIENT" && isDossierStale(dossier, 10)) {
    actions.push({
      kind: "SEND_EMAIL",
      template: "FOLLOWUP_NO_REPLY",
      to,
      subject: `Relance — Dossier ${dossier.id}`,
      html: templateGenericFollowup(dossier, "Nous revenons vers vous pour savoir si vous avez pu avancer sur votre dossier. Vous pouvez répondre directement à ce mail."),
      auto: false,
      reason: "Attente client >10j (mode assisté).",
    });
  }

  if (actions.length === 0) {
    actions.push({ kind: "NO_ACTION", reason: "Aucune relance/alerte nécessaire." });
  }
  return actions;
}

export function auditAiDecision(dossier: Dossier, actions: NextAction[]) {
  addEvent(dossier, {
    type: "AI_DECISION",
    actor: { kind: "AI", label: "NextActionEngine" },
    meta: { proposedActions: actions },
    message: "Proposition d’actions générée.",
  });
}

