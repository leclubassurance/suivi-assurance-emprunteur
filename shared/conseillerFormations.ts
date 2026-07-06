/** Parcours formation conseillers LCIF — un seul lien Coassemble regroupant tous les modules. */
export type ConseillerFormationParcours = {
  title: string;
  /** Texte d'introduction affiché au conseiller avant l'iframe. */
  description: string;
  /** URL iframe du parcours Coassemble — modules et accès gérés côté Coassemble. */
  embedUrl: string;
};

export const DEFAULT_CONSEILLER_FORMATION_PARCOURS: ConseillerFormationParcours = {
  title: "Formation assurance emprunteur LCIF",
  description:
    "Parcours complet pour maîtriser l'accompagnement assurance emprunteur de vos clients. Tous les modules sont regroupés dans Coassemble — suivez le parcours à votre rythme, votre progression y est enregistrée.",
  embedUrl: "",
};

export function normalizeConseillerFormationParcours(raw: unknown): ConseillerFormationParcours {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_CONSEILLER_FORMATION_PARCOURS };
  }
  const r = raw as Record<string, unknown>;
  return {
    title: String(r.title || DEFAULT_CONSEILLER_FORMATION_PARCOURS.title).trim(),
    description: String(r.description || "").trim() || DEFAULT_CONSEILLER_FORMATION_PARCOURS.description,
    embedUrl: String(r.embedUrl || "").trim(),
  };
}
