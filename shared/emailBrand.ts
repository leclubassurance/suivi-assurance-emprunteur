/** Logo LCIF pour les emails HTML (proportions maîtrisées sur mobile). */
export const LCIF_EMAIL_LOGO_URL =
  "https://res.cloudinary.com/dji8akleo/image/upload/v1772999309/5_yn8wfm.png";

/** Bandeau clair (Camille, modèles). */
export const LCIF_EMAIL_LOGO_IMG = `<img src="${LCIF_EMAIL_LOGO_URL}" alt="Le Club Immobilier Français" width="120" height="48" style="display:block;width:120px;height:48px;max-width:42%;object-fit:contain;margin:0 0 14px 0;border:0;" />`;

/** En-tête bleu foncé (confirmation dépôt). */
export const LCIF_EMAIL_LOGO_HEADER_IMG = `<img src="${LCIF_EMAIL_LOGO_URL}" alt="Le Club Immobilier Français" width="130" height="52" style="display:inline-block;width:130px;height:52px;max-width:55%;object-fit:contain;border:0;vertical-align:middle;" />`;

const LCIF_EMAIL_NAVY = "#1E3A8A";

/** Mise en page client Camille / relances avec bandeau bleu et logo visible. */
export function wrapLcifClientEmailHtml(innerHtml: string): string {
  return `<div style="font-family: Arial, sans-serif; color: #334155; max-width: 600px; line-height: 1.55; font-size: 14px; margin: 0 auto;">
  <div style="background-color:${LCIF_EMAIL_NAVY};padding:28px 20px;text-align:center;">
    ${LCIF_EMAIL_LOGO_HEADER_IMG}
  </div>
  <div style="padding:24px 22px;background:#ffffff;">
    ${innerHtml}
    <div style="margin-top: 24px; padding-top: 14px; border-top: 1px solid #EFF6FF;">
      <p style="margin: 0; color: ${LCIF_EMAIL_NAVY}; font-weight: bold;">Camille</p>
      <p style="margin: 2px 0 0 0; font-size: 12px; color: #64748B;">Assistante de Charles — Le Club Immobilier Français</p>
    </div>
  </div>
</div>`;
}
