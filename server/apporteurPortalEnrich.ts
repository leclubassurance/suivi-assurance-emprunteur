import type { Referral } from "../shared/apporteurTypes";
import type { RemunerationConfig } from "../shared/apporteurRemuneration";
import {
  resolveDossierCommission,
  type CommissionSource,
} from "../shared/apporteurCommissionFromDossier";
import type { Dossier } from "./dossierModel";
import {
  ensureClientPortalToken,
  getClientPortalAbsoluteUrl,
} from "./clientPortal";
import { buildClientPortalSteps, resolveClientPortalStatusView } from "./subscriptionProgress";
import {
  formatInsuranceChangePlanLabel,
  getInsuranceChangePlan,
} from "./insuranceChangePlan";
import { hasStudyBeenSent, isStudyPendingConseillerValidation } from "./dossierLifecycle";
import {
  buildPortalStudyValidationPending,
  type StudyConseillerValidation,
} from "./studyConseillerValidation";

export type ApporteurReferralCommission = {
  feesCourtageEur: number;
  apporteurPayoutEur: number;
  source: CommissionSource | "pending_validation";
  hasStudyFees: boolean;
  payoutSharePercent?: number;
};

export type ApporteurReferralStudyValidationPending = NonNullable<
  ReturnType<typeof buildPortalStudyValidationPending>
>;

export type ApporteurReferralTracking = {
  dossierId: string;
  clientPortalUrl: string;
  statusLabel: string;
  statusDetail?: string;
  plannedChangeDateLabel?: string;
  steps: { key: string; label: string; done: boolean; active: boolean }[];
  commission?: ApporteurReferralCommission | null;
  studyValidationPending?: ApporteurReferralStudyValidationPending | null;
};

function buildApporteurStudyValidationSteps(dossier: Dossier) {
  const studyPendingValidation = isStudyPendingConseillerValidation(dossier);
  const validationApproved = dossier.studyConseillerValidation?.status === "approved";
  const studySent = hasStudyBeenSent(dossier);

  const steps = [
    {
      key: "study_validation",
      label: "Validation courtage (partenaire)",
      done: validationApproved || studySent,
      active: studyPendingValidation,
    },
    { key: "study", label: "Étude envoyée au client", done: studySent, active: false },
    {
      key: "study_lcif_send",
      label: "Envoi étude (LCIF)",
      done: studySent,
      active: validationApproved && !studySent,
    },
  ];

  const visibleStudySteps =
    validationApproved && !studySent
      ? steps.filter((s) => s.key !== "study")
      : steps.filter((s) => s.key !== "study_lcif_send");

  const activeKey = studyPendingValidation
    ? "study_validation"
    : validationApproved && !studySent
      ? "study_lcif_send"
      : !studySent
        ? "study_validation"
        : null;

  return visibleStudySteps.map((s) => ({
    ...s,
    active: s.key === activeKey,
  }));
}

function resolveApporteurPortalStatusView(dossier: Dossier) {
  const studyValidationRaw = (dossier as Dossier & {
    studyConseillerValidation?: StudyConseillerValidation;
  }).studyConseillerValidation;
  const studySent = hasStudyBeenSent(dossier);

  if (studyValidationRaw?.status === "pending") {
    return {
      label: "Débrief — validation courtage",
      description:
        "Validez les frais de courtage. L'équipe LCIF enverra l'étude au client après votre validation.",
    };
  }
  if (studyValidationRaw?.status === "approved" && !studySent) {
    return {
      label: "Courtage validé — envoi LCIF",
      description:
        "Les frais de courtage sont validés. L'équipe LCIF prépare l'envoi de l'étude au client.",
    };
  }
  if (studyValidationRaw?.status === "cancelled" && !studySent) {
    return {
      label: "Dossier en préparation",
      description:
        "Une précédente validation courtage a été annulée. LCIF prépare une nouvelle étude à vous soumettre.",
    };
  }
  return resolveClientPortalStatusView(dossier);
}

export async function enrichReferralsForApporteurPortal(
  referrals: Referral[],
  publicBaseUrl: string,
  remuneration?: RemunerationConfig,
): Promise<
  Array<{
    id: string;
    status: Referral["status"];
    contact: Referral["contact"];
    createdAt: string;
    updatedAt: string;
    events: Referral["events"];
    tracking: ApporteurReferralTracking | null;
  }>
> {
  const { readDB, writeDB } = await import("./db");
  const db = await readDB();
  const dossierById = new Map<string, Dossier>();
  for (const d of db.dossiers) dossierById.set(d.id, d);

  const results: Array<{
    id: string;
    status: Referral["status"];
    contact: Referral["contact"];
    createdAt: string;
    updatedAt: string;
    events: Referral["events"];
    tracking: ApporteurReferralTracking | null;
  }> = [];

  for (const r of referrals) {
    const base = {
      id: r.id,
      status: r.status,
      contact: r.contact,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      events: (r.events || []).slice(-5),
      tracking: null as ApporteurReferralTracking | null,
    };

    if (!r.dossierId) {
      results.push(base);
      continue;
    }

    const dossier = dossierById.get(r.dossierId);
    if (!dossier) {
      results.push(base);
      continue;
    }

    let token = String(dossier.clientPortal?.token || "");
    if (!token || token.length < 24) {
      token = ensureClientPortalToken(dossier);
      try {
        await writeDB(db, dossier);
      } catch {
        /* non bloquant */
      }
    }

    const studyValidationPending =
      remuneration != null ? buildPortalStudyValidationPending(dossier, remuneration) : null;
    const hasStudyValidationFlow = Boolean(
      studyValidationPending ||
        dossier.studyConseillerValidation?.status === "approved" ||
        dossier.studyConseillerValidation?.status === "pending" ||
        dossier.studyConseillerValidation?.status === "cancelled",
    );

    const steps = hasStudyValidationFlow
      ? buildApporteurStudyValidationSteps(dossier)
      : buildClientPortalSteps(dossier).map((s, _, arr) => {
          const firstPending = arr.find((step) => !step.done);
          return {
            key: s.key,
            label: s.label,
            done: Boolean(s.done),
            active: !s.done && s.key === firstPending?.key,
          };
        });

    const statusView = hasStudyValidationFlow
      ? resolveApporteurPortalStatusView(dossier)
      : resolveClientPortalStatusView(dossier);

    const changePlan = getInsuranceChangePlan(dossier);
    const payoutSharePercent = remuneration?.apporteurShareOfBrokerage;

    base.tracking = {
      dossierId: dossier.id,
      clientPortalUrl: getClientPortalAbsoluteUrl(token, publicBaseUrl),
      statusLabel: statusView.label,
      statusDetail: statusView.description,
      plannedChangeDateLabel: changePlan
        ? formatInsuranceChangePlanLabel(changePlan.plannedDate)
        : undefined,
      steps,
      studyValidationPending,
      commission: remuneration
        ? (() => {
            if (studyValidationPending) {
              return {
                feesCourtageEur: studyValidationPending.feesCourtageTotalEur,
                apporteurPayoutEur: studyValidationPending.conseillerRetroEur,
                source: "pending_validation" as const,
                hasStudyFees: false,
                payoutSharePercent,
              };
            }
            const c = resolveDossierCommission(dossier, remuneration);
            return {
              feesCourtageEur: c.feesCourtageEur,
              apporteurPayoutEur: c.apporteurPayoutEur,
              source: c.source,
              hasStudyFees: c.hasStudyFees,
              payoutSharePercent,
            };
          })()
        : null,
    };
    results.push(base);
  }

  return results;
}
