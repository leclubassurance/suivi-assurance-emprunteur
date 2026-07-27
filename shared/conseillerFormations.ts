/** Parcours formation conseillers LCIF — un seul lien Coassemble regroupant tous les modules. */
export type ConseillerFormationParcours = {
  title: string;
  /** Texte d'introduction affiché au conseiller avant l'iframe. */
  description: string;
  /** URL iframe du parcours Coassemble — modules et accès gérés côté Coassemble. */
  embedUrl: string;
};

export type FormationAudience = "conseiller" | "apporteur";

export const DEFAULT_CONSEILLER_FORMATION_PARCOURS: ConseillerFormationParcours = {
  title: "Formation assurance emprunteur LCIF",
  description:
    "Parcours complet pour maîtriser l'accompagnement assurance emprunteur de vos clients. Tous les modules sont regroupés dans Coassemble — suivez le parcours à votre rythme, votre progression y est enregistrée.",
  embedUrl: "",
};

/** Parcours formation apporteurs d'affaires (lien Coassemble distinct des conseillers). */
export const DEFAULT_APPORTEUR_FORMATION_PARCOURS: ConseillerFormationParcours = {
  title: "Formation apporteur d'affaires LCIF",
  description:
    "Parcours dédié aux apporteurs d'affaires — suivez la formation à votre rythme sur Coassemble, votre progression y est enregistrée.",
  embedUrl: "https://coassemble.com/c/AGY26O",
};

export function normalizeConseillerFormationParcours(
  raw: unknown,
  defaults: ConseillerFormationParcours = DEFAULT_CONSEILLER_FORMATION_PARCOURS,
): ConseillerFormationParcours {
  if (!raw || typeof raw !== "object") {
    return { ...defaults };
  }
  const r = raw as Record<string, unknown>;
  const embedUrl = String(r.embedUrl || "").trim() || defaults.embedUrl;
  return {
    title: String(r.title || defaults.title).trim(),
    description: String(r.description || "").trim() || defaults.description,
    embedUrl,
  };
}
