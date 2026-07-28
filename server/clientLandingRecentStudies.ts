import type { Dossier } from "./dossierModel";
import { getLastStudyOutbound, getStudySentAtMs, hasStudyBeenSent } from "./dossierLifecycle";
import { extractGrossFromStudySubject } from "./studyEmailKpi";

export const CLIENT_LANDING_MIN_GROSS_SAVINGS_EUR = 5000;
export const CLIENT_LANDING_RECENT_STUDIES_LIMIT = 10;

export type ClientLandingRecentStudy = {
  dossierId: string;
  studySentAt: string;
  studySentAtLabel: string;
  grossSavingsEur: number;
  grossSavingsLabel: string;
  /** Cotisation mensuelle actuelle (an 1) si connue. */
  monthlyBeforeEur: number | null;
  /** Cotisation mensuelle proposée (an 1) si connue. */
  monthlyAfterEur: number | null;
  /** Réduction cotisation en % si before/after connus. */
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

export function resolveGrossSavingsEur(dossier: Dossier): number {
  const candidates = [
    dossier.studyKpi?.grossSavingsEur,
    dossier.studyDraft?.economySummary?.grossSavingsEur,
    dossier.studyConseillerValidation?.grossSavingsEur,
  ];
  for (const raw of candidates) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }

  // Fallback : objet du dernier mail d'étude (« économiser ~12 345 € »)
  const last = getLastStudyOutbound(dossier);
  if (last?.subject) {
    const fromSubject = extractGrossFromStudySubject(last.subject);
    if (fromSubject != null && fromSubject > 0) return Math.round(fromSubject);
  }
  for (const c of dossier.communications || []) {
    if (c.direction !== "outbound") continue;
    const fromSubject = extractGrossFromStudySubject(String(c.subject || ""));
    if (fromSubject != null && fromSubject >= CLIENT_LANDING_MIN_GROSS_SAVINGS_EUR) {
      return Math.round(fromSubject);
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
  const y1 = extracted?.proposedMonthlyByYear?.find((r) => r.year === 1)?.monthly
    ?? extracted?.proposedMonthlyByYear?.[0]?.monthly;
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

  // Fallback : prime annuelle proposée (étude) → mensuel
  if (after == null) {
    const annual =
      dossier.studyKpi?.annualPremiumEur ?? dossier.studyDraft?.economySummary?.annualPremiumEur;
    if (annual != null && Number(annual) > 0) {
      after = Math.round((Number(annual) / 12) * 100) / 100;
    }
  }

  let savingsPercent: number | null = null;
  if (before != null && after != null && before > 0 && after < before) {
    savingsPercent = Math.round(((before - after) / before) * 100);
  }

  return { monthlyBeforeEur: before, monthlyAfterEur: after, savingsPercent };
}

function resolveStudyTimestamp(dossier: Dossier): { iso: string; ms: number } | null {
  const sentMs = getStudySentAtMs(dossier);
  if (sentMs != null && sentMs > 0) {
    const last = getLastStudyOutbound(dossier);
    const iso = last?.date || new Date(sentMs).toISOString();
    return { iso, ms: sentMs };
  }
  const extractedAt = dossier.studyKpi?.extractedAt;
  if (extractedAt) {
    const ms = new Date(extractedAt).getTime();
    if (Number.isFinite(ms) && ms > 0) return { iso: extractedAt, ms };
  }
  const draftAt = dossier.studyDraft?.computedAt;
  if (draftAt) {
    const ms = new Date(draftAt).getTime();
    if (Number.isFinite(ms) && ms > 0) return { iso: draftAt, ms };
  }
  return null;
}

function isEligibleForLandingCarousel(dossier: Dossier): boolean {
  // Priorité : envoi réel d’étude au client (mails / événements).
  if (hasStudyBeenSent(dossier)) return true;
  // Filet : KPI d’économie + statut d’étude envoyée / traitée (signal mail parfois incomplet).
  const gross = resolveGrossSavingsEur(dossier);
  if (gross < CLIENT_LANDING_MIN_GROSS_SAVINGS_EUR) return false;
  if (!(dossier.studyKpi?.grossSavingsEur && Number(dossier.studyKpi.grossSavingsEur) > 0)) return false;
  const st = String(dossier.status || "").toUpperCase();
  return ["MAIL_ENVOYÉ", "MAIL_ENVOYE", "TRAITÉ", "TRAITE"].includes(st);
}

/**
 * Dernières études avec économie brute ≥ seuil.
 * Triées par date d'envoi / extraction (plus récentes d'abord), max `limit` (défaut 10).
 * Données anonymisées : date + montants uniquement.
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
