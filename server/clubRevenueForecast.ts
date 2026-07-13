import type { Dossier } from "./dossierModel";
import type { Referral, ReferralStatus } from "../shared/apporteurTypes";
import { filterMetricsDossiers } from "./activityMetrics";
import {
  computeClubRevenueBreakdown,
  type KereisMiaSettings,
} from "../shared/kereisMiaRemuneration";
import {
  buildClubRevenueForecastFromContributions,
  nextMonthKey,
  toMonthKey,
  type ClubRevenueForecast,
  type ForecastDossierContribution,
} from "../shared/clubRevenueForecast";
import { hasStudyBeenSent } from "./dossierLifecycle";
import { resolveEffectiveSubscriptionPhase } from "./subscriptionProgress";
import { clientHasAcceptedInsuranceChange } from "./insuranceAcceptance";
import { resolveRemunerationTier, type ApporteurRemunerationTier } from "../shared/apporteurRemuneration";

const CLOSED: ReferralStatus[] = ["REFUSE", "PERDU"];

function isDossierSigned(dossier: Dossier, referral?: Referral): boolean {
  if (referral?.status === "SIGNE") return true;
  const phase = resolveEffectiveSubscriptionPhase(dossier);
  if (phase === "completed") return true;
  if (clientHasAcceptedInsuranceChange(dossier)) {
    const st = String(dossier.status || "");
    if (["TRAITÉ", "TRAITE", "CLOS"].includes(st)) return true;
  }
  return false;
}

function isDossierPipeline(dossier: Dossier, referral?: Referral): boolean {
  if (isDossierSigned(dossier, referral)) return false;
  if (referral && CLOSED.includes(referral.status)) return false;
  if (!hasStudyBeenSent(dossier) && !dossier.studyKpi?.feesCourtageEur) return false;

  const phase = resolveEffectiveSubscriptionPhase(dossier);
  if (phase === "adhesion_space_sent" || phase === "decision_received") return true;
  if (referral && !CLOSED.includes(referral.status)) {
    if (["ETUDE_ENVOYEE", "DOSSIER_OUVERT", "CONTACTE", "NOUVEAU"].includes(referral.status)) {
      return hasStudyBeenSent(dossier) || Boolean(dossier.studyKpi?.extractedAt);
    }
  }
  return hasStudyBeenSent(dossier) && Boolean(dossier.studyKpi?.feesCourtageEur);
}

function resolveSignedMonthKey(dossier: Dossier, referral?: Referral): string {
  const fromKpi = dossier.clubRevenueKpi?.signedAt;
  if (fromKpi) {
    const k = toMonthKey(fromKpi);
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
    if (k && plannedDate.getTime() >= new Date(now.getFullYear(), now.getMonth(), 1).getTime()) {
      return k;
    }
  }
  return nextMonthKey(now);
}

function hasForecastEconomics(dossier: Dossier): boolean {
  const b = computeClubRevenueBreakdown(dossier);
  return (
    b.feesCourtageEur > 0 ||
    b.monthlyLinearCommissionEur > 0 ||
    b.annualPremiumEur > 0
  );
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

  for (const dossier of scoped) {
    if (!hasForecastEconomics(dossier)) continue;

    const referral = referralByDossier.get(dossier.id);
    const apporteurId = dossier.apporteur?.apporteurId;
    const breakdown = computeClubRevenueBreakdown(dossier, {
      apporteurTier: apporteurId ? params.resolveApporteurTier?.(apporteurId) : undefined,
      kereisSettings: params.kereisSettings,
    });

    const monthlyPremiumEur =
      breakdown.annualPremiumEur > 0
        ? Math.round(breakdown.annualPremiumEur / 12)
        : 0;

    const base = {
      id: dossier.id,
      courtageNetEur: breakdown.clubCourtageNetEur,
      monthlyCommissionEur: breakdown.monthlyLinearCommissionEur,
      monthlyPremiumEur,
    };

    if (isDossierSigned(dossier, referral)) {
      contributions.push({
        ...base,
        segment: "signed",
        startMonthKey: resolveSignedMonthKey(dossier, referral),
      });
    } else if (isDossierPipeline(dossier, referral)) {
      contributions.push({
        ...base,
        segment: "pipeline",
        startMonthKey: resolveProjectedMonthKey(dossier, params.now),
      });
    }
  }

  return buildClubRevenueForecastFromContributions(contributions, {
    monthsPast: params.monthsPast,
    monthsFuture: params.monthsFuture,
    now: params.now,
  });
}
