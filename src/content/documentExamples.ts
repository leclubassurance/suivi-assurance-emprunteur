export type DocumentExampleId = "offre" | "tableau" | "fiche" | "contrat";

export type DocumentExample = {
  id: DocumentExampleId;
  title: string;
  subtitle: string;
  why: string;
  where: string;
  tips?: string;
  imageSrc: string;
  imageAlt: string;
  optional?: boolean;
};

export const DOCUMENT_EXAMPLES: Record<DocumentExampleId, DocumentExample> = {
  offre: {
    id: "offre",
    title: "Offre de prêt",
    subtitle: "Le document remis par votre banque lors de l'octroi du crédit",
    why: "Nous en avons besoin pour vérifier le montant emprunté, la durée restante, le taux et les conditions de votre prêt. Ces éléments permettent de calculer précisément vos économies d'assurance possibles.",
    where: "Dans votre espace client bancaire : rubrique Crédit / Prêt immobilier / Documents, ou dans les courriers reçus lors de la signature du prêt.",
    tips: "Le PDF téléchargé depuis votre banque est idéal. Une photo nette et complète convient aussi.",
    imageSrc: "/document-examples/offre-pret.png",
    imageAlt: "Exemple d'offre de prêt immobilier (document fictif)",
  },
  tableau: {
    id: "tableau",
    title: "Tableau d'amortissement",
    subtitle: "L'échéancier détaillé mois par mois jusqu'à la fin du prêt",
    why: "Ce document confirme le capital restant dû, la durée restante et la répartition capital / intérêts. C'est la base de notre simulation d'économies sur la durée de votre assurance.",
    where: "Même espace bancaire que l'offre de prêt : souvent intitulé « Tableau d'amortissement » ou « Échéancier ». Parfois réparti sur plusieurs pages — déposez toutes les pages si besoin.",
    tips: "Si le tableau est long, vous pouvez déposer plusieurs fichiers PDF (un par partie).",
    imageSrc: "/document-examples/tableau-amortissement.png",
    imageAlt: "Exemple de tableau d'amortissement (document fictif)",
  },
  fiche: {
    id: "fiche",
    title: "Fiche standardisée d'information",
    subtitle: "La fiche de synthèse assurance remise avec votre prêt (optionnel)",
    why: "Elle récapitule votre situation d'emprunteur et les garanties demandées par la banque. Elle nous aide à proposer une assurance équivalente, sans rien oublier.",
    where: "Souvent jointe à l'offre de prêt ou disponible dans votre espace client, sous le nom « Fiche standardisée d'information » ou « FSI ».",
    imageSrc: "/document-examples/fiche-information.png",
    imageAlt: "Exemple de fiche standardisée d'information (document fictif)",
    optional: true,
  },
  contrat: {
    id: "contrat",
    title: "Contrat d'assurance emprunteur",
    subtitle: "Uniquement si vous avez souscrit en dehors de la banque du crédit",
    why: "Si votre assurance n'est pas celle de la banque, nous devons connaître vos garanties actuelles et votre cotisation pour comparer à des offres équivalentes ou meilleures.",
    where: "Dans vos emails ou courriers de l'assureur actuel, ou sur l'espace client de votre compagnie d'assurance.",
    imageSrc: "/document-examples/contrat-assurance.png",
    imageAlt: "Exemple de contrat d'assurance emprunteur (document fictif)",
    optional: true,
  },
};
