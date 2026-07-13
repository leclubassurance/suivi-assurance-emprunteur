import { addEvent, type Dossier } from "./dossierModel";
import type { ClubRevenueKpiRecord, KereisMiaProductLine } from "../shared/kereisMiaRemuneration";

export type { ClubRevenueKpiRecord };

export function patchClubRevenueKpi(
  dossier: Dossier,
  input: {
    productLine?: KereisMiaProductLine;
    insurer?: string;
    annualPremiumEur?: number;
    linearCommissionPercent?: number;
    kereisCommissionOverrideEur?: number | null;
    feesCourtageOverrideEur?: number | null;
    paymentStatus?: ClubRevenueKpiRecord["paymentStatus"];
    signedAt?: string | null;
    notes?: string;
    source?: ClubRevenueKpiRecord["source"];
  },
): ClubRevenueKpiRecord {
  const prev = (dossier as Dossier & { clubRevenueKpi?: ClubRevenueKpiRecord }).clubRevenueKpi;
  const now = new Date().toISOString();

  const record: ClubRevenueKpiRecord = {
    productLine: input.productLine ?? prev?.productLine ?? "emprunteur",
    insurer: input.insurer !== undefined ? String(input.insurer || "").trim() || undefined : prev?.insurer,
    annualPremiumEur:
      input.annualPremiumEur != null
        ? Math.round(Number(input.annualPremiumEur) || 0)
        : prev?.annualPremiumEur,
    linearCommissionPercent:
      input.linearCommissionPercent != null
        ? Math.round(Number(input.linearCommissionPercent) * 100) / 100
        : prev?.linearCommissionPercent,
    kereisCommissionOverrideEur:
      input.kereisCommissionOverrideEur === null
        ? undefined
        : input.kereisCommissionOverrideEur != null
          ? Math.round(Number(input.kereisCommissionOverrideEur) || 0)
          : prev?.kereisCommissionOverrideEur,
    feesCourtageOverrideEur:
      input.feesCourtageOverrideEur === null
        ? undefined
        : input.feesCourtageOverrideEur != null
          ? Math.round(Number(input.feesCourtageOverrideEur) || 0)
          : prev?.feesCourtageOverrideEur,
    paymentStatus: input.paymentStatus ?? prev?.paymentStatus ?? "pending",
    signedAt:
      input.signedAt === null
        ? undefined
        : input.signedAt !== undefined
          ? input.signedAt || undefined
          : prev?.signedAt,
    notes: input.notes !== undefined ? String(input.notes || "").trim() || undefined : prev?.notes,
    source: input.source ?? prev?.source ?? "manual",
    updatedAt: now,
  };

  (dossier as Dossier & { clubRevenueKpi?: ClubRevenueKpiRecord }).clubRevenueKpi = record;

  const parts: string[] = [];
  if (input.annualPremiumEur != null) parts.push(`${record.annualPremiumEur} € prime annuelle`);
  if (input.linearCommissionPercent != null) parts.push(`${record.linearCommissionPercent} % linéaire`);
  if (input.feesCourtageOverrideEur != null) {
    parts.push(`${record.feesCourtageOverrideEur ?? 0} € courtage dossier`);
  }
  if (input.kereisCommissionOverrideEur != null) {
    parts.push(`${record.kereisCommissionOverrideEur ?? 0} € commission Kereis (manuel)`);
  }
  if (input.paymentStatus) parts.push(`statut ${input.paymentStatus}`);

  addEvent(dossier, {
    type: "NOTE_ADDED",
    actor: { kind: "ADMIN", label: "Admin" },
    message: `Rémunération club mise à jour${parts.length ? ` : ${parts.join(", ")}` : ""}.`,
    meta: {
      template: "CLUB_REVENUE_KPI_MANUAL",
      ...record,
    },
  });

  return record;
}
