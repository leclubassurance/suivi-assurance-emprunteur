import type { ApporteurType } from "./apporteurTypes";

export const BRAND_NAME = "Le Club Immobilier Français";

export const TRANSPARENCY_SCRIPT =
  "En cas de changement effectué, je perçois une rémunération de la part du Club Immobilier Français, sans surcoût pour vous.";

/** Courte explication affichée à côté du bouton « phrase transparence ». */
export const TRANSPARENCY_SCRIPT_HINT =
  "Obligation contractuelle : informer le client que vous êtes rémunéré en cas de changement effectué. Sans surcoût pour lui — à ajouter en fin de message si vous le souhaitez.";

export const TRUST_BADGES = [
  "ORIAS 24002253",
  "Loi Lemoine",
  "Étude gratuite",
  "Sans engagement",
] as const;

export const JOURNEY_STEPS = [
  { key: "reco", label: "Recommandation", desc: "Vous partagez votre lien" },
  { key: "depot", label: "Dépôt client", desc: "~10 min en ligne" },
  { key: "etude", label: "Étude personnalisée", desc: "Analyse par nos équipes" },
  { key: "decision", label: "Décision", desc: "Le client choisit" },
  { key: "change", label: "Changement", desc: "Banque validée" },
] as const;

/** Message WhatsApp prêt à envoyer — prénom client + lien de recommandation. */
export function buildWhatsAppMessage(params: {
  clientPrenom: string;
  referralLink: string;
  partnerContactName?: string;
}): string {
  const raw = params.clientPrenom.trim();
  const greeting = raw ? `Bonjour ${raw}` : "Bonjour";
  const partner = String(params.partnerContactName || "").trim();
  const signature = partner ? `\n\n${partner}` : "";

  return `${greeting},

Beaucoup d'emprunteurs paient encore trop cher leur assurance de prêt, sans forcément le savoir. Depuis la loi Lemoine, vous pouvez la faire étudier et la changer à tout moment — sans attendre une date anniversaire.

Je vous oriente vers Le Club Immobilier Français (courtier ORIAS) : l'étude est gratuite et sans engagement. En une dizaine de minutes en ligne, vous déposez votre offre de prêt et votre tableau d'amortissement ; leur équipe vous envoie ensuite une analyse claire avec les économies possibles. Vous décidez librement de donner suite ou non.

Si vous changez d'assurance, des frais de courtage s'appliquent — le montant exact vous est indiqué dans l'étude, avant tout engagement.

Pour démarrer : ${params.referralLink}

Je reste disponible si vous avez des questions.${signature}`;
}

export function getHeroCopy(type: ApporteurType): { title: string; subtitle: string } {
  if (type === "conseiller_immo_club") {
    return {
      title: "Vos clients, votre suivi",
      subtitle:
        "Orientez vos clients vers une étude gratuite d'assurance emprunteur. Le Club Immobilier Français gère le courtage ; vous conservez la relation et êtes rémunéré à 70 % des frais de courtage.",
    };
  }
  return {
    title: "Recommandez en 2 minutes",
    subtitle:
      "Proposez à vos contacts une étude gratuite de leur assurance emprunteur. Le Club Immobilier Français assure le suivi complet ; vous êtes rémunéré à la réussite du dossier.",
  };
}

export function getBenefitCards(
  payoutPerSignatureEur: number,
  opts?: { payoutSharePercent?: number; isConseiller?: boolean },
) {
  const sharePct = Math.round((opts?.payoutSharePercent ?? (opts?.isConseiller ? 0.7 : 0.5)) * 100);
  return [
    {
      key: "client",
      title: "Pour votre contact",
      lines: [
        "Étude gratuite et personnalisée",
        "Frais de courtage uniquement si changement effectif",
        "Aucun engagement de sa part",
      ],
    },
    {
      key: "you",
      title: "Pour vous",
      lines: [
        "Recommandation en 2 minutes",
        "Le Club Immobilier Français gère le dossier",
        "Vous conservez la relation de confiance",
      ],
    },
    {
      key: "revenue",
      title: "Pour vos revenus",
      lines: [
        `Jusqu'à ${payoutPerSignatureEur} € par dossier signé`,
        "Paiement à réception de la commission assureur",
        `${sharePct} % des frais de courtage du Club`,
      ],
    },
  ] as const;
}
