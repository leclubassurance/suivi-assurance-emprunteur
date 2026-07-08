import type { Dossier } from "./dossierModel";
import { buildCamilleContextBlock } from "./camilleMail";
import { escapeTelegramHtml } from "./telegramUi";
import type { CamilleAnalyzeResult, CamillePlanResult } from "./camilleReasoningPipeline";

export type CamilleActionKind =
  | "autonomous_reply"
  | "playbook"
  | "routine_procedure"
  | "template_identity"
  | "template_complementary_docs"
  | "staff_directive"
  | "doc_followup"
  | "doc_clarify"
  | "cooldown_ack"
  | "multi_dossier_clarification";

export type InterventionLevel = "none" | "watch" | "required";

export type CamilleTelegramActionDetails = {
  interventionLevel: InterventionLevel;
  actionKind: CamilleActionKind;
  clientMessageExcerpt?: string;
  replyPlainExcerpt?: string;
  emailSubject?: string;
  subscriptionPhaseLabel?: string;
  studySent?: boolean;
  clientAccepted?: boolean;
  loanDocsOk?: boolean;
  primaryTopic?: string;
  clientIntent?: string;
  confidence?: number;
  riskFlags?: string[];
  planReasoning?: string;
  playbookId?: string;
  staffInstruction?: string;
  blockedDocRequest?: boolean;
  attachmentNames?: string[];
  reason?: string;
};

const ACTION_LABEL: Record<CamilleActionKind, string> = {
  autonomous_reply: "Réponse autonome (IA Phase 3)",
  playbook: "Réponse playbook validé",
  routine_procedure: "Procédure document (réponse directe)",
  template_identity: "Accusé réception CNI/RIB",
  template_complementary_docs: "Accusé pièces complémentaires post-étude",
  staff_directive: "Mail client suite à votre consigne",
  doc_followup: "Relance documents au client",
  doc_clarify: "Précision documents (évite escalade)",
  cooldown_ack: "Accusé de réception (cooldown actif)",
  multi_dossier_clarification: "Demande de précision LCIF (multi-dossiers)",
};

const TOPIC_LABEL: Record<string, string> = {
  documents: "Documents prêt",
  kereis: "Espace adhérent Kereis",
  substitution: "Substitution / accord client",
  etude: "Étude / économies",
  remerciement: "Remerciement",
  reclamation: "Réclamation",
  question_generale: "Question générale",
  autre: "Autre",
};

export function stripHtmlForTelegram(html: string): string {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function assessInterventionLevel(params: {
  actionKind: CamilleActionKind;
  riskFlags?: string[];
  confidence?: number;
  critiqueApproved?: boolean;
  primaryTopic?: string;
  clientAccepted?: boolean;
  studySent?: boolean;
  blockedDocRequest?: boolean;
}): InterventionLevel {
  if (params.actionKind === "staff_directive" || params.actionKind === "cooldown_ack") {
    return "none";
  }
  if (
    params.actionKind === "doc_followup" ||
    params.actionKind === "doc_clarify" ||
    params.actionKind === "playbook"
  ) {
    return "watch";
  }
  if (params.actionKind === "routine_procedure") {
    return "none";
  }

  const risks = (params.riskFlags || []).map((r) => r.toLowerCase());
  if (risks.some((r) => /medical|juridique|menace|commercial|multi_contrat/.test(r) && r !== "aucun")) {
    return "watch";
  }
  if (params.primaryTopic === "reclamation") return "watch";
  const routineTopic =
    params.primaryTopic === "documents" ||
    params.primaryTopic === "question_generale" ||
    params.primaryTopic === "formulaire" ||
    params.primaryTopic === "remerciement";
  if (params.confidence !== undefined && params.confidence < 6 && !routineTopic) return "watch";
  if (params.critiqueApproved === false) return "watch";
  if (
    params.primaryTopic === "substitution" &&
    params.studySent &&
    !params.clientAccepted
  ) {
    return "watch";
  }
  if (params.blockedDocRequest) return "watch";
  return "none";
}

export function buildTelegramActionFromReply(params: {
  dossier: Dossier;
  clientMessage: string;
  replyPlain: string;
  emailSubject?: string;
  actionKind?: CamilleActionKind;
  attachmentNames?: string[];
  playbookId?: string;
  blockedDocRequest?: boolean;
  reason?: string;
  analyze?: CamilleAnalyzeResult;
  plan?: CamillePlanResult;
  critiqueApproved?: boolean;
}): CamilleTelegramActionDetails {
  const ctx = buildCamilleContextBlock(params.dossier, params.attachmentNames || []);
  const actionKind = params.actionKind || "autonomous_reply";

  return {
    interventionLevel: assessInterventionLevel({
      actionKind,
      riskFlags: params.analyze?.riskFlags,
      confidence: params.analyze?.confidence,
      critiqueApproved: params.critiqueApproved,
      primaryTopic: params.analyze?.primaryTopic,
      clientAccepted: ctx.clientAcceptedInsurance,
      studySent: ctx.studySent,
      blockedDocRequest: params.blockedDocRequest,
    }),
    actionKind,
    clientMessageExcerpt: params.clientMessage.slice(0, 450),
    replyPlainExcerpt: params.replyPlain.slice(0, 650),
    emailSubject: params.emailSubject,
    subscriptionPhaseLabel: ctx.subscriptionPhaseLabel || undefined,
    studySent: ctx.studySent,
    clientAccepted: ctx.clientAcceptedInsurance,
    loanDocsOk: ctx.loanDocsOk,
    primaryTopic: params.analyze?.primaryTopic,
    clientIntent: params.analyze?.clientIntent,
    confidence: params.analyze?.confidence,
    riskFlags: params.analyze?.riskFlags,
    planReasoning: params.plan?.reasoning,
    playbookId: params.playbookId,
    blockedDocRequest: params.blockedDocRequest,
    attachmentNames: params.attachmentNames,
    reason: params.reason,
  };
}

function interventionBanner(level: InterventionLevel): { icon: string; label: string; hint: string } {
  if (level === "required") {
    return {
      icon: "🔴",
      label: "INTERVENTION REQUISE",
      hint: "Répondez à ce message avec votre consigne — je rédige le mail client ensuite.",
    };
  }
  if (level === "watch") {
    return {
      icon: "⚠️",
      label: "À SURVEILLER",
      hint: "Pas d'action immédiate obligatoire — vérifiez le fil si le client ne répond pas ou conteste.",
    };
  }
  return {
    icon: "✅",
    label: "RIEN À FAIRE",
    hint: "Camille a géré seule — vous n'avez pas besoin d'intervenir sauf si le client vous relance directement.",
  };
}

function formatRiskFlags(flags?: string[]): string {
  const list = (flags || []).filter((f) => f && f.toLowerCase() !== "aucun");
  if (!list.length) return "aucun signal de risque";
  return list.join(", ");
}

/** Message Telegram structuré — action Camille (pas de Gemini, lisible d'un coup d'œil). */
export function formatCamilleActionTelegramHtml(
  dossier: Dossier,
  action: CamilleTelegramActionDetails,
): string {
  const a = dossier.formData?.assures?.[0];
  const clientName = [a?.prenom, a?.nom].filter(Boolean).join(" ") || "Client";
  const banner = interventionBanner(action.interventionLevel);

  const phaseLine = [
    action.subscriptionPhaseLabel ? `Phase : ${action.subscriptionPhaseLabel}` : "",
    action.studySent !== undefined ? `Étude envoyée : ${action.studySent ? "oui" : "non"}` : "",
    action.clientAccepted !== undefined
      ? `Accord client : ${action.clientAccepted ? "oui" : "non"}`
      : "",
    action.loanDocsOk !== undefined ? `Offre+tableau OK : ${action.loanDocsOk ? "oui" : "non"}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const lines: string[] = [
    `<b>${banner.icon} ${banner.label}</b>`,
    `<b>${escapeTelegramHtml(dossier.id)}</b> — ${escapeTelegramHtml(clientName)}`,
    `<i>${escapeTelegramHtml(ACTION_LABEL[action.actionKind] || action.actionKind)}</i>`,
  ];

  if (phaseLine) lines.push(`<i>${escapeTelegramHtml(phaseLine)}</i>`);
  if (action.emailSubject) {
    lines.push(`<b>Sujet</b> : ${escapeTelegramHtml(action.emailSubject.slice(0, 100))}`);
  }

  lines.push("");

  if (action.clientMessageExcerpt) {
    lines.push(`<b>📩 Client a écrit</b>`);
    lines.push(`<i>« ${escapeTelegramHtml(action.clientMessageExcerpt)} »</i>`);
    lines.push("");
  }

  if (action.replyPlainExcerpt) {
    lines.push(`<b>✉️ Camille a répondu</b>`);
    lines.push(`<i>« ${escapeTelegramHtml(action.replyPlainExcerpt)} »</i>`);
    lines.push("");
  }

  if (action.staffInstruction) {
    lines.push(`<b>📝 Votre consigne</b> : ${escapeTelegramHtml(action.staffInstruction.slice(0, 300))}`);
    lines.push("");
  }

  const analysisBits: string[] = [];
  if (action.primaryTopic) {
    analysisBits.push(
      `Sujet : ${TOPIC_LABEL[action.primaryTopic] || action.primaryTopic}`,
    );
  }
  if (action.confidence !== undefined) {
    analysisBits.push(`Confiance : ${action.confidence}/10`);
  }
  if (action.clientIntent) {
    analysisBits.push(`Intention : ${action.clientIntent.slice(0, 120)}`);
  }
  if (analysisBits.length) {
    lines.push(`<b>🎯 Analyse</b>`);
    lines.push(`• ${escapeTelegramHtml(analysisBits.join(" · "))}`);
    lines.push(`• Risques : ${escapeTelegramHtml(formatRiskFlags(action.riskFlags))}`);
    if (action.planReasoning) {
      lines.push(`• Plan : ${escapeTelegramHtml(action.planReasoning.slice(0, 200))}`);
    }
    lines.push("");
  }

  if (action.playbookId) {
    lines.push(`<b>📚 Playbook</b> : <code>${escapeTelegramHtml(action.playbookId)}</code>`);
    lines.push("");
  }

  if (action.attachmentNames?.length) {
    lines.push(
      `<b>📎 PJ reçues</b> : ${escapeTelegramHtml(action.attachmentNames.slice(0, 6).join(", "))}`,
    );
    lines.push("");
  }

  if (action.blockedDocRequest) {
    lines.push(`<i>⚙️ Demande de pièce prêt bloquée (déjà présentes côté analyse).</i>`);
    lines.push("");
  }

  if (action.reason) {
    lines.push(`<b>ℹ️ Contexte</b> : <i>${escapeTelegramHtml(action.reason.slice(0, 250))}</i>`);
    lines.push("");
  }

  lines.push(`<b>➡️ Pour vous</b> : <i>${escapeTelegramHtml(banner.hint)}</i>`);

  if (action.interventionLevel === "none") {
    lines.push(`<i>Répondez ici si vous voulez ajuster ou poser une question sur ce dossier.</i>`);
  }

  const body = lines.join("\n");
  return body.length > 3900 ? `${body.slice(0, 3880)}…` : body;
}

/** En-tête enrichi pour les questions REVIEW (intervention requise). */
export function formatReviewQuestionTelegramHtml(params: {
  dossier: Dossier;
  clientExcerpt: string;
  questionForStaff: string;
  reason?: string;
  emailSubject?: string;
  attachmentNames?: string[];
}): string {
  const ctx = buildCamilleContextBlock(params.dossier, params.attachmentNames || []);
  const a = params.dossier.formData?.assures?.[0];
  const name = [a?.prenom, a?.nom].filter(Boolean).join(" ") || "Client";

  const phaseLine = [
    ctx.subscriptionPhaseLabel ? `Phase : ${ctx.subscriptionPhaseLabel}` : "",
    ctx.studySent ? "Étude : oui" : "Étude : non",
    ctx.clientAcceptedInsurance ? "Accord : oui" : "Accord : non",
    ctx.loanDocsOk ? "Docs prêt OK" : "Docs prêt incomplets",
  ]
    .filter(Boolean)
    .join(" · ");

  return [
    `<b>🔴 INTERVENTION REQUISE — je n'ai pas envoyé de mail client</b>`,
    `<b>${escapeTelegramHtml(params.dossier.id)}</b> — ${escapeTelegramHtml(name)}`,
    phaseLine ? `<i>${escapeTelegramHtml(phaseLine)}</i>` : "",
    params.emailSubject ? `<b>Sujet</b> : ${escapeTelegramHtml(params.emailSubject.slice(0, 100))}` : "",
    ``,
    `<b>📩 Mail client</b>`,
    `<i>« ${escapeTelegramHtml(params.clientExcerpt.slice(0, 450))} »</i>`,
    params.reason ? `\n<i>Pourquoi je bloque : ${escapeTelegramHtml(params.reason.slice(0, 250))}</i>` : "",
  params.attachmentNames?.length
      ? `\n<b>📎 PJ</b> : ${escapeTelegramHtml(params.attachmentNames.join(", "))}`
      : "",
    ``,
    `<b>❓ Répondez à CE message</b> (je rédige un brouillon, vous validez avant envoi) :`,
    escapeTelegramHtml(params.questionForStaff),
    ``,
    `<i>Ex. : « Confirme que Charles rappelle demain » ou « Demande les PDF banque uniquement »</i>`,
  ]
    .filter((l) => l !== "")
    .join("\n");
}
