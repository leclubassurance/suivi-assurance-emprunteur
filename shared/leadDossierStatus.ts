/** Prospect pré-formulaire (partagé admin + serveur). */
export function isLeadDossier(dossier: any): boolean {
  if (dossier?.leadPromotedAt) return false;
  if (Boolean(dossier?.isLead)) return true;
  if (String(dossier?.status || "").toUpperCase() === "PROSPECT") return true;
  const src = String(dossier?.leadSource || "");
  return src === "gmail_inbound" || src === "public_help";
}
