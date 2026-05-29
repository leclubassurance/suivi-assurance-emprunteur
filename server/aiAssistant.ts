import { Type } from "@google/genai";
import fs from "fs";
import path from "path";
import { computeDocumentChecklist } from "../shared/documentChecklist";
import { buildCamilleContextBlock, wrapCamilleHtmlReply } from "./camilleMail";
import { sanitizeCamilleClientMessage } from "./camilleClientMessage";
import { generateContentWithRetry } from "./geminiClient";
import { CAMILLE_PERSONA_PROMPT } from "./camillePersona";
import { buildCamilleKnowledgePromptBlock } from "./camilleKnowledgeDrive";
import { getPreStudyLoanReminderLabels } from "../shared/documentChecklist";
import { hasStudyBeenSent } from "./dossierLifecycle";
import { tryCamilleDocClarificationInsteadOfEscalation } from "./camilleDocAutoReply";
import { getRecentStaffOutboundSummary, isStaffActivelyHandling } from "./camilleStaffHandoff";
import { getConversationTailForAi, hasUnansweredClientInbound } from "./gmailConversation";

export async function processIncomingClientEmail(
  dossier: any,
  emailText: string,
  clientEmail: string,
  options?: { newAttachmentNames?: string[] },
) {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes("MY_GEMINI")) {
    console.warn("[AI] GEMINI_API_KEY manquante sur Railway — pas de réponse automatique.");
    return { status: "escalated", reason: "Clé Gemini non configurée sur le serveur." };
  }

  try {
    const prenom = dossier.formData?.assures?.[0]?.prenom || "";
    const ctx = buildCamilleContextBlock(dossier, options?.newAttachmentNames || []);
    const staffHandling = isStaffActivelyHandling(dossier);
    const staffOutbound = getRecentStaffOutboundSummary(dossier);
    const knowledgeBlock = await buildCamilleKnowledgePromptBlock(null);
    const studySent = hasStudyBeenSent(dossier);
    const missingLoanLabels = studySent
      ? ctx.missingBlocking.map((c) => c.label)
      : getPreStudyLoanReminderLabels(dossier.formData?.documents || []);
    const newAttachmentsLine =
      ctx.newAttachmentNames.length > 0
        ? ctx.newAttachmentNames.join(", ")
        : "Aucune pièce jointe dans cet email";
    const conversationTail = getConversationTailForAi(dossier, 8);
    const needsReply = hasUnansweredClientInbound(dossier);

    const response = await generateContentWithRetry({
      model: "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [{ text: CAMILLE_PERSONA_PROMPT }] },
        { role: "user", parts: [{ text: knowledgeBlock }] },
        { role: "user", parts: [{ text: `
Dossier : ${dossier.id}
Client : ${prenom} ${dossier.formData?.assures?.[0]?.nom || ""} <${clientEmail}>

État des pièces (source de vérité — ne pas contredire) :
${ctx.documentSummary}

Analyse automatique OCR/PDF (ne pas contredire) :
${ctx.documentAnalysisReport || "Non disponible"}

Consignes rédaction client (si besoin de préciser des documents) :
${ctx.loanClientGuidance || "—"}

Signaux internes (ne pas révéler au client) :
${(ctx.qualityIssues || []).length ? (ctx.qualityIssues || []).join("\n") : "Aucun"}
docsReliability: ${ctx.docsReliability || "unknown"}
certainDocProblems: ${ctx.certainDocProblems ? "true" : "false"}
uncertainDocSignals: ${(ctx.uncertainDocSignals || []).join("; ") || "aucun"}
staffActivelyHandling: ${staffHandling ? "true" : "false"}
emails récents équipe vers client:
${staffOutbound}
clientSafeReason: ${ctx.clientSafeReason || "N/A"}

Pièces à demander au client (selon phase) : ${
  studySent
    ? missingLoanLabels.join(", ") || "Aucune — CNI/RIB déjà reçus ou non requis pour l'instant"
    : missingLoanLabels.join(", ") || "Aucune — offre et tableau OK côté analyse"
}
Étude déjà envoyée au client (studySent) : ${studySent ? "OUI — ne jamais promettre une étude à venir" : "NON"}
NE PAS mentionner CNI/RIB avant envoi de l'étude économiques (sauf si studySent=true ci-dessus).
Offre de prêt + tableau présents dans le dossier : ${ctx.loanDocsPresent ? "OUI" : "NON"}
Offre validée par analyse : ${ctx.loanOffreExploitable ? "OUI" : "NON"}
Tableau validé par analyse : ${ctx.loanAmortExploitable ? "OUI" : "NON"}
Exploitables pour l'étude (les deux validés) : ${ctx.loanDocsOk ? "OUI" : "NON"}
Si présents mais pas exploitables : demander uniquement un renvoi PDF banque, sans dire qu'ils manquent.
Si présents et exploitables : NE PAS demander offre/tableau (sauf si le client pose une question précise).
Si studySent=OUI : le client a déjà reçu l'étude par email — accuser réception de son message (ex. accord pour changer d'assurance) et annoncer la suite avec Charles, sans dire qu'une étude va être envoyée.
Ne jamais mettre de formule d'accueil dans messageToClient (Bonjour, Madame…) — ajoutée automatiquement.

Pièces jointes reçues DANS CET EMAIL : ${newAttachmentsLine}

Fil de conversation récent (ordre chronologique) :
${conversationTail}

Message client sans réponse outbound après lui : ${needsReply ? "OUI — répondre maintenant" : "non"}

Email du client :
"""
${emailText.slice(0, 8000)}
"""

Décide REPLY ou ESCALATE.` }] }
      ],
      config: {
        responseMimeType: "application/json",
        temperature: 0.35,
      }
    });

    const resultText = response.text;
    if (!resultText) throw new Error("No response from AI");
    
    let decision;
    try {
      decision = JSON.parse(resultText);
    } catch (e) {
      console.error("[AI] Error parsing JSON response:", resultText);
      decision = { action: "ESCALATE", reasonForEscalation: "Erreur technique de l'IA (JSON invalide)" };
    }

    if (decision.action === "ESCALATE") {
      const docReply = await tryCamilleDocClarificationInsteadOfEscalation(dossier, {
        clientMessage: emailText,
        reason: decision.reasonForEscalation,
      });
      if (docReply.sent && docReply.html) {
        console.log(`[AI] Escalade évitée — mail documents envoyé pour ${dossier.id}`);
        return { status: "replied", text: docReply.html };
      }
      console.log(`[AI] Escalade requise pour le dossier ${dossier.id}`);
      return { status: "escalated", reason: decision.reasonForEscalation };
    } else if (decision.action === "REPLY") {
      console.log(`[AI] Réponse autonome pour le dossier ${dossier.id}`);
      const plain = String(decision.messageToClient || "").trim();
      if (!plain) {
        return { status: "escalated", reason: "Réponse IA vide" };
      }
      const nom = dossier.formData?.assures?.[0]?.nom || "";
      const { text, blockedDocRequest } = sanitizeCamilleClientMessage(plain, dossier);
      if (blockedDocRequest) {
        console.log(
          `[AI] Demande de pièces prêt bloquée (déjà présentes) pour ${dossier.id}`,
        );
      }
      return {
        status: "replied",
        text: wrapCamilleHtmlReply(text, prenom, nom),
      };
    }
  } catch (error) {
    console.error("Erreur lors de l'analyse IA de l'email:", error);
  }
}

export async function generateCamillePreDossierHelpEmail(params: {
  clientEmail: string;
  clientPrenom?: string;
  message: string;
}): Promise<{ subject: string; html: string }> {
  const prenom = String(params.clientPrenom || "").trim();
  const safeName = prenom || "Bonjour";
  const subject = `Aide pour votre dossier — ${safeName}`;

  // If Gemini is not configured, return a safe generic reply.
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes("MY_GEMINI")) {
    const generic = [
      `Je peux vous aider à récupérer les documents nécessaires.`,
      ``,
      `Pour lancer l’étude, il nous faut :`,
      `- l’offre de prêt (PDF depuis votre espace bancaire)`,
      `- le tableau d’amortissement / échéancier complet (PDF)`,
      ``,
      `Souvent, vous les trouverez dans votre application bancaire : rubrique “Crédit”, “Prêt immobilier” puis “Documents” ou “Échéancier”.`,
      `Si vous ne les voyez pas, vous pouvez aussi demander directement à votre conseiller bancaire de vous envoyer l’offre de prêt et l’échéancier complet en PDF.`,
      ``,
      `Dès que vous les avez, vous pouvez les déposer dans le formulaire et répondre à ce mail si besoin.`,
    ].join("\n");
    return { subject, html: wrapCamilleHtmlReply(generic, prenom, "") };
  }

  const knowledgeBlock = await buildCamilleKnowledgePromptBlock(null);

  const helpPrompt = `
Tu es Camille, assistante de Charles, au Club Immobilier Français.
Tu aides un client à compléter le formulaire en ligne et à retrouver les documents.

Contraintes:
- Ton chaleureux, humain, concis (6 à 14 lignes).
- Pas de téléphone.
- Expliquer où trouver: offre de prêt + tableau d’amortissement (échéancier) dans app bancaire / espace client, ou demander au conseiller.
- Mentionner que les PDFs issus de l’espace bancaire sont préférables à des photos pour la lisibilité.
- Terminer par une seule action: "répondez à ce mail si besoin" OU "déposez vos documents dans le formulaire".

Réponds en JSON:
{ "messageToClient": "..." }
`;

  const response = await generateContentWithRetry({
    model: "gemini-2.5-flash",
    contents: [
      { role: "user", parts: [{ text: helpPrompt }] },
      { role: "user", parts: [{ text: knowledgeBlock }] },
      {
        role: "user",
        parts: [
          {
            text: `Client: ${params.clientEmail}\nMessage:\n"""\n${String(params.message || "").slice(0, 4000)}\n"""`,
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      temperature: 0.55,
    },
  });

  let decision: any = null;
  try {
    decision = JSON.parse(response.text || "{}");
  } catch {
    decision = null;
  }

  const plain = String(decision?.messageToClient || "").trim();
  if (!plain) {
    const fallback = `Je peux vous aider à retrouver l’offre de prêt et le tableau d’amortissement (échéancier complet) dans votre espace bancaire.\nSouvent: “Crédit / Prêt immobilier” → “Documents” ou “Échéancier”.\nSi vous ne les voyez pas, demandez à votre conseiller bancaire de vous les envoyer en PDF.\n\nDéposez ensuite les PDFs dans le formulaire — je reste disponible si besoin.`;
    return { subject, html: wrapCamilleHtmlReply(fallback, prenom, "") };
  }

  const { text } = sanitizeCamilleClientMessage(plain, {
    formData: { assures: [{ prenom, email: params.clientEmail }] },
  });
  return { subject, html: wrapCamilleHtmlReply(text, prenom, "") };
}

const CHARLES_VICTOR_PERSONA = `
Tu es Charles Victor, conseiller expert en assurance emprunteur au "Le Club Immobilier Français" (LCIF).
Tu es un courtier indépendant, non lié à une compagnie d'assurance.
Ton rôle : analyser le dossier du client, calculer objectivement ce qu'il peut économiser, et l'informer par mail de façon professionnelle et honnête — sans jamais nommer l'assureur proposé dans le mail, et sans jamais sur-vendre.

RÈGLES ABSOLUES DU MAIL :
- ❌ Ne jamais nommer l'assureur (Cardif, BNP, iAssure, etc.).
- ❌ Ne jamais mettre de numéro de téléphone (tout par mail).
- ❌ Ne jamais écrire "LCIF" seul — toujours "Le Club Immobilier Français" ou "notre équipe".
- ❌ Ne jamais mentionner le bloc garanties supérieures si les garanties proposées sont simplement équivalentes.
- ❌ Ne jamais redemander les échéanciers ou l'offre de prêt (déjà reçus).
- ✅ Signer Charles Victor — Conseiller en assurance emprunteur — Le Club Immobilier Français.
- ✅ Couleurs : bleu marine #1E3A8A, blanc, gris clair #F8FAFC.
- ✅ Logo blanc sur fond bleu : https://res.cloudinary.com/dji8akleo/image/upload/v1772999309/5_yn8wfm.png
- ✅ Ton : chaleureux, professionnel, direct — jamais sur-vendeur.
- ✅ Call-to-action unique : répondre au mail pour activer le changement.
- ✅ Inline CSS uniquement.
`;

export async function generateInsuranceStudyMail(dossier: any, calc: any): Promise<string> {
  try {
    const isLemoine = (Number(dossier.formData?.prets?.[0]?.capitalRestant) || 0) <= 200000;
    const clientName = dossier.formData?.assures?.[0]?.prenom || 'Cher client';
    
    // Déterminer le scénario
    let scenario = 'A'; // Défaut : économie significative
    const totalSavingsNette = calc.totalSavings || 0;
    if (totalSavingsNette < 500) {
      if (calc.isGarantiesSuperieures) scenario = 'B';
      else scenario = 'C';
    }
    if (totalSavingsNette <= 0 && !calc.isGarantiesSuperieures) scenario = 'C';

    let prompt = `
Tu es Charles Victor, conseiller en assurance emprunteur au Club Immobilier Français. Tu es courtier indépendant, pas lié à une compagnie. Ton rôle : analyser le dossier du client, calculer objectivement ce qu'il peut économiser, et l'informer par mail de façon professionnelle et honnête — sans jamais nommer l'assureur proposé dans le mail, et sans jamais sur-vendre.

Rédige un mail HTML complet (inline CSS uniquement) pour ${clientName} basé sur cette analyse :
- Scénario déterminé : ${scenario === 'C' ? "C - Dossier déjà optimisé (Pas d'économie)" : scenario === 'B' ? "B - Economies faibles mais Garanties Supérieures" : "A - Économie significative"}
- Coût total assurance actuelle restante (AVANT) : ${calc.existantTotal} €
- Coût total assurance proposée restante (APRÈS) : ${calc.proposeTotalBare} €
- Économie Brute Totale (Différence) : ${calc.totalSavingsBrute} €
- Frais Assureur (dossier) : ${calc.feesAssureur || 0} €
- Frais Courtage LCIF : ${calc.feesCourtageLCIF || 0} €
- Garanties : ${calc.isGarantiesSuperieures ? "SUPERIEURES" : "EQUIVALENTES"}
- Mensualités Actuelles estimées : Année 1: ${calc.ep1} €/mois, Année 2: ${calc.ep2} €/mois, Année 3: ${calc.ep3} €/mois, Année 4+: ${calc.ep3} €/mois
- Mensualités Proposées estimées : Année 1: ${calc.pp1} €/mois, Année 2: ${calc.pp2} €/mois, Année 3: ${calc.pp3} €/mois, Année 4+: ${calc.pp3} €/mois
- Loi Lemoine applicable : ${isLemoine ? "OUI" : "NON"}

RÈGLES ABSOLUES :
- Police d'écriture : sans-serif, propre, moderne (ex: Helvetica, Arial, sans-serif), taille de police 14px ou 15px.
- Ne jamais nommer l'assureur proposé.
- Ne jamais mettre de numéro de téléphone.
- Signer Charles Victor — Conseiller en assurance emprunteur — Le Club Immobilier Français.
- Couleurs : bleu marine #1E3A8A, blanc, gris clair #F8FAFC. Lignes de tableau alternées.
- Logo en haut, blanc sur fond bleu : https://res.cloudinary.com/dji8akleo/image/upload/v1772999309/5_yn8wfm.png
- Ton : chaleureux, professionnel, direct.
- Call-to-action : répondre au mail.
- Ne jamais mentionner l'économie sur 8 ans, concentre-toi sur l'économie totale qui est la plus représentative.
- Footer Légal obligatoire (en petit texte gris à la fin) :
  Le Club Immobilier Français
  17 Passage Leroy, 44000 Nantes
  N° ORIAS : 24002253 | Courtier en assurance emprunteur, indépendant de tout assureur
  Cette proposition est établie à titre indicatif et n'a pas de valeur contractuelle.

STRUCTURE REQUISE SELON LE SCÉNARIO :

${scenario === 'A' || scenario === 'B' ? `
L'accroche : "J'ai analysé votre dossier... avec des garanties ${calc.isGarantiesSuperieures ? "supérieures" : "équivalentes"}."
BLOC ÉCONOMIE : fond #EFF6FF, bordure #BFDBFE, padding et marges généreuses. Affichez clairement :
  * Coût assurance actuelle : ${calc.existantTotal} €
  * Coût nouvelle assurance : ${calc.proposeTotalBare} €
  * ECONOMIE GENEREE : ${calc.totalSavingsBrute} €
(Séparément en dessous) Détaillez vos frais : Frais de dossier (${calc.feesAssureur || 0} €) | Frais de courtage (${calc.feesCourtageLCIF || 0} €). Demandez au client de les déduire lui-même de l'économie s'il le souhaite.
${calc.isGarantiesSuperieures ? 'BLOC GARANTIES SUPÉRIEURES : fond #F0FDF4. Détaillez ce qui s\'améliore.' : ''}
TABLEAU MENSUALITÉS : Un seul tableau consolidé "ÉVOLUTION DE VOS MENSUALITÉS" avec 5 lignes (Année 1, Année 2, Année 3, Année 4, Années suivantes). Colonnes : Période | Assurance actuelle | Nouvelle assurance | Gain Mensuel.
Loi Lemoine : Si applicable ("OUI"), indiquer "Aucun questionnaire de santé nécessaire".
PIÈCES À FOURNIR : CNI + RIB.
` : `
BLOC RÉSULTAT POSITIF : fond #F0FDF4. "Bonne nouvelle... assurance déjà optimisée."
Indiquer qu'ils font partie de la minorité des dossiers bien optimisés et félicitez-les.
BLOC RECOMMANDATION : fond #EFF6FF. Proposer d'analyser les proches.
Pas de tableau de sommes dans ce cas.
`}

Retourne UNIQUEMENT le code HTML. Ne mettez pas de formatage de type markdown (\`\`\`html).
`;

    const response = await generateContentWithRetry({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { temperature: 0.7 }
    });

    return response.text;
  } catch (err) {
    console.error("Error generating Charles Victor email:", err);
    throw err;
  }
}



function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.pdf': return 'application/pdf';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    default: return 'application/octet-stream';
  }
}
