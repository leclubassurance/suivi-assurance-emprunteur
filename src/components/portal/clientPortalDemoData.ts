import type { ClientPortalData } from "./ClientPortalContent";

/** Données d'exemple — parcours post-étude avec adhésion en cours. */
export const CLIENT_PORTAL_DEMO_DATA: ClientPortalData = {
  dossierId: "LCIF-930840",
  clientPrenom: "Marie",
  status: {
    label: "Adhésion en ligne en cours",
    description:
      "Vous finalisez votre changement d'assurance sur la plateforme sécurisée. Notre équipe reste disponible par email.",
  },
  steps: [
    { key: "received", label: "Demande enregistrée", done: true },
    { key: "docs", label: "Offre de prêt et tableau d'amortissement", done: true },
    { key: "study", label: "Analyse et étude des économies", done: true },
    {
      key: "study_email",
      label: "Étude transmise par email",
      done: true,
      hint: "Envoi : votre étude personnalisée",
    },
    {
      key: "client_decision",
      label: "Votre décision sur le changement d'assurance",
      done: true,
      hint: "Merci — nous avons bien pris note de votre accord.",
    },
    {
      key: "kereis_adhesion",
      label: "Préparation du contrat de l'assurance",
      done: false,
      hint: "Questionnaire de santé en ligne (obligatoire pour l'assureur).",
    },
    {
      key: "adhesion_contract_sent",
      label: "Contrat d'adhésion envoyé",
      done: true,
      hint: "Votre espace assureur est ouvert : contrat et instructions transmis.",
    },
  ],
  documents: [
    { key: "offre", label: "Offre de prêt", received: true, requiredNow: false },
    { key: "amort", label: "Tableau d'amortissement", received: true, requiredNow: false },
    { key: "cni", label: "Pièce d'identité", received: false, requiredNow: false },
    { key: "rib", label: "RIB", received: false, requiredNow: false },
  ],
  tips: [
    "La suite du dossier se fait sur une plateforme d'adhésion sécurisée : vous recevrez les instructions par email.",
    "Pour toute question, répondez aux emails envoyés par Le Club Immobilier Français.",
  ],
  subscriptionPhase: "kereis_health",
  subscriptionPhaseLabel: "Kereis — Questionnaire de santé",
  lastUpdateLabel: new Date().toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }),
};
