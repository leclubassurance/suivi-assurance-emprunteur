/**
 * Horaires de fonctionnement de Camille (assistant IA email).
 * Contrôlé depuis l'admin — évite de dépendre d'une variable d'environnement.
 * Fuseau de référence : Europe/Paris.
 */

export type CamilleSchedule = {
  /** Camille traite automatiquement les emails entrants (réponses IA / brouillons Telegram). */
  enabled: boolean;
  /** Jours actifs (0 = dimanche … 6 = samedi). */
  daysOfWeek: number[];
  /** Heure de début incluse (0-23), Paris. */
  startHour: number;
  /** Heure de fin exclue (1-24), Paris. startHour === endHour ⇒ 24h/24. */
  endHour: number;
};

export const CAMILLE_WEEKDAY_LABELS = [
  "Dimanche",
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
];

/** Ordre d'affichage lundi → dimanche. */
export const CAMILLE_WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const DEFAULT_CAMILLE_SCHEDULE: CamilleSchedule = {
  enabled: true,
  daysOfWeek: [1, 2, 3, 4, 5],
  startHour: 8,
  endHour: 20,
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeCamilleSchedule(raw: unknown): CamilleSchedule {
  const data = (raw || {}) as Partial<CamilleSchedule>;
  const days = Array.isArray(data.daysOfWeek)
    ? [...new Set(data.daysOfWeek.map((d) => clampInt(d, 0, 6, -1)).filter((d) => d >= 0))].sort(
        (a, b) => a - b,
      )
    : [...DEFAULT_CAMILLE_SCHEDULE.daysOfWeek];
  return {
    enabled: data.enabled === undefined ? DEFAULT_CAMILLE_SCHEDULE.enabled : Boolean(data.enabled),
    daysOfWeek: days,
    startHour: clampInt(data.startHour, 0, 23, DEFAULT_CAMILLE_SCHEDULE.startHour),
    endHour: clampInt(data.endHour, 1, 24, DEFAULT_CAMILLE_SCHEDULE.endHour),
  };
}

/** Camille est-elle ouverte à cet instant (jour + heure Paris déjà résolus) ? */
export function isWithinCamilleSchedule(
  schedule: CamilleSchedule,
  moment: { day: number; hour: number },
): boolean {
  if (!schedule.enabled) return false;
  if (schedule.daysOfWeek.length && !schedule.daysOfWeek.includes(moment.day)) return false;
  const { startHour, endHour } = schedule;
  if (startHour === endHour) return true;
  if (startHour < endHour) return moment.hour >= startHour && moment.hour < endHour;
  // Plage de nuit (ex. 20h → 6h)
  return moment.hour >= startHour || moment.hour < endHour;
}

/** Libellé humain (ex. "Lun–Ven · 8h–20h" ou "En pause"). */
export function describeCamilleSchedule(schedule: CamilleSchedule): string {
  if (!schedule.enabled) return "En pause (aucun traitement automatique)";
  const daysLabel =
    schedule.daysOfWeek.length === 7
      ? "Tous les jours"
      : schedule.daysOfWeek.length === 0
        ? "Aucun jour"
        : CAMILLE_WEEKDAY_ORDER.filter((d) => schedule.daysOfWeek.includes(d))
            .map((d) => CAMILLE_WEEKDAY_LABELS[d].slice(0, 3))
            .join(", ");
  const hoursLabel =
    schedule.startHour === schedule.endHour
      ? "24h/24"
      : `${schedule.startHour}h–${schedule.endHour}h`;
  return `${daysLabel} · ${hoursLabel} (Paris)`;
}
