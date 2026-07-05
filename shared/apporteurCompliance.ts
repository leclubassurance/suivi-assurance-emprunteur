/** Textes conformité / transparence — apporteurs d'affaires LCIF. */

/** Mention client (email LCIF) — désormais dans la politique de confidentialité (section 2 bis), pas dans le corps des mails. */
export function buildClientPartnerDisclosureHtml(_partnerDisplayName: string): string {
  return "";
}

/** Barème courtage affiché dans l'étude lorsque le montant n'est pas encore chiffré. */
export const LCIF_COURTAGE_BARME_DISCLOSURE =
  "En cas de changement effectif, des frais de courtage LCIF s'appliquent selon le barème en vigueur : 10 % de l'économie totale estimée sur la durée restante du prêt, avec un minimum de 200 € et un maximum de 500 € par assuré. Le montant exact vous est communiqué dans la présente étude ou avant tout engagement de votre part.";

/** Avertissement prospection — contrat, guide, espace partenaire. */
export const APPORTEUR_PROSPECTION_DISCLAIMER =
  "Toute prise de contact par WhatsApp, SMS ou téléphone doit respecter la réglementation applicable : consentement ou relation préexistante, information loyale, respect des listes d'opposition au démarchage téléphonique (notamment Bloctel) le cas échéant, et droit d'opposition de vos contacts. Le Partenaire demeure seul responsable de sa prospection.";

export const APPORTEUR_PROSPECTION_DISCLAIMER_SHORT =
  "Prospection : respectez le consentement de vos contacts, Bloctel pour le téléphone, et le droit d'opposition. Vous restez responsable de vos messages.";
