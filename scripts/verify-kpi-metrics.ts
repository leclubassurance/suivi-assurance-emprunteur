/**
 * Vérification locale du calcul KPI (sans Firestore).
 * Usage: npx tsx scripts/verify-kpi-metrics.ts
 */
import { computeActivityMetrics, filterMetricsDossiers } from "../server/activityMetrics";
import {
  getLoanCapitalFromDossier,
  getStudyKpiActivityDate,
  refreshStudyKpiFromCommunications,
} from "../server/studyEmailKpi";
import type { Dossier } from "../server/dossierModel";
import { CAMILLE_META_DOSSIER_ID } from "../shared/camilleMeta";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

function makeDossier(partial: Partial<Dossier> & { id: string }): Dossier {
  return {
    id: partial.id,
    status: partial.status || "EN_COURS",
    createdAt: partial.createdAt || "2025-01-01T10:00:00.000Z",
    updatedAt: partial.updatedAt || "2025-06-01T10:00:00.000Z",
    formData: partial.formData || { assures: [{ prenom: "Test", nom: "Client" }], prets: [] },
    communications: partial.communications || [],
    eventLog: partial.eventLog || [],
    emails: partial.emails || [],
    studyKpi: partial.studyKpi,
    camilleEscalation: partial.camilleEscalation,
    leadStatus: partial.leadStatus,
  } as Dossier;
}

const now = Date.now();
const daysAgo = (n: number) => new Date(now - n * 24 * 3600 * 1000).toISOString();
const daysFromNow = (n: number) => new Date(now + n * 24 * 3600 * 1000).toISOString();

const oldStudy = makeDossier({
  id: "LCIF-100001",
  createdAt: daysAgo(400),
  studyKpi: {
    grossSavingsEur: 12000,
    feesCourtageEur: 800,
    loanCapitalEur: 227575,
    confidence: "high",
    source: "manual",
    gmailId: "manual_LCIF-100001",
    extractedAt: daysAgo(300),
    subject: "Étude personnalisée",
  },
  formData: {
    assures: [{ prenom: "Jean", nom: "Dupont" }],
    prets: [{ capitalRestant: "227 575" }],
  },
});

const recentStudy = makeDossier({
  id: "LCIF-100002",
  createdAt: daysAgo(10),
  studyKpi: {
    grossSavingsEur: 5000,
    feesCourtageEur: 400,
    confidence: "high",
    source: "gmail_outbound",
    gmailId: "g1",
    extractedAt: daysAgo(3),
  },
  communications: [
    {
      id: "c1",
      direction: "outbound",
      subject: "Marie, votre étude personnalisée - Assurance Emprunteur",
      date: daysAgo(3),
      from: "camille@leclubimmobilier.fr",
      text: "",
      html: `<p>Économies totales : <strong>5 000 €</strong></p><p>Frais de courtage LCIF : 400 €</p>`,
    },
  ],
  formData: {
    assures: [{ prenom: "Marie", nom: "Martin" }],
    prets: [{ capitalRestant: "180000" }],
  },
});

const prospect = makeDossier({
  id: "LCIF-100003",
  isLead: true,
  status: "PROSPECT",
  studyKpi: {
    grossSavingsEur: 99999,
    feesCourtageEur: 9999,
    confidence: "high",
    source: "manual",
    gmailId: "x",
    extractedAt: daysAgo(3),
  },
});

const meta = makeDossier({
  id: CAMILLE_META_DOSSIER_ID,
  studyKpi: {
    grossSavingsEur: 88888,
    feesCourtageEur: 8888,
    confidence: "high",
    source: "manual",
    gmailId: "x",
    extractedAt: daysAgo(3),
  },
});

const noKpi = makeDossier({ id: "LCIF-100004", status: "NOUVEAU" });

console.log("\n=== Capital avec espaces ===");
assert(getLoanCapitalFromDossier(oldStudy) === 227575, "parse capitalRestant « 227 575 »");

console.log("\n=== Filtre dossiers métriques ===");
const scoped = filterMetricsDossiers([oldStudy, recentStudy, prospect, meta, noKpi]);
assert(scoped.length === 3, "exclut prospect + meta Camille, garde 3 dossiers actifs");
assert(!scoped.some((d) => d.id === prospect.id), "prospect exclu");
assert(!scoped.some((d) => d.id === CAMILLE_META_DOSSIER_ID), "meta Camille exclu");

console.log("\n=== Cumul vs période 7 j ===");
const m7 = computeActivityMetrics([oldStudy, recentStudy, prospect, meta, noKpi], 7);
assert(m7.studiesWithKpi === 2, "2 études au cumul (ancienne + récente)");
assert(m7.studiesWithKpiInPeriod === 1, "1 seule étude dans les 7 derniers jours");
assert(m7.totalEconomiesRealiseesEur === 17000, "cumul économies = 12000 + 5000");
assert(m7.periodEconomiesRealiseesEur === 5000, "période 7j = 5000 uniquement");
assert(m7.totalMontantPretsAccompagnesEur === 407575, "cumul capitaux 227575 + 180000");

console.log("\n=== Période « Tout » ===");
const mAll = computeActivityMetrics([oldStudy, recentStudy, prospect, meta, noKpi], 3650);
assert(mAll.studiesWithKpiInPeriod === 2, "toutes les études dans la période « tout »");
assert(mAll.periodEconomiesRealiseesEur === mAll.totalEconomiesRealiseesEur, "période tout = cumul");

console.log("\n=== Backfill KPI depuis communication ===");
const backfillTarget = makeDossier({
  id: "LCIF-100005",
  formData: {
    assures: [{ prenom: "Paul", nom: "Bernard" }],
    prets: [{ capitalRestant: "150 000" }],
  },
  communications: [
    {
      id: "c2",
      direction: "outbound",
      subject: "Paul, votre étude personnalisée",
      date: daysAgo(60),
      from: "camille@leclubimmobilier.fr",
      text: "",
      html: `<p>Charles Victor — Le Club Immobilier Français</p><table><tr><td>Économie brute</td><td>3 200 €</td></tr><tr><td>Frais de courtage</td><td>250 €</td></tr></table>`,
    },
  ],
});
const ok = refreshStudyKpiFromCommunications(backfillTarget);
assert(ok, "backfill extrait KPI depuis HTML mail d'étude");
assert((backfillTarget.studyKpi?.grossSavingsEur || 0) > 0, "économie brute extraite");

console.log("\n=== Date activité étude ===");
const activityTs = getStudyKpiActivityDate(oldStudy);
assert(activityTs < now - 200 * 24 * 3600 * 1000, "date activité étude ancienne (> 200 j)");

console.log("\n✅ Tous les tests KPI locaux passent.\n");
