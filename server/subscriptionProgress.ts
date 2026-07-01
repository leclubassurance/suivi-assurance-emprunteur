import type { Dossier } from "./dossierModel";
import { hasStudyBeenSent, getLastStudyOutbound } from "./dossierLifecycle";
import { clientHasAcceptedInsuranceChange } from "./insuranceAcceptance";
import { isLoanDocsStepComplete } from "./loanDocPresence";

/** Phases opérationnelles après envoi de l'étude. */
export type SubscriptionPhase =
  | "awaiting_decision"
  | "decision_received"
  | "adhesion_space_sent"
  | "completed";

/** Anciennes valeurs Firestore (Kereis détaillé) → regroupées. */
const LEGACY_KEREIS_PHASES = new Set([
  "kereis_cgu",
  "kereis_validation",
  "kereis_health",
  "kereis_signatures",
  "kereis_justificatifs",
  "kereis_attestation",
]);

export const SUBSCRIPTION_PHASE_OPTIONS: { value: SubscriptionPhase; label: string }[] = [
  { value: "awaiting_decision", label: "En attente de décision (après étude)" },
  { value: "decision_received", label: "Accord client reçu (automatique si mail)" },
  { value: "adhesion_space_sent", label: "Espace adhésion envoyé au client" },
  { value: "completed", label: "Dossier clos (client a terminé en ligne)" },
];

const PHASE_ORDER: SubscriptionPhase[] = [
  "awaiting_decision",
  "decision_received",
  "adhesion_space_sent",
  "completed",
];

/** Normalise une phase stockée (y compris anciennes valeurs Kereis). */
export function coerceSubscriptionPhase(v: unknown): SubscriptionPhase | null {
  const s = String(v || "").trim();
  if (!s) return null;
  if (PHASE_ORDER.includes(s as SubscriptionPhase)) return s as SubscriptionPhase;
  if (LEGACY_KEREIS_PHASES.has(s)) return "adhesion_space_sent";
  return null;
}

export function phaseRank(phase?: SubscriptionPhase | string | null): number {
  const normalized = coerceSubscriptionPhase(phase);
  if (!normalized) return -1;
  const i = PHASE_ORDER.indexOf(normalized);
  return i < 0 ? -1 : i;
}

export function isValidSubscriptionPhase(v: unknown): v is SubscriptionPhase {
  return coerceSubscriptionPhase(v) !== null;
}

export type SubscriptionProgress = {
  phase: SubscriptionPhase;
  updatedAt: string;
  updatedBy?: string;
  note?: string;
};

/** Avance automatiquement si accord client détecté dans les mails. */
export function ensureSubscriptionProgressOnAcceptance(dossier: Dossier): boolean {
  if (!hasStudyBeenSent(dossier)) return false;
  if (!clientHasAcceptedInsuranceChange(dossier)) return false;

  const current = coerceSubscriptionPhase(dossier.subscriptionProgress?.phase);
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

  const manual = coerceSubscriptionPhase(dossier.subscriptionProgress?.phase);
  if (manual) {
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

function adhesionClientHint(phase: SubscriptionPhase): string | undefined {
  if (phase === "adhesion_space_sent") {
    return "Connectez-vous à votre espace sécurisé : informations, questionnaire de santé, signatures et justificatifs.";
  }
  return undefined;
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
  const spaceSent = subRank >= phaseRank("adhesion_space_sent");
  const dossierClosed = subRank >= phaseRank("completed");

  const clientAdhesionHint =
    spaceSent && !dossierClosed
      ? adhesionClientHint("adhesion_space_sent") ||
        "Finalisez les étapes dans votre espace (questionnaire de santé, lecture et signature des documents)."
      : decisionDone && !spaceSent
        ? "Charles prépare votre dossier sur la plateforme partenaire avant l'ouverture de votre espace."
        : !decisionDone
          ? "Consultez l'étude reçue par email, puis confirmez-nous par retour de mail si vous souhaitez activer le changement."
          : undefined;

  const contractHint = spaceSent
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
      done: dossierClosed,
      hint: clientAdhesionHint,
    },
    {
      key: "adhesion_contract_sent",
      label: "Contrat d'adhésion envoyé",
      done: spaceSent || dossierClosed,
      hint: contractHint,
    },
  ];
}

export type ClientPortalStatusView = {
  label: string;
  description: string;
};

/** Met à jour la phase souscription (admin) et aligne le statut CRM pour Camille / le portail. */
export function applySubscriptionPhaseUpdate(
  dossier: Dossier,
  phase: SubscriptionPhase,
  meta?: { updatedBy?: string; note?: string },
): { previousPhase: SubscriptionPhase | null; label: string } {
  const previous = coerceSubscriptionPhase(dossier.subscriptionProgress?.phase);
  const now = new Date().toISOString();

  dossier.subscriptionProgress = {
    phase,
    updatedAt: now,
    updatedBy: meta?.updatedBy || "admin",
    note: meta?.note?.trim() || undefined,
  };

  if (phase === "completed") {
    dossier.status = "TRAITÉ";
  } else if (phase === "adhesion_space_sent") {
    dossier.status = "ADHESION_EN_COURS";
  } else if (phase === "decision_received") {
    dossier.status = "ADHESION_EN_COURS";
  } else if (phase === "awaiting_decision" && hasStudyBeenSent(dossier)) {
    const st = String(dossier.status || "");
    if (!["TRAITÉ", "TRAITE", "REFUSÉ", "REFUSE"].includes(st)) {
      dossier.status = "DECISION_EN_ATTENTE";
    }
  }

  const label = SUBSCRIPTION_PHASE_OPTIONS.find((o) => o.value === phase)?.label || phase;
  return { previousPhase: previous, label };
}

export function buildSubscriptionProgressAdminView(dossier: Dossier) {
  const studySent = hasStudyBeenSent(dossier);
  const effectivePhase = resolveEffectiveSubscriptionPhase(dossier);
  const manual = dossier.subscriptionProgress;
  return {
    studySent,
    clientAccepted: clientHasAcceptedInsuranceChange(dossier),
    effectivePhase,
    effectivePhaseLabel: effectivePhase
      ? SUBSCRIPTION_PHASE_OPTIONS.find((o) => o.value === effectivePhase)?.label || effectivePhase
      : null,
    manualPhase: coerceSubscriptionPhase(manual?.phase),
    manualUpdatedAt: manual?.updatedAt || null,
    manualNote: manual?.note || null,
    manualUpdatedBy: manual?.updatedBy || null,
    options: SUBSCRIPTION_PHASE_OPTIONS,
    dossierStatus: dossier.status,
    statusManualAt: dossier.statusManualAt || null,
  };
}

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

  if (subPhase === "adhesion_space_sent") {
    return {
      label: "Adhésion en ligne en cours",
      description:
        "Votre espace d'adhésion est ouvert : complétez le questionnaire de santé, signez vos documents et transmettez les justificatifs demandés.",
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
