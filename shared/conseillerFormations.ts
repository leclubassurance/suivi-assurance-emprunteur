/** Module de formation conseillers LCIF (contenu admin + iframe Coassemble). */
export type ConseillerFormationModule = {
  id: string;
  order: number;
  title: string;
  /** Texte d'introduction affiché au conseiller avant l'iframe. */
  description: string;
  /** URL embed Coassemble — l'accès réel est géré côté Coassemble. */
  embedUrl: string;
};

export const DEFAULT_CONSEILLER_FORMATIONS: ConseillerFormationModule[] = [
  {
    id: "intro-lcif",
    order: 1,
    title: "Bienvenue dans le programme conseillers LCIF",
    description:
      "Découvrez le partenariat, votre rôle dans l'accompagnement client et les étapes du parcours assurance emprunteur au Club.",
    embedUrl: "",
  },
  {
    id: "fondamentaux-assurance-emprunteur",
    order: 2,
    title: "Les fondamentaux de l'assurance emprunteur",
    description:
      "Garanties essentielles, vocabulaire métier et enjeux pour vos clients emprunteurs — les bases avant toute recommandation.",
    embedUrl: "",
  },
  {
    id: "loi-lemoine-delegation",
    order: 3,
    title: "Loi Lemoine et délégation d'assurance",
    description:
      "Comprendre le changement d'assurance en cours de prêt, les droits du client et ce que vous pouvez — ou ne pouvez pas — lui promettre.",
    embedUrl: "",
  },
  {
    id: "lecture-contrat",
    order: 4,
    title: "Lire un contrat d'assurance existant",
    description:
      "Identifier les éléments clés du tableau d'amortissement, de la fiche standardisée et du contrat en cours pour orienter le client.",
    embedUrl: "",
  },
  {
    id: "recommander-client",
    order: 5,
    title: "Recommander un client en 2 minutes",
    description:
      "Utiliser votre lien dédié, recueillir les pièces et présenter le parcours LCIF avec clarté et conformité.",
    embedUrl: "",
  },
  {
    id: "etude-courtage",
    order: 6,
    title: "Étude personnalisée et validation du courtage",
    description:
      "Comment se déroule le débrief LCIF, la validation des frais de courtage et l'envoi de l'étude au client.",
    embedUrl: "",
  },
  {
    id: "accompagner-decision",
    order: 7,
    title: "Accompagner la décision du client",
    description:
      "Répondre aux objections, respecter le devoir de conseil et suivre l'avancement dans votre espace conseiller.",
    embedUrl: "",
  },
];

export function normalizeConseillerFormationModule(raw: unknown, index: number): ConseillerFormationModule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = String(r.title || "").trim();
  if (!title) return null;
  return {
    id: String(r.id || `formation-${index + 1}`).trim(),
    order: Number.isFinite(Number(r.order)) ? Number(r.order) : index + 1,
    title,
    description: String(r.description || "").trim(),
    embedUrl: String(r.embedUrl || "").trim(),
  };
}

export function sortConseillerFormations(modules: ConseillerFormationModule[]): ConseillerFormationModule[] {
  return [...modules].sort((a, b) => a.order - b.order);
}
