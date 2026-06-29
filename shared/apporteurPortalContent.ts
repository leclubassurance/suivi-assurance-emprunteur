import type { ApporteurType } from "./apporteurTypes";

export const CLIENT_SCRIPT =
  "Je vous mets en relation avec Le Club Immobilier Français pour une analyse gratuite de votre assurance emprunteur. Si des économies sont possibles, vous recevez une étude claire — vous décidez ensuite, sans engagement.";

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
  { key: "etude", label: "Étude LCIF", desc: "Analyse personnalisée" },
  { key: "decision", label: "Décision", desc: "Le client choisit" },
  { key: "change", label: "Changement", desc: "Banque validée" },
] as const;

export function getHeroCopy(type: ApporteurType): { title: string; subtitle: string } {
  switch (type) {
    case "agent_immo":
      return {
        title: "Offrez un vrai service après l'acte",
        subtitle:
          "Recommandez en 2 minutes : étude gratuite pour votre client, suivi assuré par LCIF, rémunération pour vous à la réussite.",
      };
    case "courtier":
      return {
        title: "Complétez vos dossiers de financement",
        subtitle:
          "Orientez vos emprunteurs vers une étude gratuite d'assurance emprunteur — LCIF gère l'analyse et la souscription.",
      };
    default:
      return {
        title: "Recommandez en 2 minutes, LCIF fait le reste",
        subtitle:
          "Étude gratuite pour votre client, zéro paperasse pour vous. Vous êtes rémunéré quand le changement est effectif.",
      };
  }
}

export function getBenefitCards(payoutPerSignatureEur: number) {
  return [
    {
      key: "client",
      emoji: "🏠",
      title: "Pour votre client",
      lines: ["Étude gratuite et personnalisée", "Économies possibles sur sa cotisation", "Zéro engagement"],
    },
    {
      key: "you",
      emoji: "🤝",
      title: "Pour vous",
      lines: ["Service concret en 2 minutes", "LCIF gère banque et souscription", "Vous gardez la relation client"],
    },
    {
      key: "revenue",
      emoji: "💶",
      title: "Pour vos revenus",
      lines: [
        `Jusqu'à ${payoutPerSignatureEur} € par dossier signé`,
        "Paiement à réception commission assureur",
        "50 % des frais de courtage LCIF",
      ],
    },
  ] as const;
}
