export type ApporteurType = "apporteur_affaires" | "agent_immo" | "courtier" | "autre";

export type ReferralStatus =
  | "NOUVEAU"
  | "CONTACTE"
  | "DOSSIER_OUVERT"
  | "ETUDE_ENVOYEE"
  | "SIGNE"
  | "REFUSE"
  | "PERDU";

export type ReferralSource = "admin" | "form_ref" | "apporteur_portal";

export type Apporteur = {
  id: string;
  createdAt: string;
  updatedAt: string;
  active: boolean;
  companyName: string;
  contactName: string;
  /** Prénom — utilisé pour le contrat et la signature. */
  contactPrenom?: string;
  /** Nom de famille — utilisé pour le contrat et la signature. */
  contactNom?: string;
  email: string;
  phone?: string;
  addressLine?: string;
  postalCode?: string;
  city?: string;
  siret?: string;
  /** SIREN (9 chiffres) — dérivé du SIRET ou saisi. */
  siren?: string;
  /** Dénomination légale issue du registre SIRENE (si vérifiée). */
  companyLegalName?: string;
  siretVerifiedAt?: string;
  legalForm?: string;
  legalFormOther?: string;
  type: ApporteurType;
  /** Libellé libre si type = autre (ex. coach, CGP…). */
  typeCustomLabel?: string;
  /** Slug pour ?ref= sur le formulaire */
  referralToken: string;
  /** Accès espace apporteur (lien privé, ne pas partager publiquement). */
  portalToken: string;
  notes?: string;
  /** Recevoir un email à chaque changement de statut d'une recommandation. */
  notifyEmailEnabled?: boolean;
  /** Statut du contrat d'apporteur (phase contrat — à compléter). */
  contractStatus?: "none" | "pending" | "sent" | "signed" | "expired";
  contractSignedAt?: string;
  /** Preuve de signature électronique in-app. */
  contractSignature?: {
    version: string;
    signedAt: string;
    signerName: string;
    signerEmail: string;
    companyName: string;
    ipAddress?: string;
    userAgent?: string;
    pdfFileName?: string;
    /** Validation OTP email avant signature (renforce la preuve pour personnes physiques). */
    emailOtpVerifiedAt?: string;
    driveFileId?: string;
    driveLink?: string;
    /** Contre-signature électronique du mandant (Le Club Immobilier Français). */
    mandantSignature?: {
      signedAt: string;
      signerName: string;
      signerTitle: string;
      companyName: string;
    };
  };
  /** Dossier Google Drive « Apporteurs d'affaires » (contrats archivés). */
  driveFolderId?: string;
  /** Statistiques lien client (?ref=) — clics page d'accueil. */
  referralStats?: {
    linkClicks: number;
    uniqueSessions: number;
    lastClickAt?: string;
    /** Interne — identifiants de session déjà comptés (cap 3000). */
    _sessionIds?: string[];
    /** Agrégat visites par pays (code ISO) quand disponible. */
    clicksByCountry?: Record<string, number>;
    /** Derniers événements (sans IP — pays + horodatage). */
    recentClicks?: { at: string; sessionId?: string; countryCode?: string }[];
  };
  /** Apporteur parrain (niveau 1 — marketing de réseau). */
  sponsorId?: string;
};

export type PartnerRecruitStatus =
  | "NOUVEAU"
  | "VALIDE_LCIF"
  | "CONTRAT_ENVOYE"
  | "CONTRAT_SIGNE"
  | "REFUSE";

export type PartnerRecruitRequest = {
  id: string;
  sponsorApporteurId: string;
  createdAt: string;
  updatedAt: string;
  status: PartnerRecruitStatus;
  contactName: string;
  contactPrenom?: string;
  contactNom?: string;
  email: string;
  phone?: string;
  companyName?: string;
  siret?: string;
  siren?: string;
  companyLegalName?: string;
  notes?: string;
  /** Apporteur créé automatiquement à la signature du contrat. */
  createdApporteurId?: string;
  events: ReferralEvent[];
};

export const PARTNER_RECRUIT_STATUS_LABELS: Record<PartnerRecruitStatus, string> = {
  NOUVEAU: "Nouvelle candidature",
  VALIDE_LCIF: "Validé LCIF",
  CONTRAT_ENVOYE: "Contrat envoyé",
  CONTRAT_SIGNE: "Apporteur créé",
  REFUSE: "Refusé",
};

export const PARTNER_RECRUIT_FLOW: PartnerRecruitStatus[] = [
  "NOUVEAU",
  "VALIDE_LCIF",
  "CONTRAT_ENVOYE",
  "CONTRAT_SIGNE",
];

export type ReferralContact = {
  prenom?: string;
  nom?: string;
  email?: string;
  phone?: string;
  notes?: string;
};

export type ReferralEvent = {
  at: string;
  status: ReferralStatus;
  message?: string;
  actor?: string;
};

export type Referral = {
  id: string;
  apporteurId: string;
  createdAt: string;
  updatedAt: string;
  status: ReferralStatus;
  source: ReferralSource;
  contact: ReferralContact;
  dossierId?: string;
  events: ReferralEvent[];
  lastNotifiedStatus?: ReferralStatus;
  lastNotifiedAt?: string;
  clientInviteSentAt?: string;
};

export const REFERRAL_STATUS_LABELS: Record<ReferralStatus, string> = {
  NOUVEAU: "Nouveau",
  CONTACTE: "Contacté",
  DOSSIER_OUVERT: "Dossier ouvert",
  ETUDE_ENVOYEE: "Étude envoyée",
  SIGNE: "Signé",
  REFUSE: "Refusé",
  PERDU: "Perdu",
};

export const APPORTEUR_TYPE_LABELS: Record<ApporteurType, string> = {
  apporteur_affaires: "Apporteur d'affaires",
  agent_immo: "Agent immobilier",
  courtier: "Courtier",
  autre: "Autre",
};

export const REFERRAL_STATUS_ORDER: ReferralStatus[] = [
  "NOUVEAU",
  "CONTACTE",
  "DOSSIER_OUVERT",
  "ETUDE_ENVOYEE",
  "SIGNE",
  "REFUSE",
  "PERDU",
];
