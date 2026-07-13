import {
  resolveDossierCommission,
  type DossierEconomicsSlice,
} from "./apporteurCommissionFromDossier";
import {
  getRemunerationConfig,
  resolveRemunerationTier,
  type ApporteurRemunerationTier,
} from "./apporteurRemuneration";

/** Lignes produit du contrat MIA Kereis (annexes 6–8). */
export type KereisMiaProductLine = "emprunteur" | "prevoyance_tns" | "ipmi";

export type KereisMiaSettings = {
  /** Taux commission linéaire Kereis par défaut (% de la prime annuelle). */
  defaultLinearCommissionPercent: number;
};

export const DEFAULT_KEREIS_MIA_SETTINGS: KereisMiaSettings = {
  defaultLinearCommissionPercent: 15,
};

export function normalizeKereisMiaSettings(raw: unknown): KereisMiaSettings {
  const data = raw as Partial<KereisMiaSettings> | null;
  const pct = Number(data?.defaultLinearCommissionPercent);
  return {
    defaultLinearCommissionPercent:
      Number.isFinite(pct) && pct >= 0 && pct <= 100
        ? Math.round(pct * 100) / 100
        : DEFAULT_KEREIS_MIA_SETTINGS.defaultLinearCommissionPercent,
  };
}

export type ClubRevenueKpiRecord = {
  productLine?: KereisMiaProductLine;
  insurer?: string;
  /** Prime annuelle totale — base du calcul linéaire. */
  annualPremiumEur?: number;
  /** Taux commission linéaire Kereis pour ce dossier (%), sinon défaut global. */
  linearCommissionPercent?: number;
  /** Surcharge manuelle si le bordereau diffère du calcul %. */
  kereisCommissionOverrideEur?: number;
  /** Courtage / distribution spécifique dossier (prioritaire sur le KPI étude). */
  feesCourtageOverrideEur?: number;
  paymentStatus?: "pending" | "partial" | "received";
  signedAt?: string;
  notes?: string;
  source?: "manual" | "bordereau" | "estimated";
  updatedAt?: string;
};

export type ClubRevenuePartnerKind = "conseiller" | "apporteur" | "none" | "estimate";

export type ClubRevenueBreakdown = {
  /** Frais de courtage LCIF = frais de distribution Kereis (même montant). */
  feesCourtageEur: number;
  linearCommissionPercent: number;
  annualPremiumEur: number;
  kereisCommissionEur: number;
  kereisCommissionFromPercent: boolean;
  /** Commission linéaire estimée chaque mois tant que le contrat est en cours. */
  monthlyLinearCommissionEur: number;
  clubGrossEur: number;
  partnerRetroPercent: number;
  partnerPayoutEur: number;
  sponsorOverrideEur: number;
  clubCourtageNetEur: number;
  clubNetEur: number;
  partnerKind: ClubRevenuePartnerKind;
  partnerLabel: string;
  productLine: KereisMiaProductLine;
  paymentStatus: ClubRevenueKpiRecord["paymentStatus"];
  contractHelp: string;
};

/** Règles contractuelles — mode linéaire uniquement côté LCIF. */
export const KEREIS_MIA_CONTRACT = {
  label: "Contrat MIA Kereis — LCIF (ORIAS 24002253)",
  emprunteur: {
    commissionMode: "linéaire",
    courtageEqualsDistribution:
      "Les frais de courtage LCIF correspondent aux frais de distribution Kereis (reversés à 100 % au club, puis rétro partenaire).",
    linearCommission: "Commission assureur versée mensuellement en mode linéaire (% de la prime de chaque échéance).",
    recurringWhileActive:
      "Tant que le contrat est actif, Kereis verse une commission chaque mois (linéaire). Le courtage / frais de distribution est un flux ponctuel à la souscription.",
  },
} as const;

export function resolveFeesCourtageEur(dossier: DossierClubRevenueSlice): number {
  const override = dossier.clubRevenueKpi?.feesCourtageOverrideEur;
  if (override != null && Number(override) > 0) return roundEur(override);
  return roundEur(
    dossier.studyKpi?.feesCourtageEur ??
      dossier.studyConseillerValidation?.feesCourtageTotalEur ??
      dossier.studyDraft?.economySummary?.feesCourtageEur ??
      0,
  );
}

export type DossierClubRevenueSlice = DossierEconomicsSlice & {
  clubRevenueKpi?: ClubRevenueKpiRecord;
  studyConseillerValidation?: {
    status?: string;
    conseillerRetroEur?: number;
    feesCourtageTotalEur?: number;
  };
};

function roundEur(n: number): number {
  return Math.round(Number(n) || 0);
}

export function formatClubRevenueEur(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 €";
  return roundEur(n).toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €";
}

export function resolveLinearCommissionPercent(
  kpi: ClubRevenueKpiRecord | undefined,
  settings: KereisMiaSettings = DEFAULT_KEREIS_MIA_SETTINGS,
): number {
  const dossierPct = Number(kpi?.linearCommissionPercent);
  if (Number.isFinite(dossierPct) && dossierPct >= 0 && dossierPct <= 100) {
    return Math.round(dossierPct * 100) / 100;
  }
  return settings.defaultLinearCommissionPercent;
}

export function computeKereisLinearCommissionEur(
  kpi: ClubRevenueKpiRecord | undefined,
  settings: KereisMiaSettings = DEFAULT_KEREIS_MIA_SETTINGS,
): { amountEur: number; fromPercent: boolean; percent: number; annualPremiumEur: number } {
  const percent = resolveLinearCommissionPercent(kpi, settings);
  const annualPremiumEur = roundEur(kpi?.annualPremiumEur ?? 0);

  if (kpi?.kereisCommissionOverrideEur != null && Number(kpi.kereisCommissionOverrideEur) > 0) {
    return {
      amountEur: roundEur(kpi.kereisCommissionOverrideEur),
      fromPercent: false,
      percent,
      annualPremiumEur,
    };
  }

  if (annualPremiumEur > 0 && percent > 0) {
    return {
      amountEur: roundEur((annualPremiumEur * percent) / 100),
      fromPercent: true,
      percent,
      annualPremiumEur,
    };
  }

  return { amountEur: 0, fromPercent: false, percent, annualPremiumEur };
}

export function resolvePartnerPayoutForClubRevenue(
  dossier: DossierClubRevenueSlice,
  feesCourtageEur: number,
  apporteurTier?: ApporteurRemunerationTier,
): {
  payoutEur: number;
  sponsorOverrideEur: number;
  retroPercent: number;
  kind: ClubRevenuePartnerKind;
  label: string;
} {
  const validation = dossier.studyConseillerValidation;
  const validatedCourtage = validation?.feesCourtageTotalEur;
  if (
    validation?.status === "approved" &&
    validation.conseillerRetroEur != null &&
    validatedCourtage != null &&
    roundEur(validatedCourtage) === feesCourtageEur
  ) {
    const retroPercent =
      feesCourtageEur > 0
        ? Math.round((validation.conseillerRetroEur / feesCourtageEur) * 100)
        : 70;
    return {
      payoutEur: roundEur(validation.conseillerRetroEur),
      sponsorOverrideEur: 0,
      retroPercent,
      kind: "conseiller",
      label: `Rétro conseiller (${retroPercent} % du courtage validé)`,
    };
  }

  const tier = apporteurTier ?? "autre";
  const config = getRemunerationConfig(tier);
  const retroPercent = Math.round(config.apporteurShareOfBrokerage * 100);

  if (!feesCourtageEur) {
    return {
      payoutEur: 0,
      sponsorOverrideEur: 0,
      retroPercent: 0,
      kind: "none",
      label: "Aucune rétro (courtage non renseigné)",
    };
  }

  const payoutEur = roundEur(feesCourtageEur * config.apporteurShareOfBrokerage);
  const sponsorOverrideEur = roundEur(
    feesCourtageEur * config.sponsorOverrideShareOfBrokerage,
  );
  const breakdown = resolveDossierCommission(dossier, config);

  if (breakdown.source === "estimate" && !dossier.studyKpi?.feesCourtageEur && !dossier.clubRevenueKpi?.feesCourtageOverrideEur) {
    return {
      payoutEur,
      sponsorOverrideEur,
      retroPercent,
      kind: "estimate",
      label: `Rétro partenaire estimée (${retroPercent} % du courtage)`,
    };
  }

  if (payoutEur <= 0 && sponsorOverrideEur <= 0) {
    return {
      payoutEur: 0,
      sponsorOverrideEur: 0,
      retroPercent: 0,
      kind: "none",
      label: "Aucune rétro partenaire",
    };
  }

  return {
    payoutEur,
    sponsorOverrideEur,
    retroPercent,
    kind: tier === "conseiller_immo_club" ? "conseiller" : "apporteur",
    label:
      tier === "conseiller_immo_club"
        ? `Rétro conseiller (${retroPercent} % du courtage)`
        : `Rétro apporteur (${retroPercent} % du courtage)`,
  };
}

/** Brut / net club : courtage (= distribution) + commission linéaire Kereis − rétro partenaire. */
export function computeClubRevenueBreakdown(
  dossier: DossierClubRevenueSlice,
  options?: {
    apporteurTier?: ApporteurRemunerationTier;
    kereisSettings?: KereisMiaSettings;
  },
): ClubRevenueBreakdown {
  const kpi = dossier.clubRevenueKpi;
  const settings = options?.kereisSettings ?? DEFAULT_KEREIS_MIA_SETTINGS;
  const productLine = kpi?.productLine || "emprunteur";

  const feesCourtageEur = resolveFeesCourtageEur(dossier);

  const kereis = computeKereisLinearCommissionEur(kpi, settings);
  const monthlyLinearCommissionEur =
    kereis.annualPremiumEur > 0 && kereis.percent > 0
      ? roundEur((kereis.annualPremiumEur * kereis.percent) / 100 / 12)
      : kereis.amountEur > 0
        ? roundEur(kereis.amountEur / 12)
        : 0;
  const partner = resolvePartnerPayoutForClubRevenue(
    dossier,
    feesCourtageEur,
    options?.apporteurTier,
  );

  const clubCourtageNetEur = feesCourtageEur - partner.payoutEur - partner.sponsorOverrideEur;
  const clubGrossEur = feesCourtageEur + kereis.amountEur;
  const clubNetEur = clubCourtageNetEur + kereis.amountEur;

  return {
    feesCourtageEur,
    linearCommissionPercent: kereis.percent,
    annualPremiumEur: kereis.annualPremiumEur,
    kereisCommissionEur: kereis.amountEur,
    kereisCommissionFromPercent: kereis.fromPercent,
    monthlyLinearCommissionEur,
    clubGrossEur,
    partnerRetroPercent: partner.retroPercent,
    partnerPayoutEur: partner.payoutEur,
    sponsorOverrideEur: partner.sponsorOverrideEur,
    clubCourtageNetEur,
    clubNetEur,
    partnerKind: partner.kind,
    partnerLabel: partner.label,
    productLine,
    paymentStatus: kpi?.paymentStatus || "pending",
    contractHelp: `Courtage = frais de distribution (ponctuel à la souscription). Rétro : 70 % conseiller, 50 % apporteur — uniquement sur le courtage. Commission Kereis linéaire : ${kereis.percent} % de la prime, versée chaque mois tant que le contrat est actif (≈ ${monthlyLinearCommissionEur} €/mois sur ce dossier). ${KEREIS_MIA_CONTRACT.emprunteur.recurringWhileActive}`,
  };
}

export function resolveApporteurTierFromType(apporteurType: unknown): ApporteurRemunerationTier {
  return resolveRemunerationTier(apporteurType);
}
