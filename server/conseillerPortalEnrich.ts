import type { Referral } from "../shared/apporteurTypes";
import type { RemunerationConfig } from "../shared/apporteurRemuneration";
import type { ConseillerOperatingPhase } from "../shared/conseillerImmoClub";
import {
  CONSEILLER_SUBSCRIPTION_STATUS_LABELS,
  type ConseillerSubscriptionPackage,
  type ConseillerSubscriptionStatus,
} from "../shared/conseillerSubscription";
import type { Dossier } from "./dossierModel";
import { hasStudyBeenSent, isStudyPendingConseillerValidation } from "./dossierLifecycle";
import { clientHasAcceptedInsuranceChange } from "./insuranceAcceptance";
import { resolveDossierCommission } from "../shared/apporteurCommissionFromDossier";
import type { ApporteurReferralTracking } from "./apporteurPortalEnrich";
import {
  ensureClientPortalToken,
  getClientPortalAbsoluteUrl,
} from "./clientPortal";
import { resolveClientPortalStatusView } from "./subscriptionProgress";
import {
  formatInsuranceChangePlanLabel,
  getInsuranceChangePlan,
} from "./insuranceChangePlan";
import {
  buildStudyValidationSummaryForPortal,
  type StudyConseillerValidation,
} from "./studyConseillerValidation";

export type ConseillerPortalCommunication = {
  direction: "inbound" | "outbound";
  date: string;
  subject?: string;
  excerpt: string;
  from?: string;
  to?: string;
};

function mapCommunications(dossier: Dossier): ConseillerPortalCommunication[] {
  return [...(dossier.communications || [])]
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
    .slice(0, 12)
    .map((c) => ({
      direction: c.direction === "inbound" ? "inbound" : "outbound",
      date: String(c.date || ""),
      subject: c.subject ? String(c.subject) : undefined,
      excerpt: String(c.text || c.html || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 280),
      from: c.from ? String(c.from) : undefined,
      to: c.to ? String(c.to) : undefined,
    }))
    .filter((c) => c.excerpt.length > 0 || c.subject);
}

function buildConseillerSubscriptionSteps(
  dossier: Dossier,
  operatingPhase: ConseillerOperatingPhase,
): { key: string; label: string; done: boolean; active: boolean }[] {
  const studyPendingValidation = isStudyPendingConseillerValidation(dossier);
  const studySent = hasStudyBeenSent(dossier);
  const accepted = clientHasAcceptedInsuranceChange(dossier);
  const sub: ConseillerSubscriptionPackage | undefined = (dossier as any).conseillerSubscription;
  const subStatus: ConseillerSubscriptionStatus = sub?.status || "pending";

  const steps = [
    {
      key: "study_validation",
      label: "Validation courtage (conseiller)",
      done: studySent,
      active: studyPendingValidation,
    },
    { key: "study", label: "Étude envoyée au client", done: studySent, active: false },
    {
      key: "decision",
      label: "Décision client",
      done: accepted && studySent,
      active: studySent && !accepted,
    },
  ];

  if (operatingPhase !== "autonomous") {
    const activeKey = studyPendingValidation
      ? "study_validation"
      : !studySent
        ? "study"
        : studySent && !accepted
          ? "decision"
          : null;
    return steps.map((s) => ({
      ...s,
      active: s.key === activeKey,
    }));
  }

  const clubSteps = [
    {
      key: "sub_form",
      label: "Formulaire souscription (conseiller)",
      done: Boolean(sub?.submittedAt),
      active: accepted && !sub?.submittedAt,
    },
    {
      key: "infos_recues",
      label: CONSEILLER_SUBSCRIPTION_STATUS_LABELS.infos_recues,
      done: ["infos_recues", "souscription_en_cours", "souscription_faite"].includes(subStatus),
      active: Boolean(sub?.submittedAt) && subStatus === "pending",
    },
    {
      key: "souscription_en_cours",
      label: CONSEILLER_SUBSCRIPTION_STATUS_LABELS.souscription_en_cours,
      done: ["souscription_en_cours", "souscription_faite"].includes(subStatus),
      active: subStatus === "infos_recues",
    },
    {
      key: "souscription_faite",
      label: CONSEILLER_SUBSCRIPTION_STATUS_LABELS.souscription_faite,
      done: subStatus === "souscription_faite",
      active: subStatus === "souscription_en_cours",
    },
  ];

  const all = [...steps, ...clubSteps];
  const firstPending = all.find((s) => !s.done);
  return all.map((s) => ({
    ...s,
    active: !s.done && s.key === firstPending?.key,
  }));
}

export function enrichReferralForConseillerPortal(params: {
  referral: Referral;
  dossier: Dossier;
  publicBaseUrl: string;
  remuneration: RemunerationConfig;
  operatingPhase: ConseillerOperatingPhase;
  payoutSharePercent: number;
}): ApporteurReferralTracking & {
  communications: ConseillerPortalCommunication[];
  conseillerSubscription?: ConseillerSubscriptionPackage | null;
  clientAccepted: boolean;
  studySent: boolean;
  operatingPhase: ConseillerOperatingPhase;
  canSubmitSubscription: boolean;
  studyValidationPending: ReturnType<typeof buildStudyValidationSummaryForPortal> & {
    dossierId: string;
    subject: string;
    submittedAt: string;
  } | null;
} {
  const { referral, dossier, publicBaseUrl, remuneration, operatingPhase, payoutSharePercent } = params;
  let token = String(dossier.clientPortal?.token || "");
  if (!token || token.length < 24) {
    token = ensureClientPortalToken(dossier);
  }

  const studyValidationRaw = (dossier as Dossier & { studyConseillerValidation?: StudyConseillerValidation })
    .studyConseillerValidation;
  const studyValidationPending =
    studyValidationRaw?.status === "pending"
      ? {
          dossierId: dossier.id,
          subject: studyValidationRaw.subject,
          submittedAt: studyValidationRaw.submittedAt,
          ...buildStudyValidationSummaryForPortal(studyValidationRaw, remuneration),
        }
      : null;

  const studySent = hasStudyBeenSent(dossier);
  const clientAccepted = clientHasAcceptedInsuranceChange(dossier);

  const statusView = studyValidationRaw?.status === "pending"
    ? {
        label: "Étude en validation — courtage",
        description:
          "L'étude a été préparée par LCIF. Validez les frais de courtage pour déclencher l'envoi au client.",
      }
    : studySent && !clientAccepted
      ? {
          label: "Étude envoyée — décision en attente",
          description:
            "L'étude a été transmise au client. En attente de son accord pour activer le changement d'assurance.",
        }
      : resolveClientPortalStatusView(dossier);
  const steps = buildConseillerSubscriptionSteps(dossier, operatingPhase);
  const commission = (() => {
    const c = resolveDossierCommission(dossier, remuneration);
    return {
      feesCourtageEur: c.feesCourtageEur,
      apporteurPayoutEur: c.apporteurPayoutEur,
      source: c.source,
      hasStudyFees: c.hasStudyFees,
      payoutSharePercent,
    };
  })();

  const sub = (dossier as any).conseillerSubscription as ConseillerSubscriptionPackage | undefined;
  const canSubmitSubscription =
    operatingPhase === "autonomous" &&
    studySent &&
    clientAccepted &&
    (!sub?.submittedAt || sub.status === "pending");

  const changePlan = getInsuranceChangePlan(dossier);

  return {
    dossierId: dossier.id,
    clientPortalUrl: getClientPortalAbsoluteUrl(token, publicBaseUrl),
    statusLabel: statusView.label,
    statusDetail: statusView.description,
    plannedChangeDateLabel: changePlan
      ? formatInsuranceChangePlanLabel(changePlan.plannedDate)
      : undefined,
    steps,
    commission,
    communications: mapCommunications(dossier),
    conseillerSubscription: sub || null,
    clientAccepted,
    studySent,
    operatingPhase,
    canSubmitSubscription,
    studyValidationPending,
  };
}
