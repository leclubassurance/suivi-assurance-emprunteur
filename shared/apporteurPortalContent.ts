import type { ApporteurType } from "./apporteurTypes";

export const BRAND_NAME = "Le Club Immobilier Français";

export const TRANSPARENCY_SCRIPT =
  "En cas de changement effectué, je perçois une rémunération de la part du Club Immobilier Français, sans surcoût pour vous.";

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

Je me permets de vous écrire : beaucoup d'emprunteurs paient encore trop cher leur assurance de prêt, souvent sans le savoir. Depuis la loi Lemoine, un changement est possible à tout moment.

Le Club Immobilier Français (courtier ORIAS) propose une analyse gratuite et sans engagement de votre assurance emprunteur. En cas de changement effectif, des frais de courtage s'appliquent — le montant exact vous est indiqué dans l'étude avant toute décision. En une dizaine de minutes en ligne, vous déposez vos documents ; leur équipe vous envoie une étude claire avec les économies possibles. Vous décidez ensuite librement.

Lien pour démarrer : ${params.referralLink}

N'hésitez pas si vous avez la moindre question.${signature}`;
}

export function getHeroCopy(_type: ApporteurType): { title: string; subtitle: string } {
  return {
    title: "Recommandez en 2 minutes",
    subtitle:
      "Proposez à vos contacts une étude gratuite de leur assurance emprunteur. Le Club Immobilier Français assure le suivi complet ; vous êtes rémunéré à la réussite du dossier.",
  };
}

export function getBenefitCards(payoutPerSignatureEur: number) {
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
        "50 % des frais de courtage du Club",
      ],
    },
  ] as const;
}
