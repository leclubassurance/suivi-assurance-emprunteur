import type { Dossier } from "./dossierModel";
import { assessCertainLoanDocProblems } from "./loanDocCertainty";
import { computeDocumentChecklist } from "../shared/documentChecklist";
import { formatEurKpi, getLoanCapitalFromDossier } from "./studyEmailKpi";

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
  studiesWithKpi: number;
  totalEconomiesRealiseesEur: number;
  totalEconomiesRealiseesLabel: string;
  totalMontantPretsAccompagnesEur: number;
  totalMontantPretsAccompagnesLabel: string;
  totalGainsFraisCourtageEur: number;
  totalGainsFraisCourtageLabel: string;
  kpiHelp: {
    economies: string;
    prets: string;
    courtage: string;
    periodLabel: string;
  };
};

function daysSince(iso?: string) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / (24 * 3600 * 1000);
}

export function computeActivityMetrics(dossiers: Dossier[], periodDays = 7): ActivityMetrics {
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
  let totalEconomiesRealiseesEur = 0;
  let totalMontantPretsAccompagnesEur = 0;
  let totalGainsFraisCourtageEur = 0;
  const firstOutboundDays: number[] = [];

  for (const d of dossiers) {
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
    const offre = ctx.find((x) => x.key === "offre")?.ok;
    const amort = ctx.find((x) => x.key === "amort")?.ok;
    if (offre && amort) loanDocsOk += 1;
    if (assessCertainLoanDocProblems(d).certain) certainDocProblemCount += 1;

    const kpi = d.studyKpi;
    if (kpi?.extractedAt && new Date(kpi.extractedAt).getTime() >= cutoff) {
      studiesWithKpi += 1;
      if (Number(kpi.grossSavingsEur) > 0) {
        totalEconomiesRealiseesEur += Number(kpi.grossSavingsEur) || 0;
      }
      const loan =
        Number(kpi.loanCapitalEur) > 0 ? Number(kpi.loanCapitalEur) : getLoanCapitalFromDossier(d);
      if (loan > 0) totalMontantPretsAccompagnesEur += loan;
      totalGainsFraisCourtageEur += Number(kpi.feesCourtageEur) || 0;
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

  const total = dossiers.length || 1;
  const avgDaysToFirstOutbound =
    firstOutboundDays.length > 0
      ? Math.round((firstOutboundDays.reduce((a, b) => a + b, 0) / firstOutboundDays.length) * 10) / 10
      : null;

  return {
    periodDays,
    totalDossiers: dossiers.length,
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
    totalEconomiesRealiseesEur: Math.round(totalEconomiesRealiseesEur),
    totalEconomiesRealiseesLabel: formatEurKpi(totalEconomiesRealiseesEur),
    totalMontantPretsAccompagnesEur: Math.round(totalMontantPretsAccompagnesEur),
    totalMontantPretsAccompagnesLabel: formatEurKpi(totalMontantPretsAccompagnesEur),
    totalGainsFraisCourtageEur: Math.round(totalGainsFraisCourtageEur),
    totalGainsFraisCourtageLabel: formatEurKpi(totalGainsFraisCourtageEur),
    kpiHelp: {
      periodLabel: `${periodDays} derniers jours`,
      economies: `Somme des économies brutes annoncées dans les mails d'étude Charles Victor (${studiesWithKpi} dossier(s)). Ce n'est pas le chiffre d'affaires encaissé, mais ce qui a été présenté au client.`,
      prets: `Total des capitaux restants dus déclarés au formulaire pour ces mêmes dossiers (un dossier = une ou plusieurs lignes de prêt).`,
      courtage: `Total des frais de courtage LCIF lus dans le HTML des mails d'étude (ligne « Frais de courtage »). 0 € si le mail ne contient pas ce montant ou affiche « ___ € ».`,
    },
  };
}
