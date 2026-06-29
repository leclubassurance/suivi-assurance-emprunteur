import { APPORTEUR_CONTRACT_MLM_CLAUSE } from "./apporteurContractMlm";
import { LCIF_LEGAL } from "./lcifLegalIdentity";

/** Incrémenter à chaque révision substantielle du contrat affiché en ligne. */
export const APPORTEUR_CONTRACT_VERSION = "2025-06-v1";

export type ApporteurContractSection = {
  heading: string;
  body: string;
};

export type ApporteurContractDocument = {
  version: string;
  title: string;
  preamble: string;
  sections: ApporteurContractSection[];
  acceptanceLabel: string;
};

export function buildApporteurContractDocument(params: {
  contactName: string;
  companyName: string;
  email: string;
  typeLabel: string;
  sponsorName?: string | null;
}): ApporteurContractDocument {
  const party = params.companyName
    ? `${params.contactName}, agissant pour ${params.companyName}`
    : params.contactName;
  const sponsorLine = params.sponsorName
    ? ` Le Partenaire est recommandé par ${params.sponsorName}, qui exerce en qualité de parrain au sens de l'article « Programme de recommandation de partenaires » ci-dessous.`
    : "";

  const sections: ApporteurContractSection[] = [
    {
      heading: "1. Objet",
      body:
        `Le présent contrat d'apporteur d'affaires (« Contrat ») est conclu entre ${LCIF_LEGAL.companyName}, ${LCIF_LEGAL.legalForm} au capital de ${LCIF_LEGAL.shareCapitalEur} €, immatriculée au RCS ${LCIF_LEGAL.rcsCity} sous le n° ${LCIF_LEGAL.rcsNumber}, dont le siège est ${LCIF_LEGAL.registeredOffice}, représentée par ${LCIF_LEGAL.legalRepresentative}, ${LCIF_LEGAL.legalRepresentativeTitle} (« LCIF »), et ${party} (« le Partenaire »), joignable à ${params.email}.${sponsorLine}\n\nLCIF exerce une activité de ${LCIF_LEGAL.insuranceActivity} (ORIAS n° ${LCIF_LEGAL.oriasNumber}). Le Partenaire recommande des contacts intéressés par une étude d'assurance emprunteur, sans exercer d'activité de courtage ni de conseil en investissement.`,
    },
    {
      heading: "2. Statut du Partenaire",
      body:
        "Le Partenaire agit en qualité d'apporteur d'affaires indépendant. Il n'est ni salarié, ni mandataire, ni agent général d'assurance de LCIF, et n'est pas soumis à la réglementation ORIAS au titre de cette activité de recommandation. Le Partenaire reste libre de ses autres activités professionnelles.",
    },
    {
      heading: "3. Rémunération sur les dossiers propres",
      body:
        "Pour chaque dossier d'assurance emprunteur effectivement signé par un client apporté par le Partenaire, LCIF verse une rémunération égale à 50 % des frais de courtage LCIF effectivement perçus sur ce dossier.\n\nLes frais de courtage LCIF sont calculés selon le barème en vigueur : 10 % des économies annuelles réalisées, avec un plancher de 200 € et un plafond de 500 € par assuré. Les montants communiqués dans l'espace partenaire sont indicatifs et basés sur l'étude transmise au client.\n\nLa rémunération n'est due qu'à réception par LCIF de la commission versée par l'assureur, sous réserve de conformité du dossier et absence de réclamation ou de rétractation du client.",
    },
    {
      heading: "4. Modalités de recommandation",
      body:
        "Le Partenaire utilise le lien de recommandation client ou l'espace en ligne mis à disposition par LCIF. Il s'engage à ne pas collecter de documents médicaux ou bancaires sensibles en dehors des canaux sécurisés LCIF, et à orienter les contacts vers le formulaire officiel.\n\nLCIF reste seul interlocuteur pour l'analyse, l'étude, la relation banque et la souscription. Le Partenaire ne garantit pas un résultat financier au client.",
    },
    {
      heading: "5. Durée et résiliation",
      body:
        "Le Contrat est conclu pour une durée indéterminée à compter de sa signature électronique. Chaque partie peut y mettre fin à tout moment par notification écrite (email) avec un préavis de quinze (15) jours. Les rémunérations dues sur des dossiers signés avant la résiliation restent exigibles selon les conditions de l'article 3.",
    },
    {
      heading: "6. Confidentialité et données personnelles",
      body:
        `Le Partenaire s'engage à traiter les informations clients de manière confidentielle. LCIF traite les données personnelles conformément à sa politique de confidentialité. Référent données : ${LCIF_LEGAL.dataProtectionContact} — ${LCIF_LEGAL.contactEmail}.`,
    },
    {
      heading: `7. ${APPORTEUR_CONTRACT_MLM_CLAUSE.title}`,
      body: `${APPORTEUR_CONTRACT_MLM_CLAUSE.summary}\n\n${APPORTEUR_CONTRACT_MLM_CLAUSE.articles
        .map((a) => `${a.heading}\n${a.body}`)
        .join("\n\n")}`,
    },
    {
      heading: "8. Acceptation électronique",
      body:
        "En cochant la case d'acceptation et en validant votre nom, vous reconnaissez avoir lu l'intégralité du présent Contrat, en accepter les termes sans réserve, et disposer de la capacité juridique pour vous engager. LCIF conserve la date, l'identité déclarée et les éléments techniques de connexion à titre de preuve de consentement.",
    },
  ];

  return {
    version: APPORTEUR_CONTRACT_VERSION,
    title: "Contrat d'apporteur d'affaires — Le Club Immobilier Français",
    preamble: `Type de partenaire : ${params.typeLabel}. Version du contrat : ${APPORTEUR_CONTRACT_VERSION}.`,
    sections,
    acceptanceLabel:
      "Je certifie avoir lu le contrat d'apporteur d'affaires LCIF dans son intégralité et j'accepte d'y être lié(e) en qualité de Partenaire indépendant.",
  };
}
