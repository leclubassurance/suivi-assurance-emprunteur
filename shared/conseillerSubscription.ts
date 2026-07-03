export type ConseillerSubscriptionStatus =
  | "pending"
  | "infos_recues"
  | "souscription_en_cours"
  | "souscription_faite";

export const CONSEILLER_SUBSCRIPTION_STATUS_LABELS: Record<ConseillerSubscriptionStatus, string> = {
  pending: "En attente — formulaire conseiller",
  infos_recues: "Informations reçues",
  souscription_en_cours: "Souscription en cours",
  souscription_faite: "Souscription finalisée",
};

export type ConseillerSubscriptionBorrower = {
  prenom: string;
  nom: string;
  rib?: string;
  identityRef?: string;
};

export type ConseillerSubscriptionPackage = {
  status: ConseillerSubscriptionStatus;
  submittedAt?: string;
  submittedByApporteurId?: string;
  creditOfferRef?: string;
  addressLine?: string;
  postalCode?: string;
  city?: string;
  borrowers?: ConseillerSubscriptionBorrower[];
  adminNote?: string;
  updatedAt: string;
  updatedBy?: string;
};

export function isConseillerSubscriptionStatus(v: unknown): v is ConseillerSubscriptionStatus {
  return (
    v === "pending" ||
    v === "infos_recues" ||
    v === "souscription_en_cours" ||
    v === "souscription_faite"
  );
}
