/**
 * Couche intention prospect — heuristiques rapides (pas de 2ᵉ appel LLM).
 * Alimente la stratégie de rédaction et les garde-fous qualité.
 */
import { extractNewClientMessageText } from "./emailQuoteStrip";
import { detectMentionedKereisPartner } from "../shared/kereisPartners";
import { assessProspectRisk } from "./prospectConfidence";

export type ProspectMessageIntent =
  | "greeting"
  | "faq_insurance"
  | "faq_process"
  | "insurers"
  | "documents"
  | "wants_study"
  | "relational"
  | "off_topic"
  | "pricing"
  | "medical_legal"
  | "aggressive"
  | "refusal"
  | "club_identity"
  | "multi"
  | "unclear";

export type ProspectIntentAnalysis = {
  intents: ProspectMessageIntent[];
  primary: ProspectMessageIntent;
  shouldIncludeFormLink: boolean;
  /** Blocage immédiat pré-LLM — réservé aux cas graves (menace). */
  shouldForceReview: boolean;
  strategyBlock: string;
  formLinkReason?: string;
  reviewReason?: string;
  riskFlags: string[];
  confidenceHint: number;
};

function freshMessage(clientMessage: string): string {
  return extractNewClientMessageText(String(clientMessage || "")).trim();
}

function freshLower(clientMessage: string): string {
  return freshMessage(clientMessage).toLowerCase();
}

export function isPureGreetingMessage(clientMessage?: string): boolean {
  const msg = freshLower(clientMessage || "");
  if (!msg || msg.length > 80) return false;
  return /^(bonjour|bonsoir|salut|hello|coucou|bonne journ[ée]e|bonne soir[ée]e)[\s!.?,]*$/i.test(
    msg,
  );
}

function isRelationalMessage(msgLower: string): boolean {
  return (
    /humaine?|humain|robot|intelligence artificielle|\bia\b|chatgpt|bot\b|automatique|pas une vraie|vraie personne|vous [êe]tes (une )?ia/i.test(
      msgLower,
    ) ||
    (/réactivité|réactif|trop vite|trop rapide/i.test(msgLower) &&
      /humaine?|humain|robot|\bia\b|automatique/i.test(msgLower))
  );
}

function isOffTopicMessage(msgLower: string): boolean {
  if (isRelationalMessage(msgLower)) return false;
  return (
    /météo|meteo|weather|quel temps|quelle météo|quelle meteo|il va (pleuvoir|faire|neiger)|football|marseille|psg|politique|recette cuisine/i.test(
      msgLower,
    ) || (/blague|rigoler|haha|mdr|lol\b/i.test(msgLower) && !/assurance|prêt|pret|lemoine/i.test(msgLower))
  );
}

function isInsurerQuestion(msgLower: string): boolean {
  return (
    /assurances?\s+(pour\s+)?(lesquel|laquel|quel)/i.test(msgLower) ||
    /avec quels? assureurs|quels? assureurs|compagnies?\s+d.assurance/i.test(msgLower) ||
    /partenaires?\s+(assurance|assureur)/i.test(msgLower) ||
    /travaillez avec quels/i.test(msgLower) ||
    Boolean(detectMentionedKereisPartner(msgLower))
  );
}

function isInformationNeedQuestion(msgLower: string): boolean {
  if (
    /il a besoin de quelques informations|de quelques informations|quelques informations\s*\?/.test(
      msgLower,
    )
  ) {
    return true;
  }
  return (
    /de quoi a.t.il besoin|de quelles informations|il a besoin|il vous faut quoi|que faut.il|qu'est.ce qu'il (vous )?faut|de quoi avez.vous besoin|quels documents|quelles pi[eè]ces|vous avez besoin de quoi/i.test(
      msgLower,
    ) &&
    /charles|étude|etude|information|document|prêt|pret|assurance|lancer|démarrer|demarrer|besoin/i.test(
      msgLower,
    )
  );
}

function isDocumentsQuestion(msgLower: string): boolean {
  if (isInformationNeedQuestion(msgLower)) return true;
  return (
    /document|offre de prêt|tableau d.amortissement|échéancier|echeancier|espace bancaire|espace banque|pdf|joindre|pi[eè]ce jointe|envoy(er|ez)|transmettre/i.test(
      msgLower,
    ) && /prêt|pret|assurance|étude|etude|formulaire|dossier/i.test(msgLower)
  );
}

function isWantsStudy(msgLower: string): boolean {
  if (
    /je suis intéress|intéressé|comment (je )?(doit|dois) procéder|comment procéder|comment faire|quelle est la suite|la marche à suivre|je veux (avancer|continuer|démarrer|demarrer)/i.test(
      msgLower,
    )
  ) {
    return true;
  }
  return (
    /je (veux|souhaite|voudrais)|on peut commencer|lancer (l')?étude|démarrer|demarrer|commencer (l')?étude|envoyer (mon|mes) (dossier|documents)|faire l'étude/i.test(
      msgLower,
    ) && /étude|etude|dossier|formulaire|commencer|démarrer|demarrer|optimis|économ/i.test(msgLower)
  );
}

function isFaqInsurance(msgLower: string): boolean {
  return (
    /lemoine|délégation|delegation|obligatoire|assurance emprunteur|c'est quoi|qu'est.ce|quest.ce|garantie|décès|deces|invalidité|invalidite|incapacité|incapacite|changer d.assurance|comparateur/i.test(
      msgLower,
    ) ||
    (/gratuit|sans engagement|payant/i.test(msgLower) &&
      /étude|etude|assurance|prêt|pret/i.test(msgLower))
  );
}

function isFaqProcess(msgLower: string): boolean {
  return (
    /combien de temps|délai|delai|quand|comment (ça|ca) (marche|fonctionne)|étapes?|processus|fonctionnement/i.test(
      msgLower,
    ) && /étude|etude|dossier|assurance|prêt|pret/i.test(msgLower)
  );
}

function isPricingQuestion(msgLower: string): boolean {
  return (
    /combien (je |j')?(gagn|économ|econom)|montant|€|euro|mensualit|co[uû]t|tarif|chiffr|devis|économie possible/i.test(
      msgLower,
    ) && !/gratuit|sans engagement/i.test(msgLower)
  );
}

/** Pathologie / litige explicite — pas le mot « santé » seul (FAQ assurance courante). */
function isMedicalLegal(msgLower: string): boolean {
  if (
    /cancer|maladie grave|pathologie chronique|contentieux|avocat|tribunal|plainte|réclamation officielle|discrimination|refus médical|surprime (médicale|santé)|exclusion (médicale|santé)/i.test(
      msgLower,
    )
  ) {
    return true;
  }
  if (/(antécédent|antecedent).*(médical|santé|maladie)/i.test(msgLower)) return true;
  if (/questionnaire (de )?santé|qs (médical|santé)/i.test(msgLower) && /\?/.test(msgLower)) {
    if (/lemoine|délégation|delegation|garantie|couverture|équivalent|equivalent/i.test(msgLower)) {
      return false;
    }
    return true;
  }
  return false;
}

function isAggressive(msgLower: string): boolean {
  return (
    /arnaque|escroc|honte|inadmissible|menace|harcèlement|harcelement|insulte|nul\b|merde|connard|idiot/i.test(
      msgLower,
    ) || (/!!+/.test(msgLower) && /réclamation|plainte|scandale/i.test(msgLower))
  );
}

function isRefusal(msgLower: string): boolean {
  return (
    /ne plus (me )?contacter|laissez.moi tranquille|pas intéress|pas interesse|stop\b|désinscri|desinscri|ne souhaite plus|sans suite|arrêtez|arretez|retrait rgpd|supprimer mes données/i.test(
      msgLower,
    )
  );
}

function isClubIdentity(msgLower: string): boolean {
  if (isInformationNeedQuestion(msgLower) || isDocumentsQuestion(msgLower)) return false;
  return (
    /club immobilier|le club|qui [êe]tes.vous|pourquoi (vous )?m.contact|pourquoi (vous )?m.écri|agence immo|vous faites quoi|faites de l.immobilier/i.test(
      msgLower,
    ) && !isInsurerQuestion(msgLower)
  );
}

function countIntentSignals(msgLower: string): number {
  let n = 0;
  if (isPureGreetingMessage(msgLower)) n += 1;
  if (isRelationalMessage(msgLower)) n += 1;
  if (isOffTopicMessage(msgLower)) n += 1;
  if (isInsurerQuestion(msgLower)) n += 1;
  if (isDocumentsQuestion(msgLower)) n += 1;
  if (isWantsStudy(msgLower)) n += 1;
  if (isFaqInsurance(msgLower)) n += 1;
  if (isFaqProcess(msgLower)) n += 1;
  if (isPricingQuestion(msgLower)) n += 1;
  if (isClubIdentity(msgLower)) n += 1;
  return n;
}

const INTENT_PRIORITY: ProspectMessageIntent[] = [
  "aggressive",
  "medical_legal",
  "refusal",
  "pricing",
  "wants_study",
  "documents",
  "insurers",
  "club_identity",
  "faq_insurance",
  "faq_process",
  "relational",
  "off_topic",
  "greeting",
  "unclear",
];

function pickPrimary(intents: ProspectMessageIntent[]): ProspectMessageIntent {
  if (intents.includes("multi")) {
    for (const p of INTENT_PRIORITY) {
      if (p !== "multi" && p !== "unclear" && intents.includes(p)) return p;
    }
  }
  for (const p of INTENT_PRIORITY) {
    if (intents.includes(p)) return p;
  }
  return intents[0] || "unclear";
}

function buildStrategyLines(
  intents: ProspectMessageIntent[],
  primary: ProspectMessageIntent,
  shouldIncludeFormLink: boolean,
  riskFlags: string[],
  confidenceHint: number,
): string[] {
  const lines: string[] = [
    `INTENTIONS DÉTECTÉES : ${intents.join(", ")}`,
    `INTENTION PRINCIPALE : ${primary}`,
    `RISQUES DÉTECTÉS : ${riskFlags.join(", ")}`,
    `INDICE CONFIANCE (heuristique) : ${confidenceHint}/10`,
    "",
    "STRATÉGIE DE RÉPONSE (prioritaire sur les réflexes commerciaux) :",
    "- Tu es experte assurance emprunteur (Kereis, Loi Lemoine, Club Immobilier Français) : action par défaut REPLY.",
    "- REVIEW uniquement si tu ne peux pas répondre honnêtement (confiance < 5) ou menace/litige actif.",
    "- Sujet médical/juridique prospect : réponds au niveau FAQ (questionnaire, Lemoine, Charles après formulaire) — pas de REVIEW pour ça seul.",
  ];

  if (intents.includes("greeting") && intents.length <= 2) {
    lines.push(
      "- Salutation simple : 2 à 4 phrases chaleureuses, UNE question ouverte sur son projet ou ses questions.",
      "- INTERDIT sur ce mail : lien formulaire, offre de prêt, tableau d'amortissement, « gratuite et sans engagement » en bloc marketing.",
    );
  }

  if (intents.includes("relational")) {
    lines.push(
      "- Question humain/IA : répondre franchement (Camille = assistante email, Charles = conseiller études). Pas de déni.",
      "- Ne pas enchaîner sur un pavé documents si ce n'était pas le sujet.",
    );
  }

  if (intents.includes("off_topic")) {
    lines.push(
      "- Hors-sujet (météo, etc.) : une phrase honnête (« ce n'est pas mon périmètre »), sans inventer de fait.",
      "- Redirection douce vers l'assurance emprunteur si naturel — pas de formulaire forcé.",
    );
  }

  if (intents.includes("insurers")) {
    lines.push(
      "- Assureurs : Kereis Prévoyance + 2 à 4 exemples max, contrats particuliers / tarifs privilégiés.",
      "- Liste complète demandée → Charles communiquera la suite. Jamais 5+ noms ni codes produits.",
    );
  }

  if (intents.includes("documents") || intents.includes("wants_study")) {
    lines.push(
      "- Documents / démarrage : expliquer brièvement, puis lien formulaire OBLIGATOIRE.",
      "- Dire explicitement : ne pas envoyer les PDF en réponse à ce mail.",
    );
  }

  if (intents.includes("faq_insurance") || intents.includes("faq_process")) {
    lines.push(
      "- Question métier : répondre au fond en 3 à 8 phrases, avec vos mots (pas un script).",
      "- Pas de chiffre d'économie personnalisé avant formulaire complété.",
    );
  }

  if (intents.includes("pricing")) {
    lines.push(
      "- Chiffrage : pas de montant inventé. Charles chiffre après offre + tableau via le formulaire.",
      "- Si insistance ou cas complexe → REVIEW.",
    );
  }

  if (intents.includes("club_identity")) {
    lines.push(
      "- Identité Club / agence : 2 à 4 phrases (réseau immobilier + accompagnement assurance emprunteur), seulement si demandé.",
    );
  }

  if (intents.includes("refusal")) {
    lines.push(
      "- Refus / stop : clôture polie et respectueuse, sans relance commerciale ni formulaire.",
    );
  }

  if (intents.includes("multi")) {
    lines.push(
      "- Mail multi-sujets : traiter CHAQUE point dans l'ordre, en phrases distinctes (humour, IA, météo, assurance…).",
    );
  }

  if (shouldIncludeFormLink) {
    lines.push(`- Inclure le lien formulaire (URL fournie dans le contexte).`);
  } else {
    lines.push(
      `- Ne PAS inclure le lien formulaire sur ce mail (le client n'a pas demandé à démarrer ni parlé de documents).`,
    );
  }

  lines.push(
    "",
    "- Toujours : répondre d'abord à ce qu'il/elle a écrit ; ton humain ; référence LCIF en fin de mail.",
  );

  return lines;
}

export function analyzeProspectMessageIntent(clientMessage: string): ProspectIntentAnalysis {
  const fresh = freshMessage(clientMessage);
  const msgLower = fresh.toLowerCase();
  const intents: ProspectMessageIntent[] = [];

  if (isAggressive(msgLower)) intents.push("aggressive");
  if (isMedicalLegal(msgLower)) intents.push("medical_legal");
  if (isRefusal(msgLower)) intents.push("refusal");
  if (isPricingQuestion(msgLower)) intents.push("pricing");
  if (isWantsStudy(msgLower)) intents.push("wants_study");
  if (isDocumentsQuestion(msgLower)) intents.push("documents");
  if (isInsurerQuestion(msgLower)) intents.push("insurers");
  if (isClubIdentity(msgLower)) intents.push("club_identity");
  if (isFaqInsurance(msgLower)) intents.push("faq_insurance");
  if (isFaqProcess(msgLower)) intents.push("faq_process");
  if (isRelationalMessage(msgLower)) intents.push("relational");
  if (isOffTopicMessage(msgLower)) intents.push("off_topic");
  if (isPureGreetingMessage(fresh)) intents.push("greeting");

  const signalCount = countIntentSignals(msgLower);
  if (signalCount >= 2 && intents.length >= 2) {
    if (!intents.includes("multi")) intents.unshift("multi");
  }

  if (intents.length === 0) {
    if (fresh.length <= 40 && !/\?/.test(fresh)) {
      intents.push("greeting");
    } else if (/\?/.test(fresh)) {
      intents.push("unclear");
    } else {
      intents.push("unclear");
    }
  }

  const primary = pickPrimary(intents);

  const formLinkIntents: ProspectMessageIntent[] = [
    "documents",
    "wants_study",
  ];
  const blocksFormLink =
    (intents.includes("greeting") && !intents.some((i) => formLinkIntents.includes(i))) ||
    (intents.includes("off_topic") &&
      !intents.some((i) => [...formLinkIntents, "faq_insurance", "insurers", "pricing"].includes(i))) ||
    intents.includes("refusal") ||
    (intents.includes("relational") &&
      intents.length <= 2 &&
      !intents.some((i) => formLinkIntents.includes(i)));

  const shouldIncludeFormLink =
    !blocksFormLink &&
    (intents.some((i) => formLinkIntents.includes(i)) ||
      isInformationNeedQuestion(msgLower) ||
      isWantsStudy(msgLower) ||
      isDocumentsQuestion(msgLower) ||
      (intents.includes("faq_process") &&
        (isDocumentsQuestion(msgLower) ||
          /comment|procéder|proceder|étape|etape|marche à suivre|suite|démarrer|demarrer/i.test(
            msgLower,
          ))) ||
      (intents.includes("faq_insurance") &&
        (isDocumentsQuestion(msgLower) ||
          /document|formulaire|offre|tableau|procéder|proceder|comment faire/i.test(msgLower))) ||
      (intents.includes("pricing") && /document|formulaire|offre|tableau/i.test(msgLower)));

  let formLinkReason: string | undefined;
  if (shouldIncludeFormLink) {
    formLinkReason = intents.includes("wants_study")
      ? "client souhaite démarrer"
      : intents.includes("documents")
        ? "question sur les documents"
        : "contexte étude/documents";
  }

  const shouldForceReview = intents.includes("aggressive");

  let reviewReason: string | undefined;
  if (shouldForceReview) {
    reviewReason = "message agressif ou menaçant";
  }

  const uniqueIntents = [...new Set(intents)];
  const risk = assessProspectRisk(fresh, uniqueIntents);

  const strategyBlock = buildStrategyLines(
    intents,
    primary,
    shouldIncludeFormLink,
    risk.riskFlags,
    risk.confidenceHint,
  ).join("\n");

  return {
    intents: uniqueIntents,
    primary,
    shouldIncludeFormLink,
    shouldForceReview,
    strategyBlock,
    formLinkReason,
    reviewReason,
    riskFlags: risk.riskFlags,
    confidenceHint: risk.confidenceHint,
  };
}

/** Qualité : formulaire inapproprié selon l'intention du message client. */
export function prospectReplyHasInappropriateFormLink(
  plain: string,
  analysis: ProspectIntentAnalysis,
): boolean {
  if (analysis.shouldIncludeFormLink) return false;
  const lower = String(plain || "").toLowerCase();
  // Lien formulaire requis si la réponse parle de documents prêt (injection code ou LLM).
  if (
    /offre de prêt|tableau d.amortissement|formulaire en ligne|formulaire sécurisé|ne pas envoyer.*mail|inutile de les envoyer/i.test(
      lower,
    )
  ) {
    return false;
  }
  return (
    /formulaire|assurance-emprunteur\.up\.railway\.app/i.test(lower) ||
    (/offre de prêt|tableau d.amortissement/i.test(lower) &&
      /déposer|deposer|compléter|completer|lien/i.test(lower))
  );
}

export function prospectReplyMatchesIntentStrategy(
  plain: string,
  clientMessage: string,
  analysis: ProspectIntentAnalysis,
): string[] {
  const issues: string[] = [];
  const text = String(plain || "").toLowerCase();
  const fresh = freshLower(clientMessage);

  if (prospectReplyHasInappropriateFormLink(plain, analysis)) {
    issues.push("lien formulaire ou push documents inapproprié pour l'intention détectée");
  }

  if (analysis.intents.includes("greeting") && analysis.intents.length <= 2) {
    const commercialHits = [
      /formulaire/,
      /pdf/,
      /tableau d.amortissement/,
      /offre de prêt/,
      /gratuite et sans engagement/,
      /complétez le formulaire/,
    ].filter((re) => re.test(text)).length;
    if (commercialHits >= 1) {
      issues.push("contenu commercial sur un simple bonjour");
    }
    if (
      !text.includes("?") &&
      !/(dites-moi|parlez-moi|de quoi|comment puis-je|souhaitez-vous|puis-je vous|en quoi)/i.test(
        text,
      )
    ) {
      issues.push("pas de question ouverte sur un bonjour");
    }
  }

  if (analysis.intents.includes("relational") || analysis.intents.includes("off_topic")) {
    if (
      /tableau d'amortissement|offre de prêt|complétez le formulaire/i.test(text) &&
      !analysis.shouldIncludeFormLink
    ) {
      issues.push("template documents sur message relationnel ou hors-sujet");
    }
    if (analysis.intents.includes("relational") && !/(camille|assistante|charles|humain|équipe)/i.test(text)) {
      issues.push("question humain/IA non traitée");
    }
    if (analysis.intents.includes("off_topic") && /météo|meteo|weather/i.test(fresh)) {
      if (!/(périmètre|pas mon|assurance emprunteur|prêt|pret)/i.test(text)) {
        issues.push("hors-sujet (ex. météo) non reconnu honnêtement");
      }
    }
  }

  if (analysis.intents.includes("refusal") && /formulaire|démarrer|demarrer|étude gratuite/i.test(text)) {
    issues.push("relance commerciale après un refus");
  }

  if (
    analysis.intents.includes("multi") &&
    text.length < 80 &&
    !/formulaire en ligne|assurance-emprunteur\.up\.railway\.app/i.test(text)
  ) {
    issues.push("réponse trop courte pour un mail multi-sujets");
  }

  return [...new Set(issues)];
}
