import type { Dossier } from "./dossierModel";
import { isArchivedDossier } from "../shared/dossierInactive";
import { getLastStudyOutbound, getStudySentAtMs, hasStudyBeenSent } from "./dossierLifecycle";
import {
  extractGrossFromStudySubject,
  extractGrossSavingsFromStudyContent,
  getLoanCapitalFromDossier,
  isGrossSavingsPlausible,
} from "./studyEmailKpi";

export const CLIENT_LANDING_MIN_GROSS_SAVINGS_EUR = 5000;
export const CLIENT_LANDING_RECENT_STUDIES_LIMIT = 10;

/** Exemple showcase déjà utilisé sur la landing publique (couple, prêt en cours). */
export const CLIENT_LANDING_HERO_SHOWCASE = {
  monthlyBeforeEur: 78.82,
  monthlyAfterEur: 31.46,
  grossSavingsEur: 12218,
  savingsPercent: 60,
  caption: "Dossier réel anonymisé · couple, prêt en cours",
} as const;

export type ClientLandingRecentStudy = {
  dossierId: string;
  studySentAt: string;
  studySentAtLabel: string;
  grossSavingsEur: number;
  grossSavingsLabel: string;
  monthlyBeforeEur: number | null;
  monthlyAfterEur: number | null;
  savingsPercent: number | null;
  /** Remplissage temporaire tant qu'il n'y a pas 10 études CRM. */
  fictional?: boolean;
};

/**
 * Études fictives pour remplir le carrousel (max 10) en attendant plus de dossiers CRM.
 * Placées après les dossiers réels — jamais avant.
 */
export const CLIENT_LANDING_FICTIONAL_STUDIES: Array<{
  dossierId: string;
  studySentAt: string;
  grossSavingsEur: number;
}> = [
  { dossierId: "FICTIF-01", studySentAt: "2026-07-08T10:00:00.000Z", grossSavingsEur: 8460 },
  { dossierId: "FICTIF-02", studySentAt: "2026-07-03T10:00:00.000Z", grossSavingsEur: 12218 },
  { dossierId: "FICTIF-03", studySentAt: "2026-06-28T10:00:00.000Z", grossSavingsEur: 6735 },
  { dossierId: "FICTIF-04", studySentAt: "2026-06-22T10:00:00.000Z", grossSavingsEur: 9840 },
  { dossierId: "FICTIF-05", studySentAt: "2026-06-15T10:00:00.000Z", grossSavingsEur: 7240 },
  { dossierId: "FICTIF-06", studySentAt: "2026-06-09T10:00:00.000Z", grossSavingsEur: 15670 },
  { dossierId: "FICTIF-07", studySentAt: "2026-05-30T10:00:00.000Z", grossSavingsEur: 10560 },
  { dossierId: "FICTIF-08", studySentAt: "2026-05-21T10:00:00.000Z", grossSavingsEur: 5448 },
  { dossierId: "FICTIF-09", studySentAt: "2026-05-12T10:00:00.000Z", grossSavingsEur: 13390 },
  { dossierId: "FICTIF-10", studySentAt: "2026-05-04T10:00:00.000Z", grossSavingsEur: 9180 },
];

function fictionalStudyRow(seed: (typeof CLIENT_LANDING_FICTIONAL_STUDIES)[number]): ClientLandingRecentStudy {
  return {
    dossierId: seed.dossierId,
    studySentAt: seed.studySentAt,
    studySentAtLabel: formatStudySentAtLabel(seed.studySentAt),
    grossSavingsEur: seed.grossSavingsEur,
    grossSavingsLabel: formatSavingsLabel(seed.grossSavingsEur),
    monthlyBeforeEur: null,
    monthlyAfterEur: null,
    savingsPercent: null,
    fictional: true,
  };
}

function formatStudySentAtLabel(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatSavingsLabel(eur: number): string {
  return `${eur.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`;
}

function formatMonthlyLabel(eur: number): string {
  return `${eur.toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} €`;
}

function pickPositive(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function parseTs(raw: unknown): number | null {
  if (!raw) return null;
  const ms = new Date(String(raw)).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/**
 * Économie brute affichable : KPI / brouillon / validation, sinon extraction
 * depuis le dernier mail d'étude (objet ou corps).
 */
export function resolveGrossSavingsEur(dossier: Dossier): number {
  const structured = [
    dossier.studyKpi?.grossSavingsEur,
    dossier.studyDraft?.economySummary?.grossSavingsEur,
    dossier.studyConseillerValidation?.grossSavingsEur,
  ];
  for (const raw of structured) {
    const n = pickPositive(raw);
    if (n != null) return n;
  }

  const last = getLastStudyOutbound(dossier);
  if (last?.subject) {
    const fromSubject = extractGrossFromStudySubject(last.subject);
    if (fromSubject != null && fromSubject > 0) return Math.round(fromSubject);
  }

  const studyComms = [...(dossier.communications || [])]
    .filter((c) => c.direction === "outbound")
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  for (const c of studyComms) {
    const html = String(c.html || c.body || c.text || "");
    const subject = String(c.subject || "");
    if (!html && !subject) continue;
    const fromContent = extractGrossSavingsFromStudyContent(html, subject);
    if (fromContent != null && fromContent >= CLIENT_LANDING_MIN_GROSS_SAVINGS_EUR) {
      return Math.round(fromContent);
    }
  }

  for (const em of dossier.emails || []) {
    if (em.status !== "SENT") continue;
    const fromContent = extractGrossSavingsFromStudyContent(
      String(em.html || em.body || ""),
      String(em.subject || ""),
    );
    if (fromContent != null && fromContent >= CLIENT_LANDING_MIN_GROSS_SAVINGS_EUR) {
      return Math.round(fromContent);
    }
  }

  return 0;
}

function resolveMonthlyPair(dossier: Dossier): {
  monthlyBeforeEur: number | null;
  monthlyAfterEur: number | null;
  savingsPercent: number | null;
} {
  const extracted = dossier.studyDraft?.extracted as
    | {
        currentMonthlyInsurance?: number;
        proposedMonthlyByYear?: Array<{ year: number; monthly: number }>;
        result?: {
          table?: Array<{
            currentMonthly?: number | null;
            proposedMonthly?: number | null;
          }>;
        };
      }
    | undefined;

  let before =
    extracted?.currentMonthlyInsurance != null &&
    Number.isFinite(Number(extracted.currentMonthlyInsurance))
      ? Math.round(Number(extracted.currentMonthlyInsurance) * 100) / 100
      : null;
  let after: number | null = null;
  const y1 =
    extracted?.proposedMonthlyByYear?.find((r) => r.year === 1)?.monthly ??
    extracted?.proposedMonthlyByYear?.[0]?.monthly;
  if (y1 != null && Number.isFinite(Number(y1)) && Number(y1) > 0) {
    after = Math.round(Number(y1) * 100) / 100;
  }
  if ((before == null || after == null) && extracted?.result?.table?.length) {
    const row = extracted.result.table[0];
    if (before == null && row?.currentMonthly != null) {
      before = Math.round(Number(row.currentMonthly) * 100) / 100;
    }
    if (after == null && row?.proposedMonthly != null) {
      after = Math.round(Number(row.proposedMonthly) * 100) / 100;
    }
  }

  if (before == null || after == null || !(before > 0) || !(after < before)) {
    return { monthlyBeforeEur: null, monthlyAfterEur: null, savingsPercent: null };
  }

  return {
    monthlyBeforeEur: before,
    monthlyAfterEur: after,
    savingsPercent: Math.round(((before - after) / before) * 100),
  };
}

/** Date de réalisation de l'étude (envoi client, sinon calcul / validation). */
function resolveStudyTimestamp(dossier: Dossier): { iso: string; ms: number } | null {
  const sentMs = getStudySentAtMs(dossier);
  if (sentMs != null && sentMs > 0) {
    const last = getLastStudyOutbound(dossier);
    const iso = last?.date || new Date(sentMs).toISOString();
    return { iso, ms: sentMs };
  }

  const candidates: Array<{ iso: string; ms: number }> = [];
  const push = (raw: unknown) => {
    const ms = parseTs(raw);
    if (ms == null) return;
    candidates.push({ iso: String(raw), ms });
  };

  const validation = dossier.studyConseillerValidation;
  if (validation?.status === "approved") push(validation.approvedAt);
  push(validation?.submittedAt);
  push(dossier.studyKpi?.extractedAt);
  push(dossier.studyDraft?.computedAt);

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.ms - a.ms);
  return candidates[0];
}

function hasRealizedStudyEconomics(dossier: Dossier): boolean {
  if (Number(dossier.studyKpi?.grossSavingsEur) > 0) return true;
  if (Number(dossier.studyDraft?.economySummary?.grossSavingsEur) > 0) return true;
  if (Number(dossier.studyConseillerValidation?.grossSavingsEur) > 0) return true;
  return hasStudyBeenSent(dossier);
}

/**
 * Étude « réalisée » pour le carrousel public :
 * économie brute ≥ seuil, dossier non archivé/refusé, chiffres CRM matérialisés.
 * Pas besoin que le mail client soit déjà parti (ex. étude calculée / en validation).
 */
function isEligibleForLandingCarousel(dossier: Dossier): boolean {
  if (isArchivedDossier(dossier)) return false;
  if (!hasRealizedStudyEconomics(dossier)) return false;

  const gross = resolveGrossSavingsEur(dossier);
  if (gross < CLIENT_LANDING_MIN_GROSS_SAVINGS_EUR) return false;

  const loan = getLoanCapitalFromDossier(dossier);
  if (!isGrossSavingsPlausible(gross, loan)) return false;

  const kpi = dossier.studyKpi;
  if (
    kpi?.confidence === "low" &&
    !(dossier.studyDraft?.economySummary?.grossSavingsEur) &&
    !(dossier.studyConseillerValidation?.grossSavingsEur)
  ) {
    return false;
  }

  return resolveStudyTimestamp(dossier) != null;
}

/**
 * Dernières études réalisées avec économie brute ≥ seuil.
 * Triées par date de réalisation (plus récentes d'abord), max `limit` (défaut 10).
 * Si moins de `limit` dossiers CRM : complète avec des études fictives (après les réelles).
 */
export function listClientLandingRecentStudies(
  dossiers: Dossier[],
  opts?: { minGrossSavingsEur?: number; limit?: number; padFictional?: boolean },
): ClientLandingRecentStudy[] {
  const min = opts?.minGrossSavingsEur ?? CLIENT_LANDING_MIN_GROSS_SAVINGS_EUR;
  const limit = opts?.limit ?? CLIENT_LANDING_RECENT_STUDIES_LIMIT;
  const padFictional = opts?.padFictional !== false;

  const rows: ClientLandingRecentStudy[] = [];
  for (const dossier of dossiers) {
    if (!isEligibleForLandingCarousel(dossier)) continue;
    const gross = resolveGrossSavingsEur(dossier);
    if (gross < min) continue;
    const ts = resolveStudyTimestamp(dossier);
    if (!ts) continue;
    const monthly = resolveMonthlyPair(dossier);
    rows.push({
      dossierId: dossier.id,
      studySentAt: ts.iso,
      studySentAtLabel: formatStudySentAtLabel(ts.iso),
      grossSavingsEur: gross,
      grossSavingsLabel: formatSavingsLabel(gross),
      monthlyBeforeEur: monthly.monthlyBeforeEur,
      monthlyAfterEur: monthly.monthlyAfterEur,
      savingsPercent: monthly.savingsPercent,
      fictional: false,
    });
  }

  rows.sort((a, b) => new Date(b.studySentAt).getTime() - new Date(a.studySentAt).getTime());
  const real = rows.slice(0, Math.max(0, limit));

  if (!padFictional || real.length >= limit) return real;

  const need = limit - real.length;
  const fillers = CLIENT_LANDING_FICTIONAL_STUDIES.slice(0, need).map(fictionalStudyRow);
  return [...real, ...fillers];
}

export function formatMonthlyEurLabel(eur: number | null | undefined): string | null {
  if (eur == null || !Number.isFinite(eur)) return null;
  return formatMonthlyLabel(eur);
}
