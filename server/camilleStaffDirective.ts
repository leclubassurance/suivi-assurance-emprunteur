import { addEvent, type Dossier } from "./dossierModel";
import { buildCamilleContextBlock, wrapCamilleHtmlReply } from "./camilleMail";
import { sanitizeCamilleClientMessage } from "./camilleClientMessage";
import { generateContentWithRetry } from "./geminiClient";
import { acknowledgeStaffOutboundToClient, resumeCamilleForDossier } from "./camilleStaffHandoff";
import { logAiAudit } from "./aiAuditLog";
import { buildCamilleKnowledgePromptBlock } from "./camilleKnowledgeDrive";

export type StaffDirectiveResult = {
  ok: boolean;
  action: "SEND_TO_CLIENT" | "NO_EMAIL" | "FAILED";
  summary: string;
  error?: string;
};

function buildDirectivePrompt(options?: {
  staffAuthorizesInsurerName?: boolean;
}) {
  const insurerRule = options?.staffAuthorizesInsurerName
    ? `- Ne nommer un assureur / compagnie QUE si la consigne équipe l'autorise explicitement — alors s'appuyer UNIQUEMENT sur le bloc « Connaissance dossier » (devis PDF), sans inventer.`
    : `- Ne jamais nommer d'assureur ni de téléphone.`;

  return `
Tu es Camille (Le Club Immobilier Français). Un conseiller interne (Rémi/Charles) t'envoie une CONSIGNE en français pour ce dossier.
Tu dois produire le mail à envoyer au client, ou indiquer qu'aucun mail n'est nécessaire.

Règles mail client:
- Vouvoiement, 5 à 14 lignes, bienveillant, professionnel.
${insurerRule}
- Ne jamais dire "document illisible/mauvais".
- Si la consigne demande de demander des PDF banque: uniquement si offre/tableau pas déjà présents (voir contexte).
- NE JAMAIS demander CNI/RIB tant que le client n'a pas confirmé vouloir activer le changement d'assurance (clientAcceptedInsurance dans le contexte).
- Après envoi de l'étude SANS accord client : relances possibles sur la réception de l'étude ou les questions — jamais CNI/RIB.
- CNI/RIB uniquement si clientAcceptedInsurance=true ET consigne équipe ou pièces manquantes pour souscription.
- S'appuyer sur documentAnalysisReport pour les demandes de pièces.
- Pas de formule d'accueil dans messageToClient (Bonjour, Madame…) — ajoutée automatiquement.
- Si la consigne dit que le conseiller gère ou "ne pas envoyer": action NO_EMAIL.

JSON uniquement:
{
  "action": "SEND_TO_CLIENT" | "NO_EMAIL",
  "messageToClient": "texte plain sans signature ou null si NO_EMAIL",
  "telegramSummary": "1 phrase pour confirmer à l'équipe ce qui a été fait"
}
`;
}

export async function executeCamilleStaffDirective(
  dossier: Dossier,
  instruction: string,
  options?: {
    channel?: string;
    dossierKnowledge?: string;
    staffAuthorizesInsurerName?: boolean;
  },
): Promise<StaffDirectiveResult> {
  const text = String(instruction || "").trim();
  if (!text) {
    return { ok: false, action: "FAILED", summary: "Consigne vide.", error: "empty" };
  }

  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes("MY_GEMINI")) {
    return { ok: false, action: "FAILED", summary: "GEMINI_API_KEY manquante.", error: "no_gemini" };
  }

  const prenom = String(dossier.formData?.assures?.[0]?.prenom || "").trim();
  const clientEmail = String(dossier.formData?.assures?.[0]?.email || "").trim();
  if (!clientEmail) {
    return { ok: false, action: "FAILED", summary: "Email client introuvable.", error: "no_client_email" };
  }

  const ctx = buildCamilleContextBlock(dossier, []);
  const knowledgeBlock = await buildCamilleKnowledgePromptBlock(null, undefined, {
    clientMessage: text,
    subscriptionPhase: ctx.subscriptionPhase,
    studySent: ctx.studySent,
  });
  const isEscalationEmail = options?.channel === "escalation_email";
  const directivePrompt = buildDirectivePrompt({
    staffAuthorizesInsurerName: options?.staffAuthorizesInsurerName,
  });

  try {
    const response = await generateContentWithRetry({
      model: "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [{ text: directivePrompt }] },
        { role: "user", parts: [{ text: knowledgeBlock }] },
        {
          role: "user",
          parts: [
            {
              text: `Dossier: ${dossier.id}
Client: ${prenom} <${clientEmail}>
Canal consigne: ${options?.channel || "telegram"}

${ctx.dossierSituationBlock}

Contexte pièces:
${ctx.documentSummary}

Analyse OCR:
${ctx.documentAnalysisReport || "—"}

certainDocProblems: ${ctx.certainDocProblems}
loanDocsOk: ${ctx.loanDocsOk}
studySent: ${Boolean(ctx.studySent)}
clientAcceptedInsurance: ${Boolean(ctx.clientAcceptedInsurance)}
identityDocsMayBeRequested: ${Boolean(ctx.identityDocsMayBeRequested)}
staffActivelyHandling: ${Boolean(dossier.camilleStaffHandledUntil)}

Connaissance dossier (devis, étude, question client — source de vérité si la consigne autorise une réponse factuelle):
${options?.dossierKnowledge || "—"}

Consigne équipe:
"""
${text.slice(0, 4000)}
"""`,
            },
          ],
        },
      ],
      config: { responseMimeType: "application/json", temperature: 0.35 },
    });

    let decision: any = {};
    try {
      decision = JSON.parse(response.text || "{}");
    } catch {
      return { ok: false, action: "FAILED", summary: "Réponse IA invalide.", error: "json" };
    }

    const action = decision.action === "NO_EMAIL" ? "NO_EMAIL" : "SEND_TO_CLIENT";
    const summary = String(decision.telegramSummary || "").trim() || "Consigne traitée.";

    if (action === "NO_EMAIL") {
      if (!isEscalationEmail) {
        acknowledgeStaffOutboundToClient(dossier, { source: options?.channel || "staff_directive" });
      } else {
        resumeCamilleForDossier(dossier, "escalation_email_no_send");
      }
      addEvent(dossier, {
        type: "AI_DECISION",
        actor: { kind: "ADMIN", label: isEscalationEmail ? "Rémi (email)" : "Rémi (Telegram)" },
        message: `Consigne sans envoi client: ${text.slice(0, 120)}`,
        meta: { channel: options?.channel },
      });
      logAiAudit(dossier, {
        action: "STAFF_DIRECTIVE",
        channel: options?.channel || "telegram",
        actor: "Camille",
        outcome: "no_email",
        model: "gemini-2.5-flash",
        summary,
        instructionPreview: text.slice(0, 300),
      });
      return { ok: true, action: "NO_EMAIL", summary };
    }

    const plain = String(decision.messageToClient || "").trim();
    if (!plain) {
      return { ok: false, action: "FAILED", summary: "Brouillon client vide.", error: "empty_body" };
    }

    const nom = String(dossier.formData?.assures?.[0]?.nom || "").trim();
    const { text: clientMessage } = sanitizeCamilleClientMessage(plain, dossier);
    const subject = `Votre dossier ${dossier.id} — Le Club Immobilier Français`;
    const html = wrapCamilleHtmlReply(clientMessage, prenom, nom, dossier);
    const { sendEmailReplyWithGmailAPI } = await import("./mailAutomation");
    const send = await sendEmailReplyWithGmailAPI(null, clientEmail, subject, html);

    if (!send?.ok) {
      return {
        ok: false,
        action: "FAILED",
        summary: `Échec envoi Gmail: ${send?.error || "?"}`,
        error: send?.error,
      };
    }

    if (!isEscalationEmail) {
      acknowledgeStaffOutboundToClient(dossier, { source: options?.channel || "staff_directive" });
    } else {
      resumeCamilleForDossier(dossier, "escalation_email_sent");
    }
    addEvent(dossier, {
      type: "EMAIL_SENT",
      actor: { kind: "AI", label: "Camille" },
      message: isEscalationEmail
        ? "Mail client envoyé suite à consigne équipe (réponse escalade email)."
        : "Mail client envoyé suite à consigne équipe (Telegram).",
      meta: { channel: options?.channel, instructionPreview: text.slice(0, 200), to: clientEmail },
    });

    logAiAudit(dossier, {
      action: "STAFF_DIRECTIVE",
      channel: options?.channel || "telegram",
      actor: "Camille",
      outcome: "sent",
      model: "gemini-2.5-flash",
      summary,
      instructionPreview: text.slice(0, 300),
      meta: { to: clientEmail, subject },
    });

    void import("./telegramNotify")
      .then(({ notifyTelegramCamilleReplied }) =>
        notifyTelegramCamilleReplied({
          dossier,
          subject,
          gmailId: `staff_directive_${Date.now()}`,
          extra: isEscalationEmail
            ? "Suite à votre réponse sur l'email d'escalade."
            : "Suite à votre consigne Telegram.",
        }),
      )
      .catch(() => undefined);

    return { ok: true, action: "SEND_TO_CLIENT", summary };
  } catch (e: any) {
    return {
      ok: false,
      action: "FAILED",
      summary: e?.message || String(e),
      error: "exception",
    };
  }
}
