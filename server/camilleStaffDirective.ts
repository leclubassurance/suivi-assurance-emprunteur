import { addEvent, type Dossier } from "./dossierModel";
import { buildCamilleContextBlock, wrapCamilleHtmlReply } from "./camilleMail";
import { generateContentWithRetry } from "./geminiClient";
import { acknowledgeStaffOutboundToClient } from "./camilleStaffHandoff";

export type StaffDirectiveResult = {
  ok: boolean;
  action: "SEND_TO_CLIENT" | "NO_EMAIL" | "FAILED";
  summary: string;
  error?: string;
};

const DIRECTIVE_PROMPT = `
Tu es Camille (Le Club Immobilier Français). Un conseiller interne (Rémi/Charles) t'envoie une CONSIGNE en français pour ce dossier.
Tu dois produire le mail à envoyer au client, ou indiquer qu'aucun mail n'est nécessaire.

Règles mail client:
- Vouvoiement, 5 à 14 lignes, bienveillant, professionnel.
- Ne jamais nommer d'assureur ni de téléphone.
- Ne jamais dire "document illisible/mauvais".
- Si la consigne demande de demander des PDF banque: offre de prêt + tableau d'amortissement complets.
- Si la consigne dit que le conseiller gère ou "ne pas envoyer": action NO_EMAIL.

JSON uniquement:
{
  "action": "SEND_TO_CLIENT" | "NO_EMAIL",
  "messageToClient": "texte plain sans signature ou null si NO_EMAIL",
  "telegramSummary": "1 phrase pour confirmer à l'équipe ce qui a été fait"
}
`;

export async function executeCamilleStaffDirective(
  dossier: Dossier,
  instruction: string,
  options?: { channel?: string },
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

  try {
    const response = await generateContentWithRetry({
      model: "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [{ text: DIRECTIVE_PROMPT }] },
        {
          role: "user",
          parts: [
            {
              text: `Dossier: ${dossier.id}
Client: ${prenom} <${clientEmail}>
Canal consigne: ${options?.channel || "telegram"}

Contexte pièces:
${ctx.documentSummary}
certainDocProblems: ${ctx.certainDocProblems}
staffActivelyHandling: ${Boolean(dossier.camilleStaffHandledUntil)}

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
      acknowledgeStaffOutboundToClient(dossier, { source: options?.channel || "staff_directive" });
      addEvent(dossier, {
        type: "AI_DECISION",
        actor: { kind: "ADMIN", label: "Rémi (Telegram)" },
        message: `Consigne sans envoi client: ${text.slice(0, 120)}`,
        meta: { channel: options?.channel },
      });
      return { ok: true, action: "NO_EMAIL", summary };
    }

    const plain = String(decision.messageToClient || "").trim();
    if (!plain) {
      return { ok: false, action: "FAILED", summary: "Brouillon client vide.", error: "empty_body" };
    }

    const subject = `Votre dossier ${dossier.id} — Le Club Immobilier Français`;
    const html = wrapCamilleHtmlReply(plain, prenom);
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

    acknowledgeStaffOutboundToClient(dossier, { source: options?.channel || "staff_directive" });
    addEvent(dossier, {
      type: "EMAIL_SENT",
      actor: { kind: "AI", label: "Camille" },
      message: "Mail client envoyé suite à consigne équipe (Telegram).",
      meta: { channel: options?.channel, instructionPreview: text.slice(0, 200), to: clientEmail },
    });

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
