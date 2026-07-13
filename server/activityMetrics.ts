import type { Dossier } from "./dossierModel";
import { isVisibleAdminDossier } from "../shared/camilleMeta";
import { isLeadDossier } from "./leadDossierMerge";
import { assessCertainLoanDocProblems } from "./loanDocCertainty";
import { computeDocumentChecklist } from "../shared/documentChecklist";
import {
  computeClubRevenueBreakdown,
  formatClubRevenueEur,
} from "../shared/kereisMiaRemuneration";
import type { KereisMiaSettings } from "../shared/kereisMiaRemuneration";
import {
  formatEurKpi,
  getLoanCapitalFromDossier,
  getStudyKpiActivityDate,
  type StudyKpiRecord,
} from "./studyEmailKpi";

export type ActivityMetrics = {
  periodDays: number;
  totalDossiers: number;
  newDossiers: number;
  openEscalations: number;
  awaitingClient: number;
  activeEnCours: number;
  clientMessages7d: number;
  camilleReplies7d: number;
  avgDaysToFirstOutbound: number | null;
  loanDocsOkRate: number;
  certainDocProblemCount: number;
  /** Dossiers avec KPI étude (cumul actif). */
  studiesWithKpi: number;
  /** Dossiers avec KPI dont l'étude tombe dans la période glissante. */
  studiesWithKpiInPeriod: number;
  totalEconomiesRealiseesEur: number;
  totalEconomiesRealiseesLabel: string;
  totalMontantPretsAccompagnesEur: number;
  totalMontantPretsAccompagnesLabel: string;
  totalGainsFraisCourtageEur: number;
  totalGainsFraisCourtageLabel: string;
  periodEconomiesRealiseesEur: number;
  periodEconomiesRealiseesLabel: string;
  periodMontantPretsAccompagnesEur: number;
  periodMontantPretsAccompagnesLabel: string;
  periodGainsFraisCourtageEur: number;
  periodGainsFraisCourtageLabel: string;
  totalClubGrossEur: number;
  totalClubGrossLabel: string;
  totalClubNetEur: number;
  totalClubNetLabel: string;
  periodClubGrossEur: number;
  periodClubGrossLabel: string;
  periodClubNetEur: number;
  periodClubNetLabel: string;
  dossiersWithClubRevenue: number;
  dossiersWithClubRevenueInPeriod: number;
  kpiHelp: {
    economies: string;
    prets: string;
    courtage: string;
    clubGross: string;
    clubNet: string;
    periodLabel: string;
  };
};

export type ActivityMetricsOptions = {
  resolveApporteurTier?: (apporteurId: string) => import("../shared/apporteurRemuneration").ApporteurRemunerationTier | undefined;
  kereisSettings?: KereisMiaSettings;
};

/** Dossiers pris en compte dans le bandeau admin (hors meta Camille et prospects pré-formulaire). */
export function filterMetricsDossiers(dossiers: Dossier[]): Dossier[] {
  return (dossiers || []).filter((d) => isVisibleAdminDossier(d.id) && !isLeadDossier(d));
}

function hasUsableStudyKpi(kpi: StudyKpiRecord | undefined | null): kpi is StudyKpiRecord {
  return Boolean(kpi?.extractedAt);
}

function accumulateStudyKpi(
  kpi: StudyKpiRecord,
  dossier: Dossier,
  totals: {
    economies: number;
    prets: number;
    courtage: number;
  },
) {
  const gross = Number(kpi.grossSavingsEur) || 0;
  if (gross > 0) totals.economies += gross;
  const loan =
    Number(kpi.loanCapitalEur) > 0 ? Number(kpi.loanCapitalEur) : getLoanCapitalFromDossier(dossier);
  if (loan > 0) totals.prets += loan;
  totals.courtage += Number(kpi.feesCourtageEur) || 0;
}

function accumulateClubRevenue(
  dossier: Dossier,
  totals: { gross: number; net: number },
  options?: ActivityMetricsOptions,
) {
  const apporteurId = dossier.apporteur?.apporteurId;
  const tier = apporteurId ? options?.resolveApporteurTier?.(apporteurId) : undefined;
  const breakdown = computeClubRevenueBreakdown(dossier, {
    apporteurTier: tier,
    kereisSettings: options?.kereisSettings,
  });
  if (breakdown.clubGrossEur > 0) totals.gross += breakdown.clubGrossEur;
  totals.net += breakdown.clubNetEur;
}

export function computeActivityMetrics(
  dossiers: Dossier[],
  periodDays = 7,
  options?: ActivityMetricsOptions,
): ActivityMetrics {
  const scoped = filterMetricsDossiers(dossiers);
  const cutoff = Date.now() - periodDays * 24 * 3600 * 1000;

  let newDossiers = 0;
  let openEscalations = 0;
  let awaitingClient = 0;
  let activeEnCours = 0;
  let clientMessages7d = 0;
  let camilleReplies7d = 0;
  let loanDocsOk = 0;
  let certainDocProblemCount = 0;
  let studiesWithKpi = 0;
  let studiesWithKpiInPeriod = 0;
  let dossiersWithClubRevenue = 0;
  let dossiersWithClubRevenueInPeriod = 0;

  const cumul = { economies: 0, prets: 0, courtage: 0, clubGross: 0, clubNet: 0 };
  const period = { economies: 0, prets: 0, courtage: 0, clubGross: 0, clubNet: 0 };
  const firstOutboundDays: number[] = [];

  for (const d of scoped) {
    if (new Date(d.createdAt || 0).getTime() >= cutoff) newDossiers += 1;

    const esc = d.camilleEscalation;
    if (esc?.lastAt && !esc?.resolvedAt) openEscalations += 1;
    if (d.status === "EN_ATTENTE_CLIENT") awaitingClient += 1;
    if (d.status === "EN_COURS" || d.status === "NOUVEAU") activeEnCours += 1;

    for (const c of d.communications || []) {
      const t = new Date((c as any).date || 0).getTime();
      if (t < cutoff) continue;
      if ((c as any).direction === "inbound") clientMessages7d += 1;
      if ((c as any).direction === "outbound" && /camille/i.test(String((c as any).from || ""))) {
        camilleReplies7d += 1;
      }
    }

    const ctx = computeDocumentChecklist(d.formData?.documents || []);
    const offre = ctx.find((x) => x.key === "offre");
    const amort = ctx.find((x) => x.key === "amort");
    if (offre?.status === "ok" && amort?.status === "ok") loanDocsOk += 1;
    if (assessCertainLoanDocProblems(d).certain) certainDocProblemCount += 1;

    const kpi = d.studyKpi as StudyKpiRecord | undefined;
    if (hasUsableStudyKpi(kpi)) {
      studiesWithKpi += 1;
      accumulateStudyKpi(kpi, d, cumul);

      const activityTs = getStudyKpiActivityDate(d);
      if (activityTs >= cutoff) {
        studiesWithKpiInPeriod += 1;
        accumulateStudyKpi(kpi, d, period);
      }
    }

    if (hasUsableStudyKpi(kpi) || d.clubRevenueKpi?.updatedAt) {
      dossiersWithClubRevenue += 1;
      accumulateClubRevenue(d, cumul, options);
      const clubActivityTs = d.clubRevenueKpi?.updatedAt
        ? new Date(d.clubRevenueKpi.updatedAt).getTime()
        : getStudyKpiActivityDate(d);
      if (clubActivityTs >= cutoff) {
        dossiersWithClubRevenueInPeriod += 1;
        accumulateClubRevenue(d, period, options);
      }
    }

    const outbounds = [...(d.communications || [])]
      .filter((c: any) => c.direction === "outbound")
      .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (outbounds[0]?.date && d.createdAt) {
      const delta =
        (new Date(outbounds[0].date).getTime() - new Date(d.createdAt).getTime()) / (24 * 3600 * 1000);
      if (delta >= 0 && delta < 120) firstOutboundDays.push(delta);
    }
  }

  const total = scoped.length || 1;
  const avgDaysToFirstOutbound =
    firstOutboundDays.length > 0
      ? Math.round((firstOutboundDays.reduce((a, b) => a + b, 0) / firstOutboundDays.length) * 10) / 10
      : null;

  const periodLabel =
    periodDays >= 3650 ? "tous les dossiers" : `${periodDays} derniers jours`;

  return {
    periodDays,
    totalDossiers: scoped.length,
    newDossiers,
    openEscalations,
    awaitingClient,
    activeEnCours,
    clientMessages7d,
    camilleReplies7d,
    avgDaysToFirstOutbound,
    loanDocsOkRate: Math.round((loanDocsOk / total) * 100),
    certainDocProblemCount,
    studiesWithKpi,
    studiesWithKpiInPeriod,
    totalEconomiesRealiseesEur: Math.round(cumul.economies),
    totalEconomiesRealiseesLabel: formatEurKpi(cumul.economies),
    totalMontantPretsAccompagnesEur: Math.round(cumul.prets),
    totalMontantPretsAccompagnesLabel: formatEurKpi(cumul.prets),
    totalGainsFraisCourtageEur: Math.round(cumul.courtage),
    totalGainsFraisCourtageLabel: formatEurKpi(cumul.courtage),
    periodEconomiesRealiseesEur: Math.round(period.economies),
    periodEconomiesRealiseesLabel: formatEurKpi(period.economies),
    periodMontantPretsAccompagnesEur: Math.round(period.prets),
    periodMontantPretsAccompagnesLabel: formatEurKpi(period.prets),
    periodGainsFraisCourtageEur: Math.round(period.courtage),
    periodGainsFraisCourtageLabel: formatEurKpi(period.courtage),
    totalClubGrossEur: Math.round(cumul.clubGross),
    totalClubGrossLabel: formatClubRevenueEur(cumul.clubGross),
    totalClubNetEur: Math.round(cumul.clubNet),
    totalClubNetLabel: formatClubRevenueEur(cumul.clubNet),
    periodClubGrossEur: Math.round(period.clubGross),
    periodClubGrossLabel: formatClubRevenueEur(period.clubGross),
    periodClubNetEur: Math.round(period.clubNet),
    periodClubNetLabel: formatClubRevenueEur(period.clubNet),
    dossiersWithClubRevenue,
    dossiersWithClubRevenueInPeriod,
    kpiHelp: {
      periodLabel,
      economies: `Cumul : somme des économies brutes des ${studiesWithKpi} dossier(s) avec étude enregistrée. Sur la période (${periodLabel}) : ${studiesWithKpiInPeriod} étude(s) — ${formatEurKpi(period.economies)}. Ce n'est pas le chiffre d'affaires encaissé.`,
      prets: `Cumul des capitaux restants dus (formulaire ou KPI) pour les dossiers avec étude. Période : ${formatEurKpi(period.prets)}.`,
      courtage: `Cumul des frais de courtage LCIF lus dans les mails d'étude ou saisis manuellement. Période : ${formatEurKpi(period.courtage)}.`,
      clubGross: `Brut club = courtage (= frais distribution) + commission linéaire Kereis. ${dossiersWithClubRevenue} dossier(s) — période : ${formatClubRevenueEur(period.clubGross)}.`,
      clubNet: `Net club = courtage après rétro (70 % conseiller / 50 % apporteur) + commission Kereis. Période : ${formatClubRevenueEur(period.clubNet)}.`,
    },
  };
}
