import { addEvent } from "./dossierModel";
import {
  collectKnownCorrespondenceEmails,
  findNonLeadDossierByCorrespondenceEmail,
  getDossierClientEmails,
} from "./gmailAttachments";
import { isCamilleTestMode } from "./businessHours";
import { getAssurancePlatformUrl } from "../shared/lcifLegalIdentity";
import {
  buildProspectGmailQueryExtras,
  classifyInboundEmail,
  extractEmailAddress,
} from "./inboundEmailClassifier";

function extractSenderEmail(fromRaw: string): string {
  return extractEmailAddress(fromRaw);
}

export { shouldIgnoreProspectSender } from "./inboundEmailClassifier";
import { isLeadDossier } from "./leadDossierMerge";
import { extractNewClientMessageText } from "./emailQuoteStrip";
import {
  buildProspectInsurerPartnerReplyParagraph,
  detectMentionedKereisPartner,
  prospectReplyViolatesInsurerDisclosureRules,
} from "../shared/kereisPartners";

export function isProspectInboundEnabled(): boolean {
  const raw = String(process.env.CAMILLE_PROSPECT_INBOUND_ENABLED ?? "").toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return isCamilleTestMode();
}

export function collectKnownClientEmails(db: { dossiers: any[] }): Set<string> {
  return collectKnownCorrespondenceEmails(db);
}

export function findLeadDossierByEmail(db: { dossiers: any[] }, email: string) {
  const e = email.toLowerCase();
  return (
    db.dossiers.find(
      (d) => isLeadDossier(d) && getDossierClientEmails(d).some((ce) => ce === e),
    ) || null
  );
}

function parseDisplayName(fromRaw: string): { prenom: string; nom: string } {
  const raw = String(fromRaw || "").trim();
  const withoutEmail = raw.replace(/<[^>]+>/, "").trim().replace(/^"|"$/g, "");
  if (!withoutEmail || withoutEmail.includes("@")) {
    return { prenom: "", nom: "Prospect" };
  }
  const parts = withoutEmail.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { prenom: parts[0], nom: "Prospect" };
  return { prenom: parts[0], nom: parts.slice(1).join(" ") };
}

export function createLeadDossierFromInbound(
  db: { dossiers: any[] },
  senderEmail: string,
  fromRaw?: string,
) {
  const { prenom, nom } = parseDisplayName(fromRaw || "");
  const leadId = `LCIF-${Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0")}`;
  const now = new Date().toISOString();
  const lead = {
    id: leadId,
    status: "PROSPECT",
    createdAt: now,
    updatedAt: now,
    isLead: true,
    leadSource: "gmail_inbound",
    formData: {
      assures: [{ prenom, nom, email: senderEmail.toLowerCase() }],
      documents: [],
      prets: [],
    },
    communications: [],
    tasks: [],
    emails: [],
    notes: [],
    eventLog: [],
    processedGmailIds: [],
  } as any;

  addEvent(lead, {
    type: "DOSSIER_CREATED",
    actor: { kind: "SYSTEM", label: "Camille" },
    message: `Prospect créé automatiquement — premier mail entrant (${senderEmail}).`,
    meta: { leadSource: "gmail_inbound" },
  });

  db.dossiers.push(lead);
  return lead;
}

export function buildProspectLeadPromptBlock(dossier: any): string {
  const formUrl = getAssurancePlatformUrl();
  return `
MODE PROSPECT / PRÉ-ÉTUDE (isLead=true — pas encore de dossier formulaire)
- Ce contact a écrit à assurance@ SANS avoir rempli le formulaire en ligne.
- Répondre aux questions générales (gratuité de l'étude, Loi Lemoine, délais indicatifs, fonctionnement de l'étude d'économie).
- Inviter au formulaire en ligne (${formUrl}) UNIQUEMENT si le client veut démarrer, demande la suite, ou parle des documents — PAS sur un simple bonjour.
- Le formulaire recueille les informations du projet ET permet de déposer l'offre de prêt et le tableau d'amortissement (PDF).
- INTERDIT ABSOLU : demander d'envoyer offre de prêt, tableau d'amortissement, CNI ou RIB par réponse email ou pièce jointe mail.
- INTERDIT : promettre une étude chiffrée avant réception du formulaire complété.
- Le lien formulaire (${formUrl}) seulement quand c'est le bon moment (pas à chaque mail).
- NE PAS parler d'étude déjà envoyée ni d'espace adhésion Kereis.
- Si le prospect demande avec quels assureurs nous travaillons : Kereis + 2 à 4 exemples max, contrats particuliers / tarifs privilégiés — JAMAIS la liste complète ; si demande explicite → Charles la communiquera ensuite.
- Ton accueillant, pédagogique. Référence interne : ${dossier.id}.
`.trim();
}

/** Bonjour / salut seul — sans citation du fil précédent. */
export function isPureProspectGreeting(clientMessage?: string): boolean {
  const msg = extractNewClientMessageText(String(clientMessage || "")).trim().toLowerCase();
  if (!msg || msg.length > 80) return false;
  return /^(bonjour|bonsoir|salut|hello|coucou|bonne journ[ée]e|bonne soir[ée]e)[\s!.?,]*$/i.test(msg);
}

/** @deprecated Aperçu admin uniquement — les mails auto passent par l'IA (camilleProspectReply). */
export function buildProspectPureGreetingReplyPlain(dossier: any): string {
  return [
    `Merci pour votre message.`,
    `Je suis Camille, l'assistante de Charles Victor au Club Immobilier Français. Je peux répondre à vos questions sur l'assurance emprunteur, ou vous accompagner si vous souhaitez lancer une étude d'économie gratuite et sans engagement.`,
    `De quoi souhaitez-vous qu'on parle ?`,
    `Référence interne : ${dossier.id}.`,
  ].join("\n\n");
}

/** @deprecated Aperçu admin uniquement — les mails auto passent par l'IA (camilleProspectReply). */
export function buildProspectWelcomeReplyPlain(dossier: any, clientMessage?: string): string {
  if (isPureProspectGreeting(clientMessage)) {
    return buildProspectPureGreetingReplyPlain(dossier);
  }
  const formUrl = getAssurancePlatformUrl();
  const msg = extractNewClientMessageText(String(clientMessage || "")).trim().toLowerCase();
  const isLightIntro =
    /^(info|renseignement|question)[\s!.?]*$/i.test(msg) || msg.length <= 40;
  if (isLightIntro) {
    return buildProspectPureGreetingReplyPlain(dossier);
  }
  return [
    `Merci pour votre message.`,
    `Nous avons bien noté votre demande. L'étude d'économie est gratuite et sans engagement.`,
    `Pour que Charles prépare une étude personnalisée, le formulaire en ligne permet de nous transmettre votre offre de prêt et votre tableau d'amortissement en PDF :`,
    formUrl,
    `Référence interne : ${dossier.id}.`,
  ].join("\n\n");
}

/** Question sur les assureurs / partenaires — réponse template autorisée. */
export function isProspectInsurerPartnerQuestion(clientMessage?: string): boolean {
  const msg = extractNewClientMessageText(String(clientMessage || "")).toLowerCase();
  return (
    /assurances?\s+(pour\s+)?(lesquel|laquel|quel)/i.test(msg) ||
    /avec quels? assureurs|quels? assureurs|compagnies?\s+d.assurance/i.test(msg) ||
    /partenaires?\s+(assurance|assureur)/i.test(msg) ||
    /travaillez avec quels/i.test(msg) ||
    Boolean(detectMentionedKereisPartner(msg))
  );
}

/** Humain vs IA, hors-sujet (météo…) — ne pas répondre avec le template documents. */
export function isProspectRelationalSmallTalk(clientMessage?: string): boolean {
  const msg = extractNewClientMessageText(String(clientMessage || "")).trim().toLowerCase();
  if (!msg) return false;
  return (
    /humaine?|humain|robot|intelligence artificielle|\bia\b|chatgpt|bot\b|automatique|pas une vraie|vraie personne|vous [êe]tes (une )?ia/i.test(
      msg,
    ) ||
    /météo|meteo|weather|il va (pleuvoir|faire|neiger)/i.test(msg) ||
    (/réactivité|réactif|trop vite|trop rapide/i.test(msg) &&
      /humaine?|humain|robot|\bia\b|automatique/i.test(msg))
  );
}

/** Réponse aux questions relationnelles / hors-sujet (prospect). */
export function buildProspectRelationalReplyPlain(dossier: any, clientMessage?: string): string {
  const formUrl = getAssurancePlatformUrl();
  const msg = extractNewClientMessageText(String(clientMessage || "")).trim();
  const msgLower = msg.toLowerCase();
  const lines = [`Merci pour votre message.`];

  if (
    /humaine?|humain|robot|intelligence artificielle|\bia\b|chatgpt|bot\b|automatique|pas une vraie|vraie personne|vous [êe]tes (une )?ia/i.test(
      msgLower,
    )
  ) {
    lines.push(
      `Je suis Camille, l'assistante de Charles Victor au Club Immobilier Français. Je gère le suivi par email au quotidien (questions, formulaire, documents) ; Charles, conseiller en assurance emprunteur, prépare les études personnalisées. Nos réponses peuvent être rapides sur les demandes courantes — je reste à votre disposition pour votre assurance de prêt.`,
    );
  } else if (/réactivité|réactif|trop vite|trop rapide/i.test(msgLower)) {
    lines.push(
      `Merci pour votre retour : nous faisons au mieux pour répondre clairement et rapidement à chaque message.`,
    );
  }

  if (/météo|meteo|weather|il va (pleuvoir|faire|neiger)/i.test(msgLower)) {
    lines.push(
      `En revanche, je ne peux pas vous renseigner sur la météo : mon périmètre est l'accompagnement assurance emprunteur. Pour la météo, Météo-France ou votre application habituelle seront plus fiables.`,
    );
  }

  lines.push(
    `L'étude d'économie est gratuite et sans engagement.`,
    `Pour lancer votre dossier ou poser une question sur votre assurance de prêt, le formulaire en ligne est ici :`,
    formUrl,
    `Référence interne : ${dossier.id}.`,
  );
  return lines.join("\n\n");
}

function prospectMessageNeedsLoanDocsReminder(clientMessage?: string): boolean {
  const msg = extractNewClientMessageText(String(clientMessage || "")).toLowerCase();
  return /document|offre de prêt|tableau|formulaire|pdf|chiffr|économ|econom|étude|etude|optimis|tarif|co[uû]t|prêt|pret|gratuit|sans engagement|lemoine|délégation|delegation|combien|€|euro|assurance emprunteur/i.test(
    msg,
  );
}

/** Questions prospect courantes → réponse template fiable (sans LLM). */
export function isProspectTemplateQuestion(clientMessage?: string): boolean {
  const msg = extractNewClientMessageText(String(clientMessage || "")).trim().toLowerCase();
  if (!msg || msg.length > 600) return false;
  if (isProspectRelationalSmallTalk(msg)) return false;
  if (isProspectInsurerPartnerQuestion(msg) || detectMentionedKereisPartner(msg)) return true;
  if (
    /(gratuit|sans engagement|lemoine|délégation|delegation|obligatoire|c'est quoi|qu'est.ce|quest.ce|comment (ça|ca) (marche|fonctionne)|pourquoi (vous|m').{0,30}(contact|écri|ecri)|club immobilier|agence immo|faites.{0,20}(immobilier|assurance)|documents?.{0,20}(faut|besoin|nécessaire|necessaire)|offre de prêt|tableau d.amortissement|formulaire|combien de temps|délai|delai)/i.test(
      msg,
    )
  ) {
    return true;
  }
  return false;
}

/** Salutation courte sans question métier → réponse template (pas de LLM). */
export function isSimpleProspectGreeting(clientMessage?: string): boolean {
  const msg = extractNewClientMessageText(String(clientMessage || "")).trim().toLowerCase();
  if (!msg) return true;
  if (isPureProspectGreeting(clientMessage)) return true;
  if (msg.length > 120) return false;
  if (/\?/.test(msg) && /(lemoine|économ|econom|gratuit|tarif|délai|delai|comment|pourquoi|assurance|prêt|pret|fonctionne)/i.test(msg)) {
    return false;
  }
  return /^(info|renseignement|question)[\s!.?]*$/i.test(msg);
}

/** Réponse sûre quand le LLM invente des chiffres ou interprète mal le fil prospect. */
export function isUnsafeProspectLlmReply(plain: string, clientMessage?: string): boolean {
  const msg = extractNewClientMessageText(String(clientMessage || "")).toLowerCase();
  const text = String(plain || "").toLowerCase();
  if (
    /arrêter|arreter|abandonner|reconsidérer|reconsiderer|souhaitez reconsidérer/.test(text) &&
    !/arrêt|arret|abandon|plus intéress|ne souhaite plus|stop|renonc|ne veux plus/i.test(msg)
  ) {
    return true;
  }
  if (/(économie|economie).{0,40}\d{2,}|\d{3,}\s*€|plus de \d{3,}/i.test(plain)) {
    return true;
  }
  if (/frais de (mise en place|courtage)|opportunité unique/i.test(text) && !/étude envoyée/i.test(msg)) {
    return true;
  }
  const clientConfused =
    /je ne comprends pas|pas compris|gagn(er|e).{0,30}(argent|€)|pourquoi|comment (ça|ca) (marche|fonctionne)|c'est quoi|qu'est-ce|vous faites quoi/i.test(
      msg,
    );
  const replyOnlyAsksDocs =
    /tableau d'amortissement|formulaire|pièces|documents pour|compléter votre dossier/i.test(text) &&
    !/(lemoine|assurance emprunteur|courtier|compar|économ|club|immobilier)/i.test(text);
  if (clientConfused && replyOnlyAsksDocs) return true;
  if (
    /agence immo|immobilier/.test(msg) &&
    /vous faites|faites l'assurance|faites l assurance/.test(msg) &&
    !/agence|immobilier|club|lemoine|courtage|assurance emprunteur/i.test(text)
  ) {
    return true;
  }
  if (/d'ici \d+ (jour|semaine|mois)|sous \d+ (jour|semaine|mois)|dans \d+ (jour|semaine)/i.test(plain)) {
    return true;
  }
  if (msg.length > 80 && plain.length < 120 && replyOnlyAsksDocs) return true;
  if (prospectReplyViolatesInsurerDisclosureRules(plain)) return true;
  if (
    isProspectRelationalSmallTalk(msg) &&
    replyOnlyAsksDocs &&
    !/(camille|assistante|charles|humain|météo|meteo|weather|assurance emprunteur|club)/i.test(text)
  ) {
    return true;
  }
  if (
    isProspectRelationalSmallTalk(msg) &&
    !/(camille|assistante|charles|humain|météo|meteo|weather)/i.test(text)
  ) {
    return true;
  }
  return false;
}

/** Réponse prospect à une question métier (coût, Lemoine…) sans chiffre inventé. */
export function buildProspectQuestionReplyPlain(dossier: any, clientMessage?: string): string {
  const formUrl = getAssurancePlatformUrl();
  const msg = extractNewClientMessageText(String(clientMessage || "")).trim();
  const monthly = msg.match(/(\d{1,3})\s*€/i)?.[1];
  const noReplyYet = /pas eu votre réponse|pas reçu|sans réponse|toujours pas/i.test(msg);

  const msgLower = msg.toLowerCase();
  const contextual: string[] = [];
  if (isProspectInsurerPartnerQuestion(msg) || detectMentionedKereisPartner(msg)) {
    contextual.push(buildProspectInsurerPartnerReplyParagraph(msg));
  }
  if (/agence immo/.test(msgLower) && /assurance|faites|fait quoi|vous faites/.test(msgLower)) {
    contextual.push(
      `Le Club Immobilier Français accompagne aussi les projets immobiliers ; côté assurance emprunteur, Charles compare votre contrat actuel à des alternatives (Loi Lemoine) pour identifier une économie possible — c'est une activité distincte mais complémentaire de l'agence.`,
    );
  }
  if (/je ne comprends pas|pas compris|gagn(er|e).{0,25}(argent|€)|pourquoi|comment (ça|ca) marche/.test(msgLower)) {
    contextual.push(
      `En résumé : nous analysons gratuitement votre assurance de prêt ; si un autre contrat équivalent coûte moins cher, Charles vous le montre chiffré dans une étude — vous gardez la main sur la décision, sans engagement.`,
    );
  }
  if (/gratuit|sans engagement|payant|coût|cout|frais/.test(msgLower)) {
    contextual.push(
      `L'étude d'économie est entièrement gratuite et sans engagement : elle sert uniquement à vous montrer s'il existe une alternative équivalente moins chère.`,
    );
  }
  if (/lemoine/.test(msgLower)) {
    contextual.push(
      `La loi Lemoine peut, sous conditions, permettre de changer d'assurance emprunteur sans nouveau questionnaire médical. Charles vérifie l'éligibilité de votre dossier dans l'étude une fois vos documents reçus via le formulaire.`,
    );
  }
  if (/délégation|delegation|banque|assurance (de la )?banque|groupe bancaire/.test(msgLower)) {
    contextual.push(
      `Vous n'êtes pas obligé de garder l'assurance proposée par votre banque : la délégation consiste à souscrire ailleurs une assurance aux garanties équivalentes — c'est précisément l'objet de notre étude comparative.`,
    );
  }
  if (/document|offre de prêt|tableau|formulaire|envoy|joindre|pi[eè]ce jointe/.test(msgLower)) {
    contextual.push(
      `Pour lancer l'étude, l'offre de prêt et le tableau d'amortissement complets en PDF se déposent sur notre formulaire en ligne sécurisé — pas besoin de les envoyer en pièce jointe par email.`,
    );
  }
  if (/délai|delai|combien de temps|quand|rapidement/.test(msgLower)) {
    contextual.push(
      `Dès que le formulaire est complété avec des PDF exploitables, Charles prépare votre étude personnalisée. Nous vous tenons informé par email sur l'avancement.`,
    );
  }

  const lines = [
    noReplyYet
      ? `Toutes mes excuses pour l'attente — je reprends votre message.`
      : `Merci pour votre message.`,
    ...contextual,
    monthly
      ? `Vous mentionnez environ ${monthly} € par mois : sans votre offre de prêt et votre tableau d'amortissement complets, Charles ne peut pas encore vous dire précisément ce qu'il est possible d'optimiser — c'est justement l'objet de l'étude gratuite.`
      : contextual.length === 0 && prospectMessageNeedsLoanDocsReminder(msg)
        ? `Sans l'offre de prêt et le tableau d'amortissement (PDF depuis votre espace banque), nous ne pouvons pas encore chiffrer une économie — l'étude personnalisée sert à cela.`
        : contextual.length === 0
          ? `Je reste à votre disposition pour toute question sur l'assurance emprunteur ou pour lancer votre étude gratuite via le formulaire ci-dessous.`
          : null,
    `L'étude d'économie est gratuite et sans engagement.`,
    `Pour démarrer, complétez le formulaire sécurisé (quelques minutes) :`,
    formUrl,
    `Vous y déposerez les PDF — pas besoin de les envoyer en pièce jointe par email.`,
    `Référence interne : ${dossier.id}.`,
  ].filter(Boolean) as string[];
  return lines.join("\n\n");
}

function prospectReplyHasFormLink(text: string): boolean {
  const lower = text.toLowerCase();
  const formUrl = getAssurancePlatformUrl().toLowerCase();
  return (
    lower.includes(formUrl) ||
    /formulaire en ligne|formulaire sécurisé|formulaire:\s*https|assurance-emprunteur\.up\.railway\.app/i.test(
      lower,
    )
  );
}

/** Mentionne offre/tableau / dépôt docs sans lien formulaire. */
export function prospectReplyViolatesDocumentChannelRules(plain?: string): boolean {
  const text = String(plain || "").toLowerCase();
  if (prospectReplyHasFormLink(text)) return false;

  const mentionsLoanDocs =
    /offre de prêt|tableau d.amortissement|tableau d'amortissement|échéancier|echeancier|amortissement/i.test(
      text,
    ) ||
    (/besoin de (vos |votre )?(documents|pièces|offre|tableau)/i.test(text) &&
      /prêt|emprunt|assurance|étude|etude/i.test(text)) ||
    (/format pdf|espace bancaire|espace banque/i.test(text) &&
      /offre|tableau|amortissement|prêt|pret|document/i.test(text));

  return mentionsLoanDocs;
}

export function injectProspectFormLinkForLoanDocs(
  plain: string,
  dossier: any,
): string {
  const formUrl = getAssurancePlatformUrl();
  let text = String(plain || "").trim();
  if (!prospectReplyViolatesDocumentChannelRules(text)) return text;

  const formBlock = [
    `Pour nous transmettre l'offre de prêt et le tableau d'amortissement en PDF, utilisez notre formulaire en ligne sécurisé (quelques minutes) :`,
    formUrl,
    `Inutile de les envoyer en réponse à ce mail ou en pièce jointe — le formulaire est le seul canal de dépôt.`,
  ].join("\n");

  if (/espace bancaire|espace banque|format pdf/i.test(text)) {
    text = text.replace(
      /([^\n]*(?:espace bancaire|espace banque|format pdf)[^\n]*\.)/i,
      `$1\n\n${formBlock}`,
    );
  } else {
    text = `${text}\n\n${formBlock}`;
  }

  if (!text.includes(dossier.id)) {
    text = `${text}\n\nRéférence interne : ${dossier.id}.`;
  }
  console.log(`[Camille prospect] Lien formulaire injecté (${dossier.id})`);
  return text;
}

/** Corrections ciblées (sans écraser toute la réponse par un template générique). */
export function patchProspectReplyHardRules(
  plain: string,
  dossier: any,
  clientMessage?: string,
): string {
  const formUrl = getAssurancePlatformUrl();
  let text = String(plain || "").trim();

  text = injectProspectFormLinkForLoanDocs(text, dossier);

  const asksDocsByEmail =
    /(offre de prêt|tableau d.amortissement|échéancier|echeancier|cni|rib).{0,80}(envoy|joindre|transmettre|pi[eè]ce jointe|par mail|par email)/i.test(
      text,
    ) ||
    /(envoy|joindre|transmettre).{0,80}(offre de prêt|tableau d.amortissement|cni|rib)/i.test(text);
  if (asksDocsByEmail) {
    text = text
      .replace(
        /(envoy|joindre|transmettre|transmettez).{0,100}(par mail|par email|en pi[eè]ce jointe)/gi,
        "déposer sur notre formulaire en ligne",
      )
      .replace(
        /(offre de prêt|tableau d.amortissement).{0,60}(par mail|par email|en pi[eè]ce jointe)/gi,
        "documents sur le formulaire en ligne",
      );
    if (!text.includes(formUrl)) {
      text = `${text}\n\nFormulaire sécurisé : ${formUrl}`;
    }
  }

  if (prospectReplyViolatesInsurerDisclosureRules(text)) {
    text = text.replace(
      /\b(Allianz|Axa|Cardif|CNP|Generali|Harmonie Mutuelle|Malakoff Humanis|MNCAP|Mutlog)(,\s*(Allianz|Axa|Cardif|CNP|Generali|Harmonie Mutuelle|Malakoff Humanis|MNCAP|Mutlog)){2,}/gi,
      "nos partenaires assureurs (dont Kereis Prévoyance)",
    );
  }

  const mentionsStudyPath =
    /(étude|formulaire|démarrer|demarrer|lancer|commencer|déposer|deposer)/i.test(text);
  if (mentionsStudyPath && !text.includes(formUrl)) {
    text = `${text}\n\nFormulaire en ligne : ${formUrl}`;
  }
  if (!text.includes(dossier.id)) {
    text = `${text}\n\nRéférence interne : ${dossier.id}.`;
  }
  return text;
}

/** @deprecated Préférer patchProspectReplyHardRules après le pipeline prospect. */
export function enforceProspectReplyPlain(
  plain: string,
  dossier: any,
  clientMessage?: string,
): string {
  return patchProspectReplyHardRules(plain, dossier, clientMessage);
}

function countProspectAutoReplies(dossier: any): number {
  return (dossier.communications || []).filter(
    (c: any) => c.direction === "outbound" && /camille/i.test(String(c.from || "")),
  ).length;
}

function getProspectMaxAutoReplies(): number {
  const n = Number(process.env.CAMILLE_PROSPECT_MAX_AUTO_REPLIES || "8");
  return Number.isFinite(n) && n > 0 ? n : 8;
}

function headerValue(headers: any[] | undefined, name: string): string {
  const h = headers?.find((x: any) => String(x.name || "").toLowerCase() === name.toLowerCase());
  return String(h?.value || "");
}

/** Scan des mails entrants vers assurance@ de personnes inconnues → pré-dossier + réponse Camille. */
export async function syncProspectInboundFromGmail(
  gmail: any,
  db: { dossiers: any[] },
  deps: {
    processedIds: Set<string>;
    accessToken: string | null;
    aiCallback: Function;
    markDossierDirty: (d: any) => void;
    persistLead?: (d: any) => Promise<boolean>;
    upsertCommunication: (d: any, msg: any) => boolean;
    getProcessedIds: (d: any) => Set<string>;
    markProcessed: (d: any, id: string) => boolean;
    decodeEmailBodies: (payload: any) => { text: string; html: string };
    isAiAutoReplyEnabled: () => boolean;
    canCamilleEmailClient: (
      d: any,
      o?: { allowIfUnansweredInbound?: boolean; inboundGmailId?: string },
    ) => { ok: boolean; reason?: string };
    acquireCamilleClientEmailLock: (id: string) => Promise<boolean>;
    releaseCamilleClientEmailLock: (id: string) => Promise<void>;
    sendEmailReplyWithGmailAPI: (
      token: string | null,
      to: string,
      subject: string,
      html: string,
    ) => Promise<{ ok: boolean; messageId?: string; error?: string }>;
    getCamilleReplyDelayMs: () => number;
    sleep: (ms: number) => Promise<void>;
  },
): Promise<{ inbound: number; aiReplies: number; leadsCreated: number }> {
  if (!isProspectInboundEnabled()) {
    if (isCamilleTestMode()) {
      console.warn(
        "[Camille prospect] désactivé — CAMILLE_TEST_MODE ou CAMILLE_PROSPECT_INBOUND_ENABLED requis.",
      );
    }
    return { inbound: 0, aiReplies: 0, leadsCreated: 0 };
  }

  const gmailUser = String(process.env.GMAIL_USER || "assurance@leclubimmobilier.fr").toLowerCase();
  const scanDays = Number(
    process.env.CAMILLE_PROSPECT_SCAN_DAYS || (isCamilleTestMode() ? "7" : "2"),
  );
  const maxLeadAgeH = Number(
    process.env.CAMILLE_PROSPECT_MAX_LEAD_AGE_H || (isCamilleTestMode() ? "72" : "48"),
  );
  const maxReplyAgeH = Number(process.env.CAMILLE_PROSPECT_MAX_REPLY_AGE_H || "24");
  const q = `(to:${gmailUser} OR deliveredto:${gmailUser}) newer_than:${scanDays}d -in:spam -in:trash ${buildProspectGmailQueryExtras()}`;
  if (isCamilleTestMode()) {
    console.log(`[Camille prospect] scan start mailbox=${gmailUser} q="${q}"`);
  }

  const messageIds: string[] = [];
  let pageToken: string | undefined;
  const maxScan = Number(process.env.CAMILLE_PROSPECT_SCAN_MAX || "40");
  while (messageIds.length < maxScan) {
    const listRes = await gmail.users.messages.list({
      userId: "me",
      q,
      maxResults: Math.min(50, maxScan - messageIds.length),
      pageToken,
    });
    for (const m of listRes.data.messages || []) {
      if (m.id) messageIds.push(m.id);
    }
    pageToken = listRes.data.nextPageToken || undefined;
    if (!pageToken) break;
  }

  const datedMessages: Array<{ id: string; internalDate: number }> = [];
  for (const id of messageIds) {
    try {
      const metaRes = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: ["From"],
      });
      datedMessages.push({
        id,
        internalDate: Number(metaRes.data.internalDate || 0),
      });
    } catch {
      datedMessages.push({ id, internalDate: 0 });
    }
  }
  datedMessages.sort((a, b) => a.internalDate - b.internalDate || a.id.localeCompare(b.id));
  const messages = datedMessages.map((m) => ({ id: m.id }));

  let inbound = 0;
  let aiReplies = 0;
  let leadsCreated = 0;
  const maxProspectsPerCycle = Number(process.env.CAMILLE_PROSPECT_MAX_PER_SYNC || "3");
  let prospectsHandled = 0;
  const skipReasons = {
    alreadySynced: 0,
    sent: 0,
    ignoredSender: 0,
    automated: 0,
    knownClient: 0,
    fullDossier: 0,
    tooOld: 0,
    sendGateBlocked: 0,
    aiDisabled: 0,
    replyTooOld: 0,
  };

  for (const msgMeta of messages) {
    if (!msgMeta.id || deps.processedIds.has(msgMeta.id)) {
      if (msgMeta.id) skipReasons.alreadySynced += 1;
      continue;
    }

    const metaRes = await gmail.users.messages.get({
      userId: "me",
      id: msgMeta.id,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "To", "Delivered-To", "Auto-Submitted", "Precedence", "List-Unsubscribe"],
    });
    const metaPayload = metaRes.data.payload;
    const metaLabelIds = metaRes.data.labelIds || [];
    if (metaLabelIds.includes("SENT")) {
      skipReasons.sent += 1;
      continue;
    }
    const metaHeaders = metaPayload?.headers || [];
    const fromHeaderMeta = metaHeaders.find((h: any) => h.name?.toLowerCase() === "from");
    const senderEmailMeta = extractSenderEmail(fromHeaderMeta?.value || "");
    const metaClass = classifyInboundEmail(
      {
        fromRaw: fromHeaderMeta?.value,
        toRaw: headerValue(metaHeaders, "To"),
        deliveredToRaw: headerValue(metaHeaders, "Delivered-To"),
        subject: headerValue(metaHeaders, "Subject"),
        autoSubmitted: headerValue(metaHeaders, "Auto-Submitted"),
        precedence: headerValue(metaHeaders, "Precedence"),
        listUnsubscribe: headerValue(metaHeaders, "List-Unsubscribe"),
      },
      { requireAssuranceMailbox: true },
    );
    if (!senderEmailMeta || metaClass.ignore || metaClass.category === "insurer") {
      if (metaClass.category === "automated" || metaClass.category === "insurer") {
        skipReasons.automated += 1;
      } else skipReasons.ignoredSender += 1;
      if (isCamilleTestMode() && metaClass.ignore) {
        console.log(`[Camille prospect] ignoré (${metaClass.reason})`);
      }
      continue;
    }
    if (findNonLeadDossierByCorrespondenceEmail(db, senderEmailMeta)) {
      skipReasons.knownClient += 1;
      continue;
    }

    const msgRes = await gmail.users.messages.get({
      userId: "me",
      id: msgMeta.id,
      format: "full",
    });
    const payload = msgRes.data.payload;
    if (!payload?.headers) continue;

    const labelIds = msgRes.data.labelIds || [];
    if (labelIds.includes("SENT")) {
      skipReasons.sent += 1;
      continue;
    }

    const fromHeader = payload.headers.find((h: any) => h.name?.toLowerCase() === "from");
    const subjectHeader = payload.headers.find((h: any) => h.name?.toLowerCase() === "subject");
    const fromRaw = fromHeader?.value || "";
    const senderEmail = extractSenderEmail(fromRaw);
    const subject = subjectHeader?.value || "";
    const fullClass = classifyInboundEmail(
      {
        fromRaw,
        toRaw: headerValue(payload.headers, "To"),
        deliveredToRaw: headerValue(payload.headers, "Delivered-To"),
        subject,
        autoSubmitted: headerValue(payload.headers, "Auto-Submitted"),
        precedence: headerValue(payload.headers, "Precedence"),
        listUnsubscribe: headerValue(payload.headers, "List-Unsubscribe"),
      },
      { requireAssuranceMailbox: true },
    );

    if (!senderEmail || fullClass.ignore || fullClass.category === "insurer") {
      if (fullClass.category === "automated" || fullClass.category === "insurer") {
        skipReasons.automated += 1;
      } else skipReasons.ignoredSender += 1;
      continue;
    }
    if (findNonLeadDossierByCorrespondenceEmail(db, senderEmail)) {
      skipReasons.knownClient += 1;
      if (isCamilleTestMode()) {
        console.log(`[Camille prospect] ignoré (client connu): ${senderEmail}`);
      }
      continue;
    }

    deps.processedIds.add(msgMeta.id);

    const msgDate = new Date(Number(msgRes.data.internalDate || Date.now())).toISOString();
    const msgAgeH = (Date.now() - new Date(msgDate).getTime()) / (3600 * 1000);

    const linkedFull = findNonLeadDossierByCorrespondenceEmail(db, senderEmail);
    if (linkedFull) {
      skipReasons.fullDossier += 1;
      if (isCamilleTestMode()) {
        console.log(
          `[Camille prospect] ignoré (dossier client ${linkedFull.id}): ${senderEmail}`,
        );
      }
      continue;
    }

    let dossier = findLeadDossierByEmail(db, senderEmail);
    if (!dossier && msgAgeH > maxLeadAgeH) {
      skipReasons.tooOld += 1;
      continue;
    }

    if (!dossier) {
      dossier = createLeadDossierFromInbound(db, senderEmail, fromRaw);
      leadsCreated += 1;
      deps.markDossierDirty(dossier);
      if (deps.persistLead) {
        await deps.persistLead(dossier);
      }
      void import("./telegramNotify")
        .then(({ notifyTelegramNewDossier }) =>
          notifyTelegramNewDossier({
            dossier,
            clientEmail: senderEmail,
            clientName: [dossier.formData?.assures?.[0]?.prenom, dossier.formData?.assures?.[0]?.nom]
              .filter(Boolean)
              .join(" "),
          }),
        )
        .catch(() => undefined);
      if (isCamilleTestMode()) {
        console.log(`[Camille prospect] nouveau prospect ${dossier.id} (${senderEmail})`);
      }
    }

    prospectsHandled += 1;

    const { text, html } = deps.decodeEmailBodies(payload);

    let msgChanged = false;
    const commInserted = deps.upsertCommunication(dossier, {
      id: `msg_${msgMeta.id}`,
      gmailId: msgMeta.id,
      direction: "inbound",
      from: senderEmail,
      subject,
      text,
      html: html || undefined,
      date: msgDate,
    });
    if (commInserted) {
      msgChanged = true;
      void import("./telegramNotifyDedup")
        .then(async ({ wasTelegramNotifiedRecently, markTelegramNotified, telegramNotifyKey }) => {
          const tgKey = telegramNotifyKey(dossier.id, "prospect_inbound", msgMeta.id);
          if (wasTelegramNotifiedRecently(dossier, tgKey, 24 * 60 * 60 * 1000)) return;
          markTelegramNotified(dossier, tgKey);
          const { notifyTelegramClientInbound } = await import("./telegramNotify");
          const { extractNewClientMessageText } = await import("./emailQuoteStrip");
          await notifyTelegramClientInbound({
            dossier,
            clientEmail: senderEmail,
            subject,
            excerpt: extractNewClientMessageText(String(text || "")).slice(0, 500),
            gmailId: msgMeta.id,
            extra: "Prospect pré-étude",
          });
        })
        .catch(() => undefined);
    }

    const alreadyHandled = deps.getProcessedIds(dossier).has(msgMeta.id);
    const allowAutoReply = msgAgeH <= maxReplyAgeH;
    if (!allowAutoReply && !alreadyHandled) {
      skipReasons.replyTooOld += 1;
      deps.markProcessed(dossier, msgMeta.id);
      msgChanged = true;
    }
    if (!alreadyHandled && !deps.isAiAutoReplyEnabled()) {
      skipReasons.aiDisabled += 1;
    }
    const prospectReplyCount = countProspectAutoReplies(dossier);
    const prospectReplyLimit = getProspectMaxAutoReplies();
    if (!alreadyHandled && allowAutoReply && prospectReplyCount >= prospectReplyLimit) {
      skipReasons.sendGateBlocked += 1;
      deps.markProcessed(dossier, msgMeta.id);
      msgChanged = true;
      if (isCamilleTestMode()) {
        console.log(
          `[Camille prospect] limite ${prospectReplyLimit} réponse(s) atteinte pour ${dossier.id}`,
        );
      }
    } else if (!alreadyHandled && allowAutoReply && deps.isAiAutoReplyEnabled()) {
      const { isReviewBlockingAutoReply } = await import("./camilleReviewQueue");
      if (isReviewBlockingAutoReply(dossier)) {
        continue;
      }

      inbound += 1;
      const sendGate = deps.canCamilleEmailClient(dossier, {
        allowIfUnansweredInbound: true,
        inboundGmailId: msgMeta.id,
      });
      const lockOk = sendGate.ok ? await deps.acquireCamilleClientEmailLock(dossier.id) : false;
      if (sendGate.ok && lockOk) {
        try {
          await deps.sleep(deps.getCamilleReplyDelayMs());
          const aiDecision = await deps.aiCallback(dossier, text, senderEmail, {
            emailSubject: subject,
            allDossiers: db.dossiers,
            gmailId: msgMeta.id,
            isProspectLead: true,
          });

          if (aiDecision?.status === "replied" && aiDecision.text) {
            const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
            const sent = await deps.sendEmailReplyWithGmailAPI(
              deps.accessToken,
              senderEmail,
              replySubject,
              aiDecision.text,
            );
            if (sent.ok) {
              deps.markProcessed(dossier, msgMeta.id);
              msgChanged = true;
              aiReplies += 1;
              dossier.status = "PROSPECT";
              (dossier as any).isLead = true;
              deps.upsertCommunication(dossier, {
                id: `msg_camille_${msgMeta.id}`,
                gmailId: sent.messageId,
                direction: "outbound",
                from: "Camille (IA)",
                to: senderEmail,
                subject: replySubject,
                text: aiDecision.replyPlain || "",
                date: new Date().toISOString(),
              });
              addEvent(dossier, {
                type: "AI_DECISION",
                actor: { kind: "AI", label: "Camille" },
                message: "Réponse prospect pré-étude envoyée.",
                meta: { gmailId: msgMeta.id, lead: true },
              });
              void import("./telegramNotify")
                .then(({ notifyTelegramCamilleReplied }) =>
                  notifyTelegramCamilleReplied({
                    dossier,
                    subject: replySubject,
                    gmailId: sent.messageId || msgMeta.id,
                    extra: "Prospect pré-étude",
                    camilleAction: aiDecision.telegramAction,
                  }),
                )
                .catch(() => undefined);
            } else {
              console.warn(
                `[Camille prospect] échec envoi Gmail ${dossier.id} (${senderEmail}): ${sent.error || "?"}`,
              );
            }
          } else if (aiDecision?.status === "review" && aiDecision.questionForStaff) {
            const { createCamilleReviewRequest } = await import("./camilleReviewQueue");
            const reviewResult = await createCamilleReviewRequest({
              dossier,
              gmailId: msgMeta.id,
              clientEmail: senderEmail,
              emailSubject: subject,
              clientMessage: text,
              questionForStaff: aiDecision.questionForStaff,
              reason: aiDecision.reason,
            });
            if (reviewResult.ok) {
              msgChanged = true;
              addEvent(dossier, {
                type: "AI_DECISION",
                actor: { kind: "AI", label: "Camille" },
                message: "Question prospect envoyée sur Telegram — en attente de votre consigne.",
                meta: { gmailId: msgMeta.id, reviewId: reviewResult.reviewId, lead: true },
              });
            } else {
              addEvent(dossier, {
                type: "AI_DECISION",
                actor: { kind: "AI", label: "Camille" },
                message: `Review prospect impossible (${reviewResult.error}) — escalade.`,
                meta: { gmailId: msgMeta.id, lead: true },
              });
              const { handleCamilleEscalation } = await import("./camilleEscalation");
              await handleCamilleEscalation({
                dossier,
                accessToken: deps.accessToken,
                clientEmail: senderEmail,
                clientPrenom: dossier.formData?.assures?.[0]?.prenom,
                subject,
                reason: String(
                  aiDecision.reason || aiDecision.questionForStaff || "Review prospect impossible",
                ),
                clientMessageText: text,
                gmailId: msgMeta.id,
              });
              deps.markProcessed(dossier, msgMeta.id);
              msgChanged = true;
            }
          } else if (aiDecision?.status === "escalated") {
            const { handleCamilleEscalation } = await import("./camilleEscalation");
            await handleCamilleEscalation({
              dossier,
              accessToken: deps.accessToken,
              clientEmail: senderEmail,
              clientPrenom: dossier.formData?.assures?.[0]?.prenom,
              subject,
              reason: String(aiDecision.reason || "Escalade prospect"),
              clientMessageText: text,
              gmailId: msgMeta.id,
            });
            deps.markProcessed(dossier, msgMeta.id);
            msgChanged = true;
          }
        } finally {
          await deps.releaseCamilleClientEmailLock(dossier.id);
        }
      } else if (!alreadyHandled) {
        if (!sendGate.ok) {
          skipReasons.sendGateBlocked += 1;
        } else if (!lockOk) {
          skipReasons.sendGateBlocked += 1;
          console.warn(
            `[Camille prospect] verrou email indisponible — réponse reportée: ${dossier.id} (${senderEmail})`,
          );
        }
        if (isCamilleTestMode()) {
          console.log(
            `[Camille prospect] pas de réponse (${sendGate.reason || (lockOk ? "gate" : "lock")}): ${senderEmail} → ${dossier.id} msg=${msgMeta.id}`,
          );
        }
      }
    } else if (!alreadyHandled && !deps.isAiAutoReplyEnabled()) {
      deps.markProcessed(dossier, msgMeta.id);
      msgChanged = true;
    }

    if (msgChanged) {
      deps.markDossierDirty(dossier);
      if (deps.persistLead) {
        await deps.persistLead(dossier);
      }
    }

    if (prospectsHandled >= maxProspectsPerCycle) {
      if (isCamilleTestMode()) {
        console.log(`[Camille prospect] limite ${maxProspectsPerCycle} prospect(s)/cycle — suite au prochain sync`);
      }
      break;
    }
  }

  if (leadsCreated > 0 || inbound > 0 || isCamilleTestMode()) {
    console.log(
      `[Camille prospect] scanned=${messages.length} inbound=${inbound} leadsCreated=${leadsCreated} aiReplies=${aiReplies} skips=${JSON.stringify(skipReasons)}`,
    );
  } else if (skipReasons.knownClient === messages.length && messages.length > 0) {
    console.log(
      `[Camille prospect] scanned=${messages.length} — tous expéditeurs déjà connus (supprimez le dossier ou renvoyez un mail test).`,
    );
  }

  return { inbound, aiReplies, leadsCreated };
}
