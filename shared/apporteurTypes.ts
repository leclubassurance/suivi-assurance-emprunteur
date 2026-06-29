export type ApporteurType = "agent_immo" | "courtier" | "autre";

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
  email: string;
  phone?: string;
  type: ApporteurType;
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
  email: string;
  phone?: string;
  companyName?: string;
  notes?: string;
  /** Apporteur créé automatiquement à la signature du contrat. */
  createdApporteurId?: string;
  events: ReferralEvent[];
};

export const PARTNER_RECRUIT_STATUS_LABELS: Record<PartnerRecruitStatus, string> = {
  NOUVEAU: "Nouvelle candidature",
  VALIDE_LCIF: "Validé LCIF",
  CONTRAT_ENVOYE: "Contrat envoyé",
  CONTRAT_SIGNE: "Contrat signé — apporteur créé",
  REFUSE: "Refusé",
};

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
