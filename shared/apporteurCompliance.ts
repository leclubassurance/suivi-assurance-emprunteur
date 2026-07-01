/** Textes conformité / transparence — apporteurs d'affaires LCIF. */

/** Mention client (email LCIF) — lien commercial, formulation volontairement sobre. */
export function buildClientPartnerDisclosureHtml(partnerDisplayName: string): string {
  const name = String(partnerDisplayName || "votre contact").trim() || "votre contact";
  return `Cette mise en relation a été initiée par <strong>${name}</strong>, partenaire commercial indépendant du Club. Il peut percevoir une rémunération si vous décidez, de votre propre initiative, de poursuivre un changement d'assurance — sans incidence sur les montants qui vous sont proposés.`;
}

/** Barème courtage affiché dans l'étude lorsque le montant n'est pas encore chiffré. */
export const LCIF_COURTAGE_BARME_DISCLOSURE =
  "En cas de changement effectif, des frais de courtage LCIF s'appliquent selon le barème en vigueur : 10 % de l'économie totale estimée sur la durée restante du prêt, avec un minimum de 200 € et un maximum de 500 € par assuré. Le montant exact vous est communiqué dans la présente étude ou avant tout engagement de votre part.";

/** Avertissement prospection — contrat, guide, espace partenaire. */
export const APPORTEUR_PROSPECTION_DISCLAIMER =
  "Toute prise de contact par WhatsApp, SMS ou téléphone doit respecter la réglementation applicable : consentement ou relation préexistante, information loyale, respect des listes d'opposition au démarchage téléphonique (notamment Bloctel) le cas échéant, et droit d'opposition de vos contacts. Le Partenaire demeure seul responsable de sa prospection.";

export const APPORTEUR_PROSPECTION_DISCLAIMER_SHORT =
  "Prospection : respectez le consentement de vos contacts, Bloctel pour le téléphone, et le droit d'opposition. Vous restez responsable de vos messages.";
