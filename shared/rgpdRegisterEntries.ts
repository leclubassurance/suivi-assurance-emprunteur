/**
 * Registre des activités de traitement (art. 30 RGPD) — plateforme assurance emprunteur LCIF.
 * Synchronisé vers Google Sheets (onglet « Registre traitements »).
 */

import { PRIVACY_POLICY_VERSION } from "./privacyConsent";

export type RgpdRegisterRow = {
  treatmentName: string;
  purpose: string;
  dataCategories: string;
  dataSubjects: string;
  recipients: string;
  transfersOutsideEu: string;
  retention: string;
  securityMeasures: string;
  legalBasis: string;
};

export const RGPD_REGISTER_META = {
  controller: "LE CLUB IMMOBILIER FRANÇAIS (SAS)",
  platform: "Plateforme assurance emprunteur en ligne",
  lastSyncedLabel: PRIVACY_POLICY_VERSION,
} as const;

export const RGPD_REGISTER_ENTRIES: RgpdRegisterRow[] = [
  {
    treatmentName: "Dépôt et instruction de dossier assurance emprunteur",
    purpose:
      "Collecte des pièces et informations pour étude précontractuelle, comparaison et proposition d'assurance emprunteur",
    dataCategories:
      "Identité, coordonnées, données de prêt, pièces PDF (offre, amortissement, CNI, RIB), données professionnelles et de risque déclarées",
    dataSubjects: "Clients / prospects emprunteurs",
    recipients:
      "Collaborateurs LCIF habilités ; compagnies d'assurance partenaires si nécessaire au devis ; sous-traitants techniques (hébergement, stockage)",
    transfersOutsideEu:
      "Évités lorsque possible ; garanties contractuelles (CCT) si prestataire hors UE (ex. cloud)",
    retention:
      "Instruction : durée du dossier ; sans suite : 3 ans ; contrat : 10 ans (prescription / métier assurance)",
    securityMeasures: "HTTPS, contrôle d'accès admin, stockage Drive/Firestore, journalisation",
    legalBasis: "Art. 6.1.b RGPD (mesures précontractuelles / contrat) ; art. 9 selon données sensibles déclarées",
  },
  {
    treatmentName: "Espace de suivi client (lien personnel)",
    purpose: "Permettre au client de consulter l'avancement de son dossier",
    dataCategories: "Statut dossier, références LCIF, jeton d'accès, horodatages de consultation",
    dataSubjects: "Clients",
    recipients: "Client ; équipe LCIF",
    transfersOutsideEu: "Selon hébergeur (Railway / Vercel) — CCT si hors UE",
    retention: "Durée du dossier + archivage selon politique de conservation",
    securityMeasures: "Jeton opaque, accès sans compte, HTTPS",
    legalBasis: "Art. 6.1.b RGPD (exécution / intérêt du service demandé)",
  },
  {
    treatmentName: "Échanges email (Gmail professionnel)",
    purpose: "Réception, accusé, relances et envoi d'études / propositions",
    dataCategories: "Adresse email, contenu des messages, pièces jointes, métadonnées",
    dataSubjects: "Clients ; correspondants banque / assureur",
    recipients: "Équipe LCIF ; destinataires des emails envoyés",
    transfersOutsideEu: "Google Workspace — CCT / mesures Google",
    retention: "Alignée dossier client et obligations métier (jusqu'à 10 ans pièces contractuelles)",
    securityMeasures: "Compte professionnel dédié, mots de passe forts, accès restreint",
    legalBasis: "Art. 6.1.b et 6.1.f RGPD",
  },
  {
    treatmentName: "Assistance automatisée aux réponses par email (Camille)",
    purpose:
      "Faciliter la rédaction de réponses, relances et accusés de réception par email, sous contrôle humain de l'équipe",
    dataCategories:
      "Contexte dossier, historique des échanges email, statut des pièces, contenus des messages",
    dataSubjects: "Clients",
    recipients:
      "Équipe LCIF habilitée ; sous-traitant technique d'assistance à la rédaction (contrat art. 28 RGPD)",
    transfersOutsideEu: "Selon prestataire technique — CCT et minimisation",
    retention: "Contenu dans dossier et messagerie professionnelle ; traces d'audit limitées",
    securityMeasures:
      "Validation humaine avant envoi, escalade, journalisation, pas de décision automatisée seule (art. 22)",
    legalBasis: "Art. 6.1.b RGPD ; 6.1.f (qualité et continuité du service)",
  },
  {
    treatmentName: "Notifications internes Telegram",
    purpose: "Alerter l'équipe (nouveau dossier, mail client, escalade)",
    dataCategories: "Identifiants dossier, extraits non sensibles, liens",
    dataSubjects: "Clients (données limitées au nécessaire opérationnel)",
    recipients: "Collaborateurs LCIF sur canaux autorisés",
    transfersOutsideEu: "Telegram — vérifier localisation / politique Telegram",
    retention: "Messages selon usage interne ; pas d'archivage client long terme sur Telegram",
    securityMeasures: "Liste blanche chat_id, déduplication, pas de données inutiles",
    legalBasis: "Art. 6.1.f RGPD (intérêt légitime opérationnel)",
  },
  {
    treatmentName: "Stockage documentaire Google Drive",
    purpose: "Archivage des pièces client et dossiers structurés",
    dataCategories: "Fichiers déposés, métadonnées fichiers",
    dataSubjects: "Clients",
    recipients: "Équipe LCIF ; compte de service / compte assurance@…",
    transfersOutsideEu: "Google Cloud — CCT",
    retention: "Durée dossier + obligations légales assurance",
    securityMeasures: "Dossiers dédiés, partage restreint, compte de service",
    legalBasis: "Art. 6.1.b RGPD",
  },
  {
    treatmentName: "Base dossiers (Firebase / Firestore)",
    purpose: "Persistance des dossiers, statuts, tâches et synchronisation applicative",
    dataCategories: "Données formulaire, statuts, communications compactées, consentement",
    dataSubjects: "Clients",
    recipients: "Application LCIF ; Google Firebase",
    transfersOutsideEu: "Google — CCT ; région UE privilégiée si configurée",
    retention: "Selon politique de conservation dossier",
    securityMeasures: "Règles Firebase, compactage, accès API authentifié admin",
    legalBasis: "Art. 6.1.b RGPD",
  },
  {
    treatmentName: "Brouillon formulaire (localStorage navigateur)",
    purpose: "Éviter la perte de saisie avant envoi",
    dataCategories: "Champs formulaire partiels (sans pièces complètes côté serveur)",
    dataSubjects: "Utilisateurs du site",
    recipients: "Terminal de l'utilisateur uniquement",
    transfersOutsideEu: "Non",
    retention: "Jusqu'à envoi ou suppression par l'utilisateur",
    securityMeasures: "Pas de serveur ; noms/prénoms/emails retirés du brouillon sauvegardé",
    legalBasis: "Intérêt légitime / nécessité technique (pas de cookie non essentiel)",
  },
  {
    treatmentName: "Espace partenaire apporteur d'affaires",
    purpose:
      "Gestion des partenaires commerciaux : contrat, lien de recommandation, suivi des recommandations et rémunérations",
    dataCategories:
      "Identité partenaire, coordonnées, SIRET/SIREN, statut contrat, jetons d'accès portail, historique recommandations, statistiques de clics sur lien client",
    dataSubjects: "Apporteurs d'affaires / partenaires commerciaux",
    recipients: "Équipe LCIF habilitée ; partenaire (ses propres données via espace sécurisé)",
    transfersOutsideEu: "Selon hébergeur applicatif — CCT si hors UE",
    retention: "Durée de la relation contractuelle + archivage contrat signé (10 ans)",
    securityMeasures: "Jeton portail opaque, HTTPS, accès restreint, PDF contrat archivé",
    legalBasis: "Art. 6.1.b RGPD (contrat d'apport) ; 6.1.c (obligations comptables / preuve)",
  },
  {
    treatmentName: "Canal recommandation partenaire (lien client ?ref=)",
    purpose:
      "Attribuer un dossier client au partenaire ayant initié la mise en relation et assurer le suivi commercial",
    dataCategories:
      "Identifiant de lien (?ref=), horodatage de visite, identifiant de session technique, données client issues du formulaire",
    dataSubjects: "Clients / prospects emprunteurs ; partenaires référents",
    recipients: "Équipe LCIF ; partenaire (statut avancé uniquement, sans pièces médicales)",
    transfersOutsideEu: "Non, sauf sous-traitants techniques — CCT",
    retention: "Alignée sur le dossier client et le contrat partenaire",
    securityMeasures: "Attribution serveur à l'ouverture de dossier ; pas d'exposition des pièces au partenaire",
    legalBasis: "Art. 6.1.b RGPD (mesures précontractuelles) ; 6.1.f (suivi légitime du canal partenaire)",
  },
  {
    treatmentName: "Journal des consentements politique de confidentialité",
    purpose: "Preuve de l'acceptation de la politique à l'envoi du dossier",
    dataCategories: "Horodatage, version politique, libellé case, IP, user-agent, id dossier",
    dataSubjects: "Clients",
    recipients: "Référent données LCIF ; Google Sheets interne",
    transfersOutsideEu: "Google Sheets — CCT",
    retention: "10 ans (preuve en cas de contrôle / litige)",
    securityMeasures: "Feuille restreinte, accès compte professionnel / service account",
    legalBasis: "Art. 6.1.c RGPD (obligation de preuve) et 6.1.b",
  },
];

export const RGPD_REGISTER_HEADERS = [
  "Nom du traitement",
  "Finalité",
  "Catégories de données",
  "Personnes concernées",
  "Destinataires",
  "Transferts hors UE",
  "Durées de conservation",
  "Mesures de sécurité",
  "Base légale",
] as const;
