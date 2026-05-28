import type { ClientPortalData } from "./ClientPortalContent";

/** Données d'exemple pour l'aperçu visuel (équipe LCIF). */
export const CLIENT_PORTAL_DEMO_DATA: ClientPortalData = {
  dossierId: "LCIF-930840",
  clientPrenom: "Marie",
  status: {
    label: "Étude en cours",
    description:
      "Nous analysons votre dossier. Vous serez contactée par email si nous avons besoin d'un document complémentaire.",
  },
  steps: [
    { key: "received", label: "Demande reçue", done: true },
    {
      key: "docs",
      label: "Documents prêt reçus",
      done: true,
      hint: "Offre et tableau d'amortissement OK",
    },
    {
      key: "study",
      label: "Étude des économies",
      done: false,
    },
    {
      key: "done",
      label: "Proposition envoyée",
      done: false,
    },
  ],
  documents: [
    { key: "offre", label: "Offre de prêt", received: true, requiredNow: false },
    { key: "amort", label: "Tableau d'amortissement", received: true, requiredNow: false },
    { key: "cni", label: "Pièce d'identité", received: false, requiredNow: false },
    { key: "rib", label: "RIB", received: false, requiredNow: false },
  ],
  tips: [
    "Pour toute question, répondez aux emails envoyés par Le Club Immobilier Français : notre équipe vous accompagne personnellement.",
  ],
  lastUpdateLabel: new Date().toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }),
};
