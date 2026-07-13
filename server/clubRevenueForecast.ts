import type { Dossier } from "./dossierModel";
import type { Referral } from "../shared/apporteurTypes";
import { filterMetricsDossiers } from "./activityMetrics";
import {
  computeClubRevenueBreakdown,
  resolveFeesCourtageEur,
  type KereisMiaSettings,
} from "../shared/kereisMiaRemuneration";
import {
  buildClubRevenueForecastFromContributions,
  toMonthKey,
  toMonthKeyFromDate,
  type ClubRevenueForecast,
  type ForecastDossierContribution,
} from "../shared/clubRevenueForecast";
import { resolveClubRevenueDossierSegment } from "../shared/clubRevenueDossierSegment";
import { enrichDossierClubEconomics } from "./clubRevenueAutoSync";
import { hasStudyBeenSent } from "./dossierLifecycle";
import { resolveEffectiveSubscriptionPhase } from "./subscriptionProgress";
import { clientHasAcceptedInsuranceChange } from "./insuranceAcceptance";
import type { ApporteurRemunerationTier } from "../shared/apporteurRemuneration";

function buildSegmentInput(dossier: Dossier, referral?: Referral) {
  return {
    status: dossier.status,
    subscriptionPhase: resolveEffectiveSubscriptionPhase(dossier),
    clientAcceptedInsuranceAt: dossier.clientAcceptedInsuranceAt,
    clientAccepted: clientHasAcceptedInsuranceChange(dossier),
    studySent: hasStudyBeenSent(dossier),
    studyKpiExtracted: Boolean(dossier.studyKpi?.extractedAt),
    referralStatus: referral?.status,
    paymentStatus: dossier.clubRevenueKpi?.paymentStatus,
  };
}

function resolveSignedMonthKey(dossier: Dossier, referral?: Referral): string {
  const fromKpi = dossier.clubRevenueKpi?.signedAt;
  if (fromKpi) {
    const k = toMonthKey(fromKpi);
    if (k) return k;
  }
  if (dossier.clientAcceptedInsuranceAt) {
    const k = toMonthKey(dossier.clientAcceptedInsuranceAt);
    if (k) return k;
  }
  if (referral?.status === "SIGNE") {
    const sigEv = [...(referral.events || [])]
      .filter((e) => e.status === "SIGNE")
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0];
    if (sigEv?.at) {
      const k = toMonthKey(sigEv.at);
      if (k) return k;
    }
    const k = toMonthKey(referral.updatedAt);
    if (k) return k;
  }
  const planned = dossier.insuranceChangePlan?.plannedDate;
  if (planned) {
    const k = toMonthKey(planned);
    if (k) return k;
  }
  const studyAt = dossier.studyKpi?.extractedAt || dossier.updatedAt;
  const k = toMonthKey(studyAt);
  return k || toMonthKey(new Date().toISOString());
}

function resolveProjectedMonthKey(dossier: Dossier, now = new Date()): string {
  const planned = dossier.insuranceChangePlan?.plannedDate;
  if (planned) {
    const k = toMonthKey(planned);
    const plannedDate = new Date(planned.includes("T") ? planned : `${planned}T12:00:00`);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    if (k && plannedDate.getTime() >= monthStart.getTime()) {
      return k;
    }
  }
  return toMonthKeyFromDate(now);
}

function hasForecastEconomics(dossier: Dossier): boolean {
  if (resolveFeesCourtageEur(dossier) > 0) return true;
  const b = computeClubRevenueBreakdown(dossier);
  return b.monthlyLinearCommissionEur > 0 || b.annualPremiumEur > 0;
}

export function buildClubRevenueForecast(params: {
  dossiers: Dossier[];
  referrals: Referral[];
  resolveApporteurTier?: (apporteurId: string) => ApporteurRemunerationTier | undefined;
  kereisSettings: KereisMiaSettings;
  monthsPast?: number;
  monthsFuture?: number;
  now?: Date;
}): ClubRevenueForecast {
  const referralByDossier = new Map<string, Referral>();
  for (const r of params.referrals) {
    if (r.dossierId) referralByDossier.set(r.dossierId, r);
  }

  const contributions: ForecastDossierContribution[] = [];
  const scoped = filterMetricsDossiers(params.dossiers);
  const now = params.now ?? new Date();

  for (const dossier of scoped) {
    enrichDossierClubEconomics(dossier);
    const referral = referralByDossier.get(dossier.id);
    const segmentInput = buildSegmentInput(dossier, referral);
    segmentInput.feesCourtageEur = resolveFeesCourtageEur(dossier);
    segmentInput.hasEconomics = hasForecastEconomics(dossier);

    const segment = resolveClubRevenueDossierSegment(segmentInput);
    if (!segment) continue;

    const apporteurId = dossier.apporteur?.apporteurId;
    const breakdown = computeClubRevenueBreakdown(dossier, {
      apporteurTier: apporteurId ? params.resolveApporteurTier?.(apporteurId) : undefined,
      kereisSettings: params.kereisSettings,
    });

    if (
      breakdown.feesCourtageEur <= 0 &&
      breakdown.monthlyLinearCommissionEur <= 0 &&
      breakdown.annualPremiumEur <= 0
    ) {
      continue;
    }

    const startMonthKey =
      segment === "pipeline"
        ? resolveProjectedMonthKey(dossier, now)
        : resolveSignedMonthKey(dossier, referral);

    contributions.push({
      id: dossier.id,
      segment,
      startMonthKey,
      courtageGrossEur: breakdown.feesCourtageEur,
      courtageNetEur: breakdown.clubCourtageNetEur,
      monthlyCommissionEur: breakdown.monthlyLinearCommissionEur,
      dossierStatus: String(dossier.status || ""),
    });
  }

  return buildClubRevenueForecastFromContributions(contributions, {
    monthsPast: params.monthsPast,
    monthsFuture: params.monthsFuture,
    now: params.now,
  });
}
