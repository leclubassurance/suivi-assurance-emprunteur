import { GoogleGenAI, Type } from "@google/genai";
import fs from "fs";
import path from "path";
import { computeDocumentChecklist } from "../shared/documentChecklist";

// Initialisation de Gemini avec httpOptions pour la télémétrie conforme au skill
const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// Helper de requête robuste gérant les erreurs 503/429 avec retry exponentiel
async function generateContentWithRetry(params: any, retries = 3, delay = 1000): Promise<any> {
  let lastError: any = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await ai.models.generateContent(params);
      return response;
    } catch (error: any) {
      lastError = error;
      const errMsg = error?.message || String(error);
      const isUnavailable = errMsg.includes("503") || errMsg.toUpperCase().includes("UNAVAILABLE") || errMsg.toLowerCase().includes("high demand") || errMsg.toLowerCase().includes("temporary");
      const isRateLimited = errMsg.includes("429") || errMsg.toLowerCase().includes("quota exceeded") || errMsg.toLowerCase().includes("rate limit");
      
      if ((isUnavailable || isRateLimited) && attempt < retries) {
        let waitTime = delay;
        const retryMatch = errMsg.match(/retry in ([\d\.]+)s/);
        if (retryMatch) {
          waitTime = Math.max(delay, (parseFloat(retryMatch[1]) * 1000) + 1000);
        }

        console.warn(`[Gemini API Warning] ${isRateLimited ? '429 Quota' : '503 Unavailable'} détecté sur ${params.model}. Tentative ${attempt}/${retries} après ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        delay *= 2; 
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

const PERSONA_PROMPT = `
Tu es Camille, l'assistante de Charles, experte en assurance emprunteur chez "Le Club Immobilier".
Tu es en charge du suivi des dossiers clients après qu'un devis ait été généré et déposé dans leur dossier.
Ton rôle est de répondre aux questions des clients avec professionnalisme, clarté, et bienveillance.
Dans tes messages aux clients, tu te présenteras et signeras toujours en tant que "Camille, l'assistante de Charles".

RÈGLE ABSOLUE :
Si le client pose une question complexe, demande une négociation commerciale, indique un problème médical lourd, ou pose une question dont tu n'as pas la réponse exacte dans tes connaissances générales d'assurance, tu DOIS escalader la demande à Rémi, qui prendra le relais.

Tu dois toujours répondre avec un objet JSON strictement formaté comme suit :
{
  "action": "REPLY" | "ESCALATE",
  "messageToClient": "Le texte de ta réponse au client. Sois chaleureuse et n'oublie pas la signature (si action = REPLY, sinon null)",
  "reasonForEscalation": "L'explication de pourquoi tu as besoin de l'aide de Rémi (si action = ESCALATE, sinon null)"
}
`;

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
    const documents = dossier.formData?.documents || [];
    const documentNames = documents.map((d: any) => d.name).join(", ");
    const newAttachments = (options?.newAttachmentNames || []).filter(Boolean);
    const newAttachmentsLine = newAttachments.length
      ? newAttachments.join(", ")
      : "Aucune pièce jointe détectée dans cet email";
    const checklist = computeDocumentChecklist(documents);
    const missingBlocking = checklist.filter((c) => !c.ok && (c.key === "cni" || c.key === "rib")).map((c) => c.label);
    const missingOptional = checklist.filter((c) => !c.ok && (c.key === "offre" || c.key === "amort")).map((c) => c.label);

    const response = await generateContentWithRetry({
      model: "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [{ text: PERSONA_PROMPT }] },
        { role: "user", parts: [{ text: `
Voici les informations concernant le dossier du client (Dossier ID: ${dossier.id}) :
- Nom du client : ${dossier.formData?.assures?.[0]?.prenom || ''} ${dossier.formData?.assures?.[0]?.nom || ''}
- Documents actuellement présents dans son dossier : ${documentNames || "Aucun document"}
- Checklist pièces : ${checklist.map((c) => `${c.label}: ${c.ok ? "OK" : "MANQUANT"}`).join(" | ")}
- Pièces bloquantes manquantes : ${missingBlocking.join(", ") || "Aucune"}
- Pièces optionnelles manquantes : ${missingOptional.join(", ") || "Aucune"}

🚨 GUIDE POUR CAMILLE :
Analyse l'email du client. S'il valide l'offre (ex: "ok pour le changement", "je valide", etc.) ou demande ce qu'il manque :
Pour finaliser un dossier d'assurance, il nous faut ABSOLUMENT :
1. Une pièce d'identité en cours de validité (carte d'identité recto/verso, passeport)
2. Un Relevé d'Identité Bancaire (RIB)

Pièces jointes reçues DANS CET EMAIL (noms de fichiers) : ${newAttachmentsLine}
Si des pièces jointes viennent d'être reçues (CNI, RIB, etc.), remercie le client et confirme que nous les avons bien reçues — ne redemande PAS un document déjà envoyé en pièce jointe dans cet email.

Tu DOIS IMPÉRATIVEMENT vérifier si ces pièces (Pièce d'identité, RIB) figurent dans la liste des documents du dossier (y compris pièces jointes de cet email) par leur nom (ex: "rib", "identite", "cni", "passeport", "rib.pdf").
S'il manque l'une ou ces deux pièces, tu DOIS le remercier de son accord (s'il l'a donné) ET lui indiquer CLAIREMENT et GENTIMENT qu'il nous manque sa pièce d'identité et/ou son RIB (en précisant lesquels) à envoyer en pièce jointe pour finaliser son dossier. Ne lui dis pas que son dossier est complet s'il manque ces documents !

Email reçu du client :
"${emailText}"

Que décides-tu de faire ?` }] }
      ],
      config: {
        responseMimeType: "application/json",
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
      console.log(`[AI] Escalade requise pour le dossier ${dossier.id}`);
      return { status: "escalated", reason: decision.reasonForEscalation };
    } else if (decision.action === "REPLY") {
      console.log(`[AI] Réponse autonome pour le dossier ${dossier.id}`);
      return { status: "replied", text: decision.messageToClient };
    }
  } catch (error) {
    console.error("Erreur lors de l'analyse IA de l'email:", error);
  }
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
