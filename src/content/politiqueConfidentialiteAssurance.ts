import { LCIF_LEGAL, getAssurancePlatformUrl } from "../../shared/lcifLegalIdentity";
import type { LegalDocument } from "./legalTypes";

const platformUrl = getAssurancePlatformUrl();

export const politiqueConfidentialiteAssurance: LegalDocument = {
  title: "Politique de confidentialité",
  subtitle: "Protection des données personnelles — assurance emprunteur",
  lastUpdated: "1 juillet 2026",
  disclaimer:
    "Cette politique décrit comment LE CLUB IMMOBILIER FRANÇAIS traite vos données dans le cadre de la Plateforme assurance emprunteur, conformément au Règlement (UE) 2016/679 (RGPD) et à la loi n° 78-17 du 6 janvier 1978 modifiée (loi « Informatique et Libertés »).",
  sections: [
    {
      id: "responsable",
      title: "1. Responsable du traitement",
      blocks: [
        {
          type: "p",
          text: `Le responsable du traitement est ${LCIF_LEGAL.companyName}, ${LCIF_LEGAL.legalForm} au capital de ${LCIF_LEGAL.shareCapitalEur} euros, ${LCIF_LEGAL.registeredOffice}, immatriculée au RCS ${LCIF_LEGAL.rcsCity} sous le n° ${LCIF_LEGAL.rcsNumber}.`,
        },
        {
          type: "p",
          text: `Représentant légal : ${LCIF_LEGAL.legalRepresentative}, en qualité de ${LCIF_LEGAL.legalRepresentativeTitle} de la société.`,
        },
        {
          type: "p",
          text: `${LCIF_LEGAL.dataProtectionContactRole} : ${LCIF_LEGAL.dataProtectionContact}. Contact : ${LCIF_LEGAL.contactEmail} ou ${LCIF_LEGAL.email}.`,
        },
        {
          type: "p",
          text: "Le Club n'a pas désigné de délégué à la protection des données (DPO) au sens de l'article 37 du RGPD ; le référent indiqué ci-dessus est votre interlocuteur pour l'exercice de vos droits et les demandes relatives à vos données.",
        },
      ],
    },
    {
      id: "champ",
      title: "2. Champ d'application",
      blocks: [
        {
          type: "p",
          text: `La présente politique s'applique aux traitements réalisés via la Plateforme accessible à ${platformUrl} (formulaire de dépôt, espace de suivi personnel, échanges par email liés au dossier).`,
        },
        {
          type: "p",
          text: `Elle ne couvre pas les sites tiers (banques, assureurs, réseaux sociaux) vers lesquels des liens pourraient renvoyer, ni le site vitrine ${LCIF_LEGAL.mainWebsiteUrl}, qui dispose de sa propre information.`,
        },
      ],
    },
    {
      id: "partenaires",
      title: "2 bis. Parcours « recommandation partenaire »",
      blocks: [
        {
          type: "p",
          text: "Si vous accédez à la Plateforme via le lien personnel d'un partenaire commercial indépendant du Club (paramètre d'URL de recommandation, notamment ?ref=), nous enregistrons cet identifiant pour attribuer votre dossier au canal concerné et assurer le suivi de la recommandation.",
        },
        {
          type: "p",
          text: "Le partenaire n'instruit pas votre dossier d'assurance et n'a pas accès à vos pièces contractuelles ou médicales : seul Le Club Immobilier Français réalise l'étude et gère la relation avec les assureurs et, le cas échéant, votre banque.",
        },
        {
          type: "p",
          text: "Ce partenaire peut percevoir une rémunération du Club si vous décidez, de votre propre initiative, de poursuivre un changement d'assurance effectivement réalisé — sans surcoût pour vous. Cette information vous est rappelée lors de votre prise de contact.",
        },
      ],
    },
    {
      id: "donnees",
      title: "3. Données collectées",
      blocks: [
        {
          type: "p",
          text: "Selon votre parcours, nous sommes amenés à traiter notamment :",
        },
        {
          type: "ul",
          items: [
            "Identité et coordonnées : civilité, nom, prénom, date de naissance, adresse email, téléphone",
            "Données relatives au projet de financement : capital restant dû, échéances, objet du prêt, assureur actuel",
            "Données professionnelles et de risque : profession, statut, déplacements, activités sportives déclarées, éléments utiles à l'étude d'assurabilité",
            "Pièces justificatives : offre de prêt, tableau d'amortissement, pièce d'identité, RIB, autres documents transmis volontairement",
            "Données d'échanges : contenus des emails, historique des relances, réponses apportées",
            "Données techniques : journaux de connexion, horodatages, métadonnées de fichiers, adresse IP lors de l'envoi du formulaire",
            "Données de suivi dossier : statut, références LCIF, jeton d'accès à l'espace client",
            "Canal de recommandation partenaire : identifiant de lien (?ref=), horodatage de visite et attribution du dossier",
            "Preuve de consentement : horodatage et version de la présente politique acceptée lors du dépôt",
          ],
        },
        {
          type: "p",
          text: "Certaines informations déclarées (notamment liées à la santé, au sport à risque ou à la profession) peuvent constituer des données sensibles au sens de l'article 9 du RGPD. Elles ne sont collectées que lorsque nécessaires à l'étude précontractuelle ou contractuelle d'assurance et, le cas échéant, sur la base de votre consentement explicite ou des exceptions prévues par la loi (notamment l'article L. 112-1 du Code des assurances).",
        },
      ],
    },
    {
      id: "finalites",
      title: "4. Finalités et bases légales",
      blocks: [
        {
          type: "p",
          text: "Vos données sont traitées pour les finalités suivantes :",
        },
        {
          type: "ul",
          items: [
            "Instruction de votre demande d'étude et de souscription en assurance emprunteur (base : mesures précontractuelles / exécution du contrat — art. 6.1.b RGPD ; art. 9.2.i ou consentement selon les données)",
            "Vérification de la complétude et de la cohérence des pièces transmises, dans le cadre de l'instruction du dossier (base : art. 6.1.b)",
            "Échanges avec vous par email ou via l'espace de suivi (base : exécution du contrat / intérêt légitime à vous informer — art. 6.1.b et 6.1.f)",
            "Assistance automatisée à la rédaction de certaines réponses par email, sous contrôle et validation de l'équipe (base : art. 6.1.b et 6.1.f — qualité et continuité du service demandé)",
            "Respect des obligations légales et réglementaires applicables aux intermédiaires en assurance (ORIAS, ACPR, lutte contre le blanchiment, etc.) — art. 6.1.c",
            "Gestion des réclamations et preuve des échanges — art. 6.1.f (intérêt légitime) ou obligation légale",
            "Attribution et suivi des dossiers issus d'une recommandation partenaire (lien ?ref=) — art. 6.1.b et 6.1.f",
            "Sécurité de la Plateforme et prévention des abus — art. 6.1.f",
          ],
        },
        {
          type: "p",
          text: "L'assistance automatisée aux réponses par email ne se substitue pas à l'appréciation humaine de l'équipe : elle facilite la rédaction de messages d'information, de relance ou d'accusé de réception. Aucune décision produisant des effets juridiques vous concernant de manière significative n'est prise sur le seul fondement d'un traitement automatisé au sens de l'article 22 du RGPD.",
        },
      ],
    },
    {
      id: "destinataires",
      title: "5. Destinataires des données",
      blocks: [
        {
          type: "p",
          text: "Vos données sont accessibles, dans la limite de leurs attributions et sur la base du besoin d'en connaître, à :",
        },
        {
          type: "ul",
          items: [
            "Les collaborateurs et conseillers habilités du Club Immobilier Français",
            "Les compagnies d'assurance ou réassureurs partenaires, lorsque la transmission est nécessaire à l'établissement d'un devis ou d'un contrat",
            "Les sous-traitants techniques chargés de l'hébergement, du stockage, de la messagerie professionnelle et de l'assistance automatisée aux réponses par email, dans le cadre de contrats imposant confidentialité, sécurité et interdiction d'usage des données à d'autres fins",
          ],
        },
        {
          type: "p",
          text: "Nous ne vendons pas vos données. Elles peuvent être communiquées aux autorités administratives ou judiciaires lorsque la loi l'exige.",
        },
      ],
    },
    {
      id: "transferts",
      title: "6. Transferts hors Union européenne",
      blocks: [
        {
          type: "p",
          text: "Nous privilégions l'hébergement et le traitement au sein de l'Union européenne. Lorsque certains prestataires techniques interviennent depuis un pays tiers (notamment pour l'hébergement cloud ou la messagerie professionnelle), des garanties appropriées sont mises en place : clauses contractuelles types de la Commission européenne, mesures complémentaires de sécurité, ou décision d'adéquation le cas échéant.",
        },
        {
          type: "p",
          text: "Vous pouvez obtenir une copie des garanties applicables en écrivant à l'adresse indiquée à la section 1.",
        },
      ],
    },
    {
      id: "durees",
      title: "7. Durées de conservation",
      blocks: [
        {
          type: "ul",
          items: [
            "Brouillon local (navigateur) : jusqu'à suppression par vous ou validation du dossier — non stocké sur nos serveurs tant que vous n'avez pas envoyé le formulaire",
            "Dossier en cours d'instruction : durée nécessaire à l'étude, puis archivage intermédiaire",
            "Dossier sans suite : jusqu'à trois (3) ans à compter du dernier contact, sauf obligation contraire",
            "Données contractuelles et pièces justificatives : dix (10) ans en application des délais de prescription et des exigences métier en assurance, sauf durée légale supérieure",
            "Preuve de consentement à la politique de confidentialité : dix (10) ans",
            "Réclamations : cinq (5) ans à compter de la clôture du litige",
            "Journaux techniques : douze (12) mois maximum, sauf obligation de sécurité",
          ],
        },
        {
          type: "p",
          text: "À l'issue de ces délais, les données sont supprimées ou anonymisées de manière irréversible, sous réserve des archives légales.",
        },
      ],
    },
    {
      id: "securite",
      title: "8. Sécurité",
      blocks: [
        {
          type: "p",
          text: "Nous mettons en œuvre des mesures techniques et organisationnelles appropriées : chiffrement des flux (HTTPS), contrôle d'accès, sauvegardes, cloisonnement des environnements, journalisation des opérations sensibles, limitation des accès au besoin d'en connaître.",
        },
        {
          type: "p",
          text: "En cas de violation de données susceptible d'engendrer un risque élevé pour vos droits, vous serez informé dans les conditions prévues par le RGPD.",
        },
      ],
    },
    {
      id: "droits",
      title: "9. Vos droits",
      blocks: [
        {
          type: "p",
          text: "Conformément au RGPD et à la loi Informatique et Libertés, vous disposez des droits suivants :",
        },
        {
          type: "ul",
          items: [
            "Droit d'accès et de copie",
            "Droit de rectification des données inexactes",
            "Droit à l'effacement (dans les limites des obligations légales de conservation)",
            "Droit à la limitation du traitement",
            "Droit d'opposition, notamment à la prospection fondée sur l'intérêt légitime",
            "Droit à la portabilité des données fournies, lorsque le traitement est automatisé et fondé sur le contrat ou le consentement",
            "Droit de retirer votre consentement à tout moment, sans affecter la licéité des traitements antérieurs",
            "Droit de définir des directives relatives au sort de vos données après votre décès (en France)",
            "Droit de ne pas faire l'objet d'une décision fondée exclusivement sur un traitement automatisé produisant des effets juridiques ou vous affectant de manière significative (art. 22 RGPD), dans les conditions prévues par la loi",
          ],
        },
        {
          type: "p",
          text: `Pour exercer vos droits : ${LCIF_LEGAL.email} ou courrier à ${LCIF_LEGAL.registeredOffice}, en joignant une copie d'un titre d'identité si nécessaire pour sécuriser la demande. Nous répondrons dans un délai d'un (1) mois, prolongeable de deux (2) mois en cas de demande complexe, conformément à l'article 12 du RGPD.`,
        },
        {
          type: "p",
          text: "Vous pouvez introduire une réclamation auprès de la CNIL (www.cnil.fr) si vous estimez que vos droits ne sont pas respectés.",
        },
      ],
    },
    {
      id: "mineurs",
      title: "10. Mineurs",
      blocks: [
        {
          type: "p",
          text: "La Plateforme s'adresse aux personnes majeures capables de contracter. Nous ne collectons pas sciemment de données concernant des mineurs sans l'intervention d'un représentant légal dans le cadre d'une opération d'assurance autorisée.",
        },
      ],
    },
    {
      id: "cookies",
      title: "11. Cookies et stockage local",
      blocks: [
        {
          type: "p",
          text: "La Plateforme enregistre un brouillon de formulaire dans la mémoire locale de votre navigateur (technologie équivalente au localStorage) afin de préserver votre saisie entre deux visites. Aucune donnée nominative complète n'y est conservée de manière persistante côté serveur tant que vous n'avez pas validé l'envoi.",
        },
        {
          type: "p",
          text: "Après envoi du dossier, un lien de suivi personnel peut être mémorisé localement sur votre appareil pour faciliter l'accès à votre espace client. Vous pouvez effacer ces données à tout moment via les paramètres de votre navigateur.",
        },
        {
          type: "p",
          text: "La Plateforme n'utilise pas de cookies publicitaires ou de traçage à des fins de profilage commercial.",
        },
      ],
    },
    {
      id: "modifications",
      title: "12. Modifications",
      blocks: [
        {
          type: "p",
          text: "La présente politique peut être mise à jour pour refléter l'évolution réglementaire ou de nos traitements. La date de dernière mise à jour figure en tête de document. En cas de modification substantielle, nous pourrons vous en informer par email ou via la Plateforme si un dossier est en cours.",
        },
      ],
    },
  ],
};
