/**
 * Clause réseau (Option A) — intégrée au contrat d'apporteur d'affaires Le Club Immobilier Français.
 */
export const APPORTEUR_CONTRACT_MLM_CLAUSE = {
  title: "Programme de recommandation de partenaires (niveau 1)",
  summary:
    "Le Partenaire peut recommander de nouveaux partenaires via son espace sécurisé. Après validation et signature du contrat par le candidat, celui-ci est rattaché au parrain. Rémunération complémentaire : 10 % des frais de courtage perçus par Le Club Immobilier Français sur les dossiers signés des filleuls directs, en sus des 50 % sur les dossiers propres du parrain.",
  articles: [
    {
      heading: "Recommandation de partenaires",
      body:
        "Le Partenaire peut recommander un futur apporteur d'affaires via le formulaire dédié de son espace en ligne. Toute candidature est soumise à l'acceptation préalable de Le Club Immobilier Français, qui seul décide de l'envoi et de la conclusion du contrat d'apporteur avec le candidat.",
    },
    {
      heading: "Rattachement parrain — filleul",
      body:
        "À la signature du contrat d'apporteur par le candidat recommandé, celui-ci est automatiquement rattaché au Partenaire recommandant (parrain), pour un seul niveau de profondeur. Aucun autre niveau de réseau n'est rémunéré.",
    },
    {
      heading: "Rémunération réseau (override niveau 1)",
      body:
        "En sus de la rémunération sur ses propres dossiers (50 % des frais de courtage, dans les conditions du contrat principal), le parrain perçoit une commission de 10 % des frais de courtage afférents aux dossiers d'assurance emprunteur effectivement signés par les clients apportés par ses filleuls directs. Les montants sont indicatifs et calculés selon le barème en vigueur (10 % des économies, plancher 200 € / plafond 500 € par assuré).",
    },
    {
      heading: "Paiement",
      body:
        "Les commissions réseau sont dues et payées dans les mêmes conditions que la rémunération principale : à réception par Le Club Immobilier Français de la commission versée par l'assureur, sous réserve de conformité du dossier et absence de réclamation ou de rétractation.",
    },
    {
      heading: "Absence de statut mandataire ou d'exclusivité réseau",
      body:
        "Le programme de recommandation ne confère aucun statut de mandataire d'assurance, ni droit à recruter en dehors de l'outil mis à disposition par Le Club Immobilier Français, ni exclusivité territoriale. Le Partenaire reste un apporteur d'affaires indépendant, non soumis à la réglementation ORIAS au titre de cette activité.",
    },
  ],
} as const;

export function formatApporteurContractMlmForDisplay(): string {
  const { title, summary, articles } = APPORTEUR_CONTRACT_MLM_CLAUSE;
  const body = articles.map((a) => `${a.heading}\n${a.body}`).join("\n\n");
  return `${title}\n\n${summary}\n\n${body}`;
}
