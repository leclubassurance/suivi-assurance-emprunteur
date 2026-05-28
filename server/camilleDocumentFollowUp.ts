import { generateContentWithRetry } from "./geminiClient";
import { addEvent } from "./dossierModel";
import { readDB, writeDB } from "./db";
import { wrapCamilleHtmlReply } from "./camilleMail";
import { sendEmailReplyWithGmailAPI } from "./mailAutomation";
import {
  assessCertainLoanDocProblems,
  type LoanDocProblemAssessment,
} from "./loanDocCertainty";

export { assessCertainLoanDocProblems } from "./loanDocCertainty";

function isProactiveDocFollowUpEnabled() {
  const v = (process.env.AI_PROACTIVE_DOC_FOLLOWUP_ENABLED || "true").toLowerCase();
  return v !== "false" && v !== "0" && v !== "no";
}

function isAiAutoReplyEnabled() {
  const v = (process.env.AI_AUTO_REPLY_ENABLED || "true").toLowerCase();
  return v !== "false" && v !== "0" && v !== "no";
}

function problemsSummaryForPrompt(assessment: LoanDocProblemAssessment): string {
  return assessment.problems
    .map((p) => {
      if (p.kind === "image_not_pdf") return `${p.category}: fichier image (${p.fileName})`;
      if (p.kind === "screenshot_filename") return `${p.category}: nom de capture (${p.fileName})`;
      if (p.kind === "scan_pdf_no_text") return `${p.category}: PDF scan sans texte (${p.fileName})`;
      return `${p.category}: mauvais type de document (${p.fileName})`;
    })
    .join("\n");
}

function buildStaticFollowUpBody(prenom: string, dossierId: string, assessment: LoanDocProblemAssessment): string {
  const needOffer = assessment.problems.some((p) => p.category === "offre");
  const needTableau = assessment.problems.some((p) => p.category === "tableau");
  const lines = [
    `Merci pour l’envoi de votre dossier ${dossierId}.`,
    ``,
    `Pour que Charles puisse chiffrer précisément votre économie, il nous manque encore des documents exploitables :`,
  ];
  if (needOffer) lines.push(`- l’offre de prêt complète, en PDF téléchargé depuis votre espace bancaire (pas une photo ni une capture d’écran)`);
  if (needTableau)
    lines.push(
      `- le tableau d’amortissement / échéancier complet, en PDF depuis votre banque (toutes les échéances visibles)`,
    );
  lines.push(
    ``,
    `Dans votre application bancaire : rubrique « Crédit » ou « Prêt immobilier », puis « Documents » ou « Échéancier ».`,
    `Vous pouvez répondre à ce mail en joignant les PDFs, ou les redéposer via le formulaire si vous préférez.`,
    ``,
    `Merci pour votre aide — cela nous permet d’avancer rapidement.`,
  );
  return lines.join("\n");
}

export async function generateCamilleDocumentFollowUpEmail(
  dossier: any,
  assessment: LoanDocProblemAssessment,
): Promise<{ subject: string; html: string }> {
  const prenom = String(dossier?.formData?.assures?.[0]?.prenom || "").trim();
  const dossierId = String(dossier?.id || "");
  const subject = `Votre dossier ${dossierId} — documents à compléter`;

  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes("MY_GEMINI")) {
    return {
      subject,
      html: wrapCamilleHtmlReply(buildStaticFollowUpBody(prenom, dossierId, assessment), prenom),
    };
  }

  const prompt = `
Tu es Camille, assistante de Charles au Club Immobilier Français.
Le client vient de déposer son dossier. Nous avons détecté avec CERTITUDE un problème sur des documents clés (voir signaux).
Rédige un mail court (6 à 12 lignes), bienveillant, vouvoiement.

RÈGLES :
- Ne jamais dire "illisible", "mauvaise qualité", "document refusé".
- Demander l'offre de prêt et/ou le tableau d'amortissement complets en PDF depuis l'espace bancaire.
- Expliquer brièvement où les trouver (app bancaire / conseiller).
- Proposer de répondre à ce mail avec les PDF en pièce jointe.
- Pas de téléphone, pas de nom d'assureur.

JSON uniquement : { "messageToClient": "..." }
`;

  try {
    const response = await generateContentWithRetry({
      model: "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [{ text: prompt }] },
        {
          role: "user",
          parts: [
            {
              text: `Dossier: ${dossierId}\nPrénom client: ${prenom || "—"}\n\nProblèmes certains (interne):\n${problemsSummaryForPrompt(assessment)}`,
            },
          ],
        },
      ],
      config: { responseMimeType: "application/json", temperature: 0.4 },
    });
    const parsed = JSON.parse(response.text || "{}");
    const plain = String(parsed?.messageToClient || "").trim();
    if (plain) {
      return { subject, html: wrapCamilleHtmlReply(plain, prenom) };
    }
  } catch (e: any) {
    console.warn(`[Camille] Brouillon relance docs IA échoué: ${e?.message || String(e)}`);
  }

  return {
    subject,
    html: wrapCamilleHtmlReply(buildStaticFollowUpBody(prenom, dossierId, assessment), prenom),
  };
}

function dossierAlreadySentDocFollowUp(dossier: any): boolean {
  return (dossier?.eventLog || []).some(
    (e: any) =>
      e?.meta?.template === "CAMILLE_DOC_FOLLOWUP" &&
      (e?.type === "EMAIL_SENT" || e?.type === "AI_DECISION"),
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Après dépôt formulaire : relance Camille uniquement si problème documentaire certain.
 * Sinon log interne — traitement manuel par Rémi.
 */
export function scheduleCamilleDocumentFollowUpIfNeeded(dossier: any) {
  if (!isProactiveDocFollowUpEnabled() || !isAiAutoReplyEnabled()) return;

  const assessment = assessCertainLoanDocProblems(dossier);
  const toEmail = String(dossier?.formData?.assures?.[0]?.email || "").trim();
  if (!toEmail) return;

  if (!assessment.certain) {
    if (assessment.uncertainSignals.length) {
      addEvent(dossier, {
        type: "AI_DECISION",
        actor: { kind: "AI", label: "Camille" },
        message: "Relance documents non envoyée (signaux incertains — traitement manuel).",
        meta: {
          template: "CAMILLE_DOC_FOLLOWUP_SKIPPED",
          uncertainSignals: assessment.uncertainSignals,
        },
      });
    }
    return;
  }

  if (dossierAlreadySentDocFollowUp(dossier)) return;

  const dossierId = dossier.id;
  const delayMs = 120_000 + Math.floor(Math.random() * 120_000);

  addEvent(dossier, {
    type: "AI_DECISION",
    actor: { kind: "AI", label: "Camille" },
    message: `Relance documents programmée (problème certain, envoi dans ~${Math.round(delayMs / 60_000)} min).`,
    meta: {
      template: "CAMILLE_DOC_FOLLOWUP_SCHEDULED",
      problems: assessment.problems,
      delayMs,
    },
  });

  const timer = setTimeout(async () => {
    try {
      const db = await readDB();
      const existing = (db.dossiers || []).find((d: any) => d.id === dossierId);
      if (!existing) return;
      if (dossierAlreadySentDocFollowUp(existing)) return;

      const fresh = assessCertainLoanDocProblems(existing);
      if (!fresh.certain) {
        addEvent(existing, {
          type: "AI_DECISION",
          actor: { kind: "AI", label: "Camille" },
          message: "Relance documents annulée (plus de problème certain au moment de l'envoi).",
          meta: { template: "CAMILLE_DOC_FOLLOWUP_CANCELLED" },
        });
        existing.updatedAt = new Date().toISOString();
        await writeDB(db, existing);
        return;
      }

      const clientEmail = String(existing?.formData?.assures?.[0]?.email || "").trim();
      if (!clientEmail) return;

      const ccEmails = Array.isArray(existing.formData?.assures)
        ? existing.formData.assures
            .map((a: any) => String(a?.email || "").trim().toLowerCase())
            .filter((e: string) => e && e !== clientEmail.toLowerCase())
        : [];

      const { subject, html } = await generateCamilleDocumentFollowUpEmail(existing, fresh);
      const sendResult = await sendEmailReplyWithGmailAPI(null, clientEmail, subject, html, { cc: ccEmails });

      if (sendResult?.ok) {
        addEvent(existing, {
          type: "EMAIL_SENT",
          actor: { kind: "AI", label: "Camille" },
          message: "Relance documents envoyée au client (problème certain).",
          meta: {
            template: "CAMILLE_DOC_FOLLOWUP",
            to: clientEmail,
            cc: ccEmails.join(", "),
            subject,
            problems: fresh.problems,
          },
        });
        console.log(`[Camille] Relance documents envoyée à ${clientEmail} (${dossierId})`);
        void import("./telegramNotify")
          .then(({ notifyRemiDossierNews }) =>
            notifyRemiDossierNews(existing, "doc_followup", {
              subject,
              eventId: `doc_followup_${dossierId}`,
            }),
          )
          .catch(() => undefined);
        void import("./aiAuditLog")
          .then(({ logAiAudit }) =>
            logAiAudit(existing, {
              action: "DOC_FOLLOWUP",
              channel: "email",
              actor: "Camille",
              outcome: "sent",
              model: "gemini-2.5-flash",
              summary: "Relance documents (problème certain).",
              meta: { to: clientEmail, subject },
            }),
          )
          .catch(() => undefined);
      } else {
        addEvent(existing, {
          type: "EMAIL_FAILED",
          actor: { kind: "AI", label: "Camille" },
          message: "Échec relance documents au client.",
          meta: {
            template: "CAMILLE_DOC_FOLLOWUP",
            to: clientEmail,
            error: sendResult?.error || "unknown",
          },
        });
      }
      existing.updatedAt = new Date().toISOString();
      await writeDB(db, existing);
    } catch (err: any) {
      console.error(`[Camille] Erreur relance documents ${dossierId}: ${err?.message || String(err)}`);
    }
  }, delayMs);

  if (typeof timer.unref === "function") timer.unref();
}
