import type { Dossier } from "./dossierModel";
import { hasStudyBeenSent, getLastStudyOutbound } from "./dossierLifecycle";
import { clientHasAcceptedInsuranceChange } from "./insuranceAcceptance";
import { isLoanDocsStepComplete } from "./loanDocPresence";

/** Phases opérationnelles après envoi de l'étude (alignées sur le parcours Kereis). */
export type SubscriptionPhase =
  | "awaiting_decision"
  | "decision_received"
  | "kereis_cgu"
  | "kereis_validation"
  | "kereis_health"
  | "kereis_signatures"
  | "kereis_justificatifs"
  | "kereis_attestation"
  | "completed";

export type SubscriptionProgress = {
  phase: SubscriptionPhase;
  updatedAt: string;
  updatedBy?: string;
  note?: string;
};

export const SUBSCRIPTION_PHASE_OPTIONS: { value: SubscriptionPhase; label: string }[] = [
  { value: "awaiting_decision", label: "En attente de votre décision (après étude)" },
  { value: "decision_received", label: "Accord client reçu — à traiter sur Kereis" },
  { value: "kereis_cgu", label: "Kereis — CGU et démarrage adhésion" },
  { value: "kereis_validation", label: "Kereis — Validation des informations" },
  { value: "kereis_health", label: "Kereis — Questionnaire de santé" },
  { value: "kereis_signatures", label: "Kereis — Signature des documents" },
  { value: "kereis_justificatifs", label: "Kereis — Justificatifs et proposition" },
  { value: "kereis_attestation", label: "Kereis — Client : proposition / attestation" },
  { value: "completed", label: "Dossier clos (parcours client terminé)" },
];

const PHASE_ORDER: SubscriptionPhase[] = [
  "awaiting_decision",
  "decision_received",
  "kereis_cgu",
  "kereis_validation",
  "kereis_health",
  "kereis_signatures",
  "kereis_justificatifs",
  "kereis_attestation",
  "completed",
];

export function phaseRank(phase?: SubscriptionPhase | string | null): number {
  if (!phase) return -1;
  const i = PHASE_ORDER.indexOf(phase as SubscriptionPhase);
  return i < 0 ? -1 : i;
}

export function isValidSubscriptionPhase(v: unknown): v is SubscriptionPhase {
  return typeof v === "string" && PHASE_ORDER.includes(v as SubscriptionPhase);
}

/** Avance automatiquement si accord client détecté dans les mails. */
export function ensureSubscriptionProgressOnAcceptance(dossier: Dossier): boolean {
  if (!hasStudyBeenSent(dossier)) return false;
  if (!clientHasAcceptedInsuranceChange(dossier)) return false;

  const current = dossier.subscriptionProgress?.phase;
  if (phaseRank(current) >= phaseRank("decision_received")) return false;

  dossier.subscriptionProgress = {
    phase: "decision_received",
    updatedAt: new Date().toISOString(),
    updatedBy: "system",
    note: "Accord pour le changement d'assurance détecté dans un message client.",
  };
  return true;
}

export function resolveEffectiveSubscriptionPhase(dossier: Dossier): SubscriptionPhase | null {
  const st = String(dossier.status || "");
  if (["TRAITÉ", "TRAITE", "CLOS"].includes(st)) return "completed";
  if (!hasStudyBeenSent(dossier)) return null;

  const manual = dossier.subscriptionProgress?.phase;
  if (manual && isValidSubscriptionPhase(manual)) {
    if (clientHasAcceptedInsuranceChange(dossier) && phaseRank(manual) < phaseRank("decision_received")) {
      return "decision_received";
    }
    return manual;
  }

  if (clientHasAcceptedInsuranceChange(dossier)) return "decision_received";
  return "awaiting_decision";
}

export type PortalStep = {
  key: string;
  label: string;
  done: boolean;
  hint?: string;
};

function kereisHint(phase: SubscriptionPhase): string | undefined {
  switch (phase) {
    case "kereis_cgu":
      return "Vous recevrez un accès à l'espace d'adhésion en ligne sécurisé (plateforme partenaire).";
    case "kereis_validation":
      return "Vérification de vos coordonnées, adresse et informations bancaires.";
    case "kereis_health":
      return "Questionnaire de santé en ligne (obligatoire pour l'assureur).";
    case "kereis_signatures":
      return "Signature électronique des documents contractuels.";
    case "kereis_justificatifs":
      return "Consultation de la proposition et envoi des justificatifs demandés.";
    case "kereis_attestation":
      return "Consultation de la proposition, justificatifs et signature finale dans votre espace.";
    default:
      return undefined;
  }
}

export function buildClientPortalSteps(dossier: Dossier): PortalStep[] {
  const studySent = hasStudyBeenSent(dossier);
  const lastStudy = getLastStudyOutbound(dossier);
  const subPhase = resolveEffectiveSubscriptionPhase(dossier);
  const subRank = phaseRank(subPhase);

  const base: PortalStep[] = [
    { key: "received", label: "Demande enregistrée", done: true },
    {
      key: "docs",
      label: "Offre de prêt et tableau d'amortissement",
      done: isLoanDocsStepComplete(dossier),
    },
    {
      key: "study",
      label: "Analyse et étude des économies",
      done: studySent,
      hint: studySent ? undefined : "Notre équipe prépare votre comparaison d'assurance emprunteur",
    },
    {
      key: "study_email",
      label: "Étude transmise par email",
      done: studySent,
      hint: lastStudy?.subject ? `Envoi : ${lastStudy.subject.slice(0, 60)}` : undefined,
    },
  ];

  if (!studySent) return base;

  const decisionDone = subRank >= phaseRank("decision_received");
  const contractSent = subRank >= phaseRank("kereis_cgu");
  const clientAdhesionActive =
    contractSent && subRank < phaseRank("kereis_attestation") && subRank < phaseRank("completed");
  const clientAdhesionDone = subRank >= phaseRank("kereis_attestation");
  const dossierClosed = subRank >= phaseRank("completed");

  const clientAdhesionHint =
    clientAdhesionActive && subPhase
      ? kereisHint(subPhase) ||
        "Dans votre espace : vérifiez vos informations, complétez le questionnaire de santé et signez vos documents."
      : decisionDone && !contractSent
        ? "Charles prépare votre dossier sur la plateforme partenaire avant l'ouverture de votre espace."
        : !contractSent
          ? "Consultez l'étude reçue par email, puis confirmez-nous par retour de mail si vous souhaitez activer le changement."
          : "Questionnaire de santé, lecture des contrats et signatures électroniques à réaliser dans votre espace sécurisé.";

  const contractHint = contractSent
    ? "Votre espace assureur est ouvert : le contrat d'adhésion et les instructions vous ont été transmis (email / plateforme sécurisée)."
    : decisionDone
      ? "Nous finalisons votre dossier côté assureur, puis nous vous transmettons l'accès à votre espace d'adhésion."
      : undefined;

  return [
    ...base,
    {
      key: "client_decision",
      label: "Votre décision sur le changement d'assurance",
      done: decisionDone,
      hint: decisionDone
        ? "Merci — nous avons bien pris note de votre accord."
        : "Répondez à notre email pour nous indiquer si vous souhaitez poursuivre la substitution.",
    },
    {
      key: "kereis_adhesion",
      label: "Préparation du contrat de l'assurance",
      done: clientAdhesionDone || dossierClosed,
      hint: clientAdhesionHint,
    },
    {
      key: "adhesion_contract_sent",
      label: "Contrat d'adhésion envoyé",
      done: contractSent || dossierClosed,
      hint: contractHint,
    },
  ];
}

export type ClientPortalStatusView = {
  label: string;
  description: string;
};

export function resolveClientPortalStatusView(dossier: Dossier): ClientPortalStatusView {
  const subPhase = resolveEffectiveSubscriptionPhase(dossier);
  const studySent = hasStudyBeenSent(dossier);

  if (subPhase === "completed") {
    return {
      label: "Dossier terminé",
      description:
        "Vous avez finalisé les étapes en ligne. Pour toute question sur vos documents ou votre contrat, contactez-nous par email.",
    };
  }

  if (subPhase === "kereis_attestation") {
    return {
      label: "Dernières étapes en ligne",
      description:
        "Dans votre espace : proposition, justificatifs éventuels et signature finale. Ce n'est pas encore la mise en place définitive de l'assurance côté banque.",
    };
  }

  if (
    subPhase &&
    ["kereis_cgu", "kereis_validation", "kereis_health", "kereis_signatures", "kereis_justificatifs"].includes(
      subPhase,
    )
  ) {
    const detail = kereisHint(subPhase);
    return {
      label: "Adhésion en ligne en cours",
      description:
        detail ||
        "Vous finalisez votre changement d'assurance sur la plateforme sécurisée. Notre équipe reste disponible par email.",
    };
  }

  if (subPhase === "decision_received") {
    return {
      label: "Décision reçue — finalisation en cours",
      description:
        "Nous avons bien pris note de votre accord. Charles et l'équipe préparent la suite de votre adhésion (vous serez guidé par email).",
    };
  }

  if (studySent || subPhase === "awaiting_decision") {
    return {
      label: "Étude envoyée — en attente de votre décision",
      description:
        "Votre étude personnalisée vous a été transmise par email. Indiquez-nous si vous souhaitez activer le changement d'assurance pour lancer la suite du dossier.",
    };
  }

  const st = String(dossier.status || "EN_COURS");
  if (st === "EN_ATTENTE_CLIENT") {
    return {
      label: "En attente de votre retour",
      description: "Un email vous a été envoyé — merci de répondre ou d'envoyer les éléments demandés.",
    };
  }
  if (st === "NOUVEAU") {
    return {
      label: "Demande reçue",
      description: "Votre dossier est enregistré. Notre équipe prépare votre étude.",
    };
  }
  return {
    label: "Analyse en cours",
    description:
      "Nous vérifions vos documents de prêt. Vous recevrez un email dès que votre étude personnalisée sera prête.",
  };
}
