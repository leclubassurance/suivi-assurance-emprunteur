import type { ClientPortalData } from "./ClientPortalContent";

/** Données d'exemple pour l'aperçu visuel (équipe LCIF). */
export const CLIENT_PORTAL_DEMO_DATA: ClientPortalData = {
  dossierId: "LCIF-930840",
  clientPrenom: "Marie",
  status: {
    label: "Étude envoyée par email",
    description:
      "Votre étude personnalisée vous a été transmise par email. Consultez votre boîte de réception (et les spams).",
  },
  steps: [
    { key: "received", label: "Demande enregistrée", done: true },
    {
      key: "docs",
      label: "Offre de prêt et tableau d'amortissement",
      done: true,
      hint: "Documents reçus et exploitables",
    },
    {
      key: "study",
      label: "Étude des économies réalisée",
      done: true,
    },
    {
      key: "done",
      label: "Étude transmise par email",
      done: true,
      hint: "Dernier envoi : Marie, votre étude personnalisée - Assurance Emprunteur",
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
