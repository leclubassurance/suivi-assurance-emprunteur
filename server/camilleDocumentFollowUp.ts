import { generateContentWithRetry } from "./geminiClient";
import { addEvent } from "./dossierModel";
import { readDB, writeDB } from "./db";
import { wrapCamilleHtmlReply } from "./camilleMail";
import { sendEmailReplyWithGmailAPI } from "./mailAutomation";
import {
  assessCertainLoanDocProblems,
  type LoanDocProblemAssessment,
} from "./loanDocCertainty";
import { buildCamilleContextBlock } from "./camilleMail";
import { resolveLoanDocPresence } from "./loanDocPresence";
import {
  assessLoanDocFollowUpAssessment,
  sanitizeCamilleClientMessage,
  shouldScheduleLoanDocFollowUp,
} from "./camilleClientMessage";
import {
  acquireCamilleClientEmailLock,
  canCamilleEmailClient,
  registerScheduledDocFollowUp,
  releaseCamilleClientEmailLock,
} from "./camilleClientEmailGuard";

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

function buildStaticFollowUpBody(
  dossierId: string,
  assessment: LoanDocProblemAssessment,
  loan: ReturnType<typeof resolveLoanDocPresence>,
): string {
  const needOffer = assessment.problems.some((p) => p.category === "offre");
  const needTableau = assessment.problems.some((p) => p.category === "tableau");
  const lines = loan.filesPresent
    ? [
        `Merci pour l’envoi de votre dossier ${dossierId}.`,
        ``,
        `Nous avons bien reçu vos documents de prêt. Pour que Charles puisse finaliser votre étude, il nous faut des versions exploitables :`,
      ]
    : [
        `Merci pour l’envoi de votre dossier ${dossierId}.`,
        ``,
        `Pour que Charles puisse chiffrer précisément votre économie, il nous manque encore :`,
      ];
  if (needOffer && !loan.offrePresent) {
    lines.push(
      `- l’offre de prêt complète, en PDF téléchargé depuis votre espace bancaire (pas une photo ni une capture d’écran)`,
    );
  } else if (needOffer && loan.offrePresent) {
    lines.push(
      `- l’offre de prêt en PDF complet depuis votre espace bancaire (remplacez la version reçue si c’était une photo ou une capture)`,
    );
  }
  if (needTableau && !loan.amortPresent) {
    lines.push(
      `- le tableau d’amortissement / échéancier complet, en PDF depuis votre banque (toutes les échéances visibles)`,
    );
  } else if (needTableau && loan.amortPresent) {
    lines.push(
      `- le tableau d’amortissement / échéancier complet en PDF depuis votre banque (toutes les échéances visibles)`,
    );
  }
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
  const assure = dossier?.formData?.assures?.[0];
  const prenom = String(assure?.prenom || "").trim();
  const nom = String(assure?.nom || "").trim();
  const dossierId = String(dossier?.id || "");
  const loan = resolveLoanDocPresence(dossier);
  const subject = loan.filesPresent
    ? `Votre dossier ${dossierId} — documents à préciser`
    : `Votre dossier ${dossierId} — documents à compléter`;

  const wrap = (body: string) => wrapCamilleHtmlReply(body, prenom, nom, dossier);

  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes("MY_GEMINI")) {
    return {
      subject,
      html: wrap(buildStaticFollowUpBody(dossierId, assessment, loan)),
    };
  }

  const prompt = `
Tu es Camille, assistante de Charles au Club Immobilier Français.
Rédige un mail court (6 à 12 lignes), bienveillant, vouvoiement.

RÈGLES :
- NE PAS inclure de formule d'accueil (pas de Bonjour, pas de Madame/Monsieur) — ajoutée automatiquement.
- Ne jamais dire "illisible", "mauvaise qualité", "document refusé".
- Si offre ET tableau sont déjà présents : dire que nous les avons reçus et demander uniquement un renvoi en PDF banque complets (pas photo/capture), sans dire qu'ils "manquent".
- Si un seul manque : ne demander que celui qui manque.
- Expliquer brièvement où les trouver (app bancaire / conseiller).
- Proposer de répondre à ce mail avec les PDF en pièce jointe.
- Pas de téléphone, pas de nom d'assureur.
- NE JAMAIS demander CNI, passeport ou RIB tant que le client n'a pas confirmé vouloir activer le changement d'assurance (pas seulement après l'étude).
- S'appuyer sur l'analyse OCR ci-dessous pour dire précisément ce qui manque ou doit être renvoyé en PDF banque.

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
              text: `Dossier: ${dossierId}
Offre de prêt déjà reçue: ${loan.offrePresent ? "OUI" : "NON"}
Tableau d'amortissement déjà reçu: ${loan.amortPresent ? "OUI" : "NON"}
Les deux présents: ${loan.filesPresent ? "OUI" : "NON"}
Exploitables pour l'étude: ${loan.exploitable ? "OUI" : "NON"}

Analyse OCR (à traduire pour le client, sans dire « illisible »):
${buildCamilleContextBlock(dossier).documentAnalysisReport || "—"}

Problèmes détectés (interne):
${problemsSummaryForPrompt(assessment)}
${assessment.uncertainSignals.length ? `\nSignaux: ${assessment.uncertainSignals.join("; ")}` : ""}`,
            },
          ],
        },
      ],
      config: { responseMimeType: "application/json", temperature: 0.4 },
    });
    const parsed = JSON.parse(response.text || "{}");
    const raw = String(parsed?.messageToClient || "").trim();
    if (raw) {
      const { text } = sanitizeCamilleClientMessage(raw, dossier);
      return { subject, html: wrap(text) };
    }
  } catch (e: any) {
    console.warn(`[Camille] Brouillon relance docs IA échoué: ${e?.message || String(e)}`);
  }

  return {
    subject,
    html: wrap(buildStaticFollowUpBody(dossierId, assessment, loan)),
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

  const scheduleCheck = shouldScheduleLoanDocFollowUp(dossier);
  if (!scheduleCheck.allowed) {
    if (
      scheduleCheck.reason === "docs_present_ok" ||
      scheduleCheck.reason === "docs_exploitable"
    ) {
      addEvent(dossier, {
        type: "AI_DECISION",
        actor: { kind: "AI", label: "Camille" },
        message: "Relance documents non envoyée (offre + tableau déjà présents et exploitables).",
        meta: { template: "CAMILLE_DOC_FOLLOWUP_SKIPPED", reason: scheduleCheck.reason },
      });
    }
    return;
  }

  const assessment = assessLoanDocFollowUpAssessment(dossier);
  const toEmail = String(dossier?.formData?.assures?.[0]?.email || "").trim();
  if (!toEmail) return;

  if (!assessment.certain && assessment.uncertainSignals.length === 0) {
    return;
  }

  if (dossierAlreadySentDocFollowUp(dossier)) return;

  const sendGate = canCamilleEmailClient(dossier);
  if (!sendGate.ok) {
    addEvent(dossier, {
      type: "AI_DECISION",
      actor: { kind: "AI", label: "Camille" },
      message: `Relance documents non programmée (${sendGate.reason}).`,
      meta: { template: "CAMILLE_DOC_FOLLOWUP_SKIPPED", reason: sendGate.reason },
    });
    return;
  }

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
    if (!(await acquireCamilleClientEmailLock(dossierId))) return;
    try {
      const db = await readDB();
      const existing = (db.dossiers || []).find((d: any) => d.id === dossierId);
      if (!existing) return;
      if (dossierAlreadySentDocFollowUp(existing)) return;

      const gate = canCamilleEmailClient(existing);
      if (!gate.ok) {
        addEvent(existing, {
          type: "AI_DECISION",
          actor: { kind: "AI", label: "Camille" },
          message: `Relance documents annulée (${gate.reason}).`,
          meta: { template: "CAMILLE_DOC_FOLLOWUP_CANCELLED", reason: gate.reason },
        });
        existing.updatedAt = new Date().toISOString();
        await writeDB(db, existing);
        return;
      }

      const sendCheck = shouldScheduleLoanDocFollowUp(existing);
      if (!sendCheck.allowed) {
        addEvent(existing, {
          type: "AI_DECISION",
          actor: { kind: "AI", label: "Camille" },
          message: "Relance documents annulée (documents déjà présents ou exploitables).",
          meta: { template: "CAMILLE_DOC_FOLLOWUP_CANCELLED", reason: sendCheck.reason },
        });
        existing.updatedAt = new Date().toISOString();
        await writeDB(db, existing);
        return;
      }

      const fresh = assessLoanDocFollowUpAssessment(existing);
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
      const sendResult = await sendEmailReplyWithGmailAPI(null, clientEmail, subject, html, {
        cc: ccEmails,
        dossier: existing,
      });

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
          .then(async ({ notifyRemiDossierNews }) => {
            const { buildTelegramActionFromReply, stripHtmlForTelegram } = await import(
              "./camilleTelegramActionNotify"
            );
            const replyPlain = stripHtmlForTelegram(html);
            const camilleAction = buildTelegramActionFromReply({
              dossier: existing,
              clientMessage: "(relance proactive — problème document détecté)",
              replyPlain,
              emailSubject: subject,
              actionKind: "doc_followup",
            });
            camilleAction.reason = fresh.problems.map((p) => p.kind).join(", ");
            await notifyRemiDossierNews(existing, "doc_followup", {
              subject,
              eventId: `doc_followup_${dossierId}`,
              camilleAction,
            });
          })
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
    } finally {
      await releaseCamilleClientEmailLock(dossierId);
    }
  }, delayMs);

  registerScheduledDocFollowUp(dossierId, timer);
  if (typeof timer.unref === "function") timer.unref();
}
