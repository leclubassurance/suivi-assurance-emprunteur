import type { Apporteur } from "./apporteurTypes";
import { getRemunerationConfig, resolveRemunerationTier, type RemunerationConfig } from "./apporteurRemuneration";
import { isConseillerImmoClubType } from "./conseillerImmoClub";

const FR_PERCENT_WORDS: Record<number, string> = {
  10: "dix",
  15: "quinze",
  20: "vingt",
  25: "vingt-cinq",
  30: "trente",
  35: "trente-cinq",
  40: "quarante",
  45: "quarante-cinq",
  50: "cinquante",
  55: "cinquante-cinq",
  60: "soixante",
  65: "soixante-cinq",
  70: "soixante-dix",
  75: "soixante-quinze",
  80: "quatre-vingts",
  85: "quatre-vingt-cinq",
  90: "quatre-vingt-dix",
  95: "quatre-vingt-quinze",
  100: "cent",
};

/** Normalise un pourcentage admin (1–100) ; `null` si invalide / absent. */
export function normalizeBrokerageSharePercent(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", ".").trim());
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 1 || rounded > 100) return null;
  return rounded;
}

export function defaultBrokerageSharePercentForType(type: Apporteur["type"] | unknown): number {
  return isConseillerImmoClubType(type) ? 70 : 50;
}

/** Pourcentage effectif (override admin ou défaut type). */
export function resolveBrokerageSharePercent(
  apporteur: Pick<Apporteur, "type" | "brokerageSharePercent">,
): number {
  const override = normalizeBrokerageSharePercent(apporteur.brokerageSharePercent);
  if (override != null) return override;
  return defaultBrokerageSharePercentForType(apporteur.type);
}

export function formatBrokerageShareForContract(percentInt: number): {
  percentInt: number;
  words: string;
  label: string;
} {
  const p = Math.max(1, Math.min(100, Math.round(percentInt)));
  const words = FR_PERCENT_WORDS[p] || String(p);
  return {
    percentInt: p,
    words,
    label: `${words} pour cent (${p} %)`,
  };
}

/** Config rémunération avec éventuel override de part apporteur. */
export function resolveRemunerationConfigForApporteur(
  apporteur: Pick<Apporteur, "type" | "brokerageSharePercent">,
): RemunerationConfig {
  const base = getRemunerationConfig(resolveRemunerationTier(apporteur.type));
  const percent = resolveBrokerageSharePercent(apporteur);
  const share = percent / 100;
  if (Math.abs(share - base.apporteurShareOfBrokerage) < 0.0001) {
    return base;
  }
  const isConseiller = isConseillerImmoClubType(apporteur.type);
  const role = isConseiller ? "vos dossiers signés" : "vos dossiers signés";
  const disclaimer = isConseiller
    ? `Montants indicatifs TTC : ${percent} % des frais de courtage sur ${role}. Paiement à réception de la commission assureur.`
    : base.sponsorOverrideShareOfBrokerage > 0
      ? `Montants indicatifs TTC : ${percent} % des frais de courtage sur vos dossiers signés ; ${Math.round(base.sponsorOverrideShareOfBrokerage * 100)} % des frais de courtage sur les dossiers signés de vos filleuls directs (niveau 1). Paiement à réception de la commission assureur.`
      : `Montants indicatifs TTC : ${percent} % des frais de courtage sur ${role}. Paiement à réception de la commission assureur.`;
  return {
    ...base,
    apporteurShareOfBrokerage: share,
    disclaimer,
  };
}

/** Accès formation Coassemble (opt-in admin pour les nouveaux ; legacy = autorisé). */
export function canAccessConseillerFormation(
  apporteur: Pick<Apporteur, "formationAccessGranted" | "type">,
): boolean {
  if (!isConseillerImmoClubType(apporteur.type)) return false;
  return apporteur.formationAccessGranted !== false;
}
