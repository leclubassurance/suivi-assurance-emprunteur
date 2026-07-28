import type { Dossier } from "./dossierModel";
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
};

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
  return `${eur.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
}

function pickPositive(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
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

  // Corps du dernier mail d'étude (HTML ou texte)
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
    extracted?.currentMonthlyInsurance != null && Number.isFinite(Number(extracted.currentMonthlyInsurance))
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

  // Ne jamais inventer un "après" seul via prime annuelle (affiche 5,83 € sans avant).
  if (before == null || after == null || !(before > 0) || !(after < before)) {
    return { monthlyBeforeEur: null, monthlyAfterEur: null, savingsPercent: null };
  }

  return {
    monthlyBeforeEur: before,
    monthlyAfterEur: after,
    savingsPercent: Math.round(((before - after) / before) * 100),
  };
}

function resolveStudyTimestamp(dossier: Dossier): { iso: string; ms: number } | null {
  const sentMs = getStudySentAtMs(dossier);
  if (sentMs != null && sentMs > 0) {
    const last = getLastStudyOutbound(dossier);
    const iso = last?.date || new Date(sentMs).toISOString();
    return { iso, ms: sentMs };
  }
  return null;
}

function isEligibleForLandingCarousel(dossier: Dossier): boolean {
  // Strict : envoi réel d'étude uniquement (pas de filet statut CRM).
  if (!hasStudyBeenSent(dossier)) return false;
  if (isStudyPendingLike(dossier)) return false;

  const gross = resolveGrossSavingsEur(dossier);
  if (gross < CLIENT_LANDING_MIN_GROSS_SAVINGS_EUR) return false;

  const loan = getLoanCapitalFromDossier(dossier);
  if (!isGrossSavingsPlausible(gross, loan)) return false;

  // Écarter les KPI à faible confiance quand c'est la seule source.
  const kpi = dossier.studyKpi;
  if (kpi?.confidence === "low" && !(dossier.studyDraft?.economySummary?.grossSavingsEur)) {
    return false;
  }

  return true;
}

function isStudyPendingLike(dossier: Dossier): boolean {
  return dossier.studyConseillerValidation?.status === "pending";
}

/**
 * Dernières études envoyées avec économie brute ≥ seuil.
 * Triées par date d'envoi (plus récentes d'abord), max `limit` (défaut 10).
 */
export function listClientLandingRecentStudies(
  dossiers: Dossier[],
  opts?: { minGrossSavingsEur?: number; limit?: number },
): ClientLandingRecentStudy[] {
  const min = opts?.minGrossSavingsEur ?? CLIENT_LANDING_MIN_GROSS_SAVINGS_EUR;
  const limit = opts?.limit ?? CLIENT_LANDING_RECENT_STUDIES_LIMIT;

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
    });
  }

  rows.sort((a, b) => new Date(b.studySentAt).getTime() - new Date(a.studySentAt).getTime());
  return rows.slice(0, Math.max(0, limit));
}

export function formatMonthlyEurLabel(eur: number | null | undefined): string | null {
  if (eur == null || !Number.isFinite(eur)) return null;
  return formatMonthlyLabel(eur);
}
