import { LCIF_LEGAL, getAssurancePlatformUrl } from "../../shared/lcifLegalIdentity";
import type { LegalDocument } from "./legalTypes";

const platformUrl = getAssurancePlatformUrl();

export const mentionsLegalesAssurance: LegalDocument = {
  title: "Mentions légales",
  subtitle: "Plateforme de dépôt de dossier — assurance emprunteur",
  lastUpdated: "28 mai 2026",
  disclaimer:
    "Le présent document a vocation à informer les utilisateurs de leurs droits et obligations. Il ne constitue pas un conseil juridique personnalisé.",
  sections: [
    {
      id: "editeur",
      title: "1. Éditeur du site",
      blocks: [
        {
          type: "p",
          text: `Le présent site et la plateforme de dépôt de dossier assurance emprunteur (ci-après la « Plateforme »), accessibles notamment à l'adresse ${platformUrl}, sont édités par la société ${LCIF_LEGAL.companyName}, ${LCIF_LEGAL.legalForm} au capital de ${LCIF_LEGAL.shareCapitalEur} euros, dont le siège social est situé ${LCIF_LEGAL.registeredOffice}.`,
        },
        {
          type: "p",
          text: `Immatriculation : RCS ${LCIF_LEGAL.rcsCity} n° ${LCIF_LEGAL.rcsNumber} — SIREN ${LCIF_LEGAL.siren} — TVA intracommunautaire ${LCIF_LEGAL.vatNumber}.`,
        },
        {
          type: "p",
          text: `Activité d'intermédiation en assurance : ${LCIF_LEGAL.insuranceActivity}. Immatriculation ORIAS n° ${LCIF_LEGAL.oriasNumber} (registre consultable sur ${LCIF_LEGAL.oriasUrl}).`,
        },
        {
          type: "p",
          text: `L'Éditeur est également titulaire de la carte professionnelle d'agent immobilier n° ${LCIF_LEGAL.cpiNumber}, délivrée par la CCI Nantes-Saint Nazaire, pour ses activités immobilières distinctes présentées sur ${LCIF_LEGAL.mainWebsiteUrl}.`,
        },
        {
          type: "p",
          text: `Représentant légal : ${LCIF_LEGAL.legalRepresentative}, ${LCIF_LEGAL.legalRepresentativeTitle} de la société.`,
        },
        {
          type: "p",
          text: `Contact : ${LCIF_LEGAL.contactEmail} — ${LCIF_LEGAL.email} — Tél. ${LCIF_LEGAL.phone}.`,
        },
        {
          type: "p",
          text: `Directeur de la publication : ${LCIF_LEGAL.publicationDirector}.`,
        },
        {
          type: "p",
          text: `Carte professionnelle transaction immobilière n° ${LCIF_LEGAL.cpiNumber}, délivrée le ${LCIF_LEGAL.cpiIssuedAt} par la ${LCIF_LEGAL.cpiAuthority}. Assurance responsabilité civile professionnelle : ${LCIF_LEGAL.professionalInsurance.insurer}, police n° ${LCIF_LEGAL.professionalInsurance.policyNumber}.`,
        },
      ],
    },
    {
      id: "controle",
      title: "2. Autorité de contrôle et registre",
      blocks: [
        {
          type: "p",
          text: `En sa qualité d'intermédiaire en assurance, l'Éditeur est soumis au contrôle de l'${LCIF_LEGAL.acpr}.`,
        },
        {
          type: "p",
          text: `Vous pouvez vérifier l'immatriculation ORIAS de l'Éditeur sur le site officiel ${LCIF_LEGAL.oriasUrl} en recherchant le numéro ${LCIF_LEGAL.oriasNumber} ou la dénomination sociale.`,
        },
        {
          type: "ul",
          items: [
            "L'ORIAS ne traite pas les litiges commerciaux : il s'agit du registre officiel des intermédiaires.",
            "Pour toute réclamation relative à une opération d'assurance, reportez-vous à la section « Réclamations et médiation » ci-dessous.",
          ],
        },
      ],
    },
    {
      id: "hebergement",
      title: "3. Hébergement et infrastructure technique",
      blocks: [
        {
          type: "p",
          text: "La Plateforme s'appuie sur des prestataires techniques situés dans l'Union européenne ou offrant des garanties appropriées au transfert de données :",
        },
        {
          type: "ul",
          items: [
            "Hébergement de l'interface utilisateur : Vercel Inc. (États-Unis / Union européenne selon région de déploiement) — vercel.com",
            "Hébergement des services applicatifs et API : Railway Corp. — railway.app",
            "Hébergement des données et authentification : Google Firebase / Google Cloud (Google Ireland Limited pour l'UE) — firebase.google.com",
            "Stockage documentaire et messagerie professionnelle : Google Workspace / Google Drive, lorsque activés pour le traitement du dossier",
          ],
        },
        {
          type: "p",
          text: "Les coordonnées détaillées des hébergeurs peuvent être obtenues sur demande à l'adresse indiquée à la section 1.",
        },
      ],
    },
    {
      id: "objet",
      title: "4. Objet de la Plateforme",
      blocks: [
        {
          type: "p",
          text: "La Plateforme permet aux utilisateurs de transmettre, de manière sécurisée, les informations et pièces nécessaires à l'étude d'une solution d'assurance emprunteur (délégation d'assurance), d'en suivre l'avancement et, le cas échéant, d'accéder à un espace de suivi personnel.",
        },
        {
          type: "p",
          text: "Les contenus publiés sur la Plateforme sont fournis à titre informatif. Ils ne constituent ni une offre contractuelle, ni un conseil personnalisé au sens de la réglementation des assurances, tant qu'aucun devis ou contrat n'a été remis et accepté selon les formalités légales applicables.",
        },
      ],
    },
    {
      id: "propriete",
      title: "5. Propriété intellectuelle",
      blocks: [
        {
          type: "p",
          text: "L'ensemble des éléments composant la Plateforme (textes, graphismes, logos, logiciels, bases de données, structure) est protégé par le droit de la propriété intellectuelle et demeure la propriété exclusive de l'Éditeur ou de ses partenaires.",
        },
        {
          type: "p",
          text: "Toute reproduction, représentation, modification ou exploitation non autorisée, totale ou partielle, est interdite sans accord écrit préalable de l'Éditeur.",
        },
      ],
    },
    {
      id: "responsabilite",
      title: "6. Responsabilité",
      blocks: [
        {
          type: "p",
          text: "L'Éditeur met en œuvre des moyens raisonnables pour assurer l'accessibilité et la sécurité de la Plateforme. Toutefois, sa responsabilité ne saurait être engagée en cas d'interruption temporaire, de maintenance, de force majeure, ou de dysfonctionnement imputable à un tiers ou à l'utilisateur (connexion, matériel, virus, etc.).",
        },
        {
          type: "p",
          text: "L'utilisateur est seul responsable de l'exactitude des informations transmises et des documents déposés. Toute fausse déclaration peut entraîner le refus, la résiliation ou la nullité des garanties selon les règles applicables au contrat d'assurance.",
        },
      ],
    },
    {
      id: "reclamations",
      title: "7. Réclamations et médiation",
      blocks: [
        {
          type: "p",
          text: `Conformément aux articles L. 612-1 et suivants du Code de la consommation et aux dispositions du Code des assurances, toute réclamation relative à l'activité d'intermédiation en assurance doit être adressée en priorité par écrit à : ${LCIF_LEGAL.email} ou ${LCIF_LEGAL.registeredOffice}, en précisant vos coordonnées, la référence de dossier et l'objet du litige.`,
        },
        {
          type: "p",
          text: "L'Éditeur s'engage à accuser réception de votre réclamation dans un délai maximal de dix (10) jours ouvrables et à vous apporter une réponse motivée dans un délai maximal de deux (2) mois à compter de sa réception, sauf disposition légale ou réglementaire prévoyant un délai différent.",
        },
        {
          type: "p",
          text: "Si la réponse ne vous satisfait pas ou en l'absence de réponse dans ce délai, et sous réserve que le litige relève de sa compétence matérielle, vous pouvez saisir gratuitement :",
        },
        {
          type: "ul",
          items: [
            `${LCIF_LEGAL.mediationInsurance.name} — ${LCIF_LEGAL.mediationInsurance.website} — ${LCIF_LEGAL.mediationInsurance.postal} (après épuisement de la procédure interne de réclamation)`,
            `Le médiateur de la consommation compétent pour les litiges relevant du Code de la consommation : ${LCIF_LEGAL.mediationConsumption.name}, ${LCIF_LEGAL.mediationConsumption.company}, ${LCIF_LEGAL.mediationConsumption.address}, RCS Paris ${LCIF_LEGAL.mediationConsumption.rcs}`,
          ],
        },
        {
          type: "p",
          text: "La saisine du médiateur de l'assurance suppose que vous ayez préalablement adressé une réclamation écrite au service réclamation de l'Éditeur et que le litige porte sur la souscription, l'interprétation ou l'exécution d'une opération d'assurance relevant de sa compétence.",
        },
      ],
    },
    {
      id: "donnees",
      title: "8. Données personnelles",
      blocks: [
        {
          type: "p",
          text: "Le traitement des données personnelles collectées via la Plateforme est décrit dans la Politique de confidentialité, accessible depuis le pied de page du site. Cette politique précise les finalités, bases légales, durées de conservation, destinataires et vos droits.",
        },
      ],
    },
    {
      id: "cookies",
      title: "9. Cookies et traceurs",
      blocks: [
        {
          type: "p",
          text: "La Plateforme utilise principalement le stockage local de votre navigateur (localStorage) pour conserver temporairement un brouillon de formulaire, afin d'éviter une perte de saisie. Ce mécanisme ne dépose pas de cookie publicitaire et ne nécessite pas de consentement au sens de la directive « ePrivacy » pour ce seul usage strictement nécessaire au confort de saisie.",
        },
        {
          type: "p",
          text: "Si des outils de mesure d'audience ou des traceurs non essentiels venaient à être activés ultérieurement, un bandeau d'information et de consentement conforme aux recommandations de la CNIL vous serait présenté avant tout dépôt.",
        },
      ],
    },
    {
      id: "droit",
      title: "10. Droit applicable",
      blocks: [
        {
          type: "p",
          text: "Les présentes mentions légales sont régies par le droit français. En l'absence de résolution amiable, et sous réserve des règles impératives de compétence, les tribunaux français seront seuls compétents.",
        },
      ],
    },
  ],
};
