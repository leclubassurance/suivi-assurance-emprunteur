import { Dossier } from "./dossierModel";
import { LCIF_EMAIL_LOGO_IMG } from "../shared/emailBrand";

function baseLayout(innerHtml: string) {
  return `
<div style="font-family: Arial, sans-serif; color: #0f172a; max-width: 640px; margin: 0 auto; border: 1px solid #E2E8F0; padding: 20px; border-radius: 10px; background: #ffffff;">
  <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
    ${LCIF_EMAIL_LOGO_IMG}
    <div style="margin-left:auto;font-size:12px;color:#64748B;">Assurance emprunteur</div>
  </div>
  ${innerHtml}
  <div style="margin-top: 24px; padding-top: 14px; border-top: 1px solid #E2E8F0; color:#64748B; font-size:12px; line-height:1.45">
    Le Club Immobilier Français<br/>
    17 Passage Leroy, 44000 Nantes<br/>
    N° ORIAS : 24002253
  </div>
</div>`;
}

export function templateMissingDocsFollowup(dossier: Dossier, missing: string[], stage: number = 1) {
  const clientName = dossier.formData?.assures?.[0]?.prenom || "Bonjour";
  const missingList = missing.map(m => `<li style="margin-bottom:6px">${m}</li>`).join("");
  const stageLabel = stage === 1 ? "Relance" : stage === 2 ? "Deuxième relance" : `Troisième relance`;
  const inner = `
    <h2 style="color:#1E3A8A;margin:0 0 12px 0;font-size:18px;">Bonjour ${clientName},</h2>
    <p style="margin:0 0 14px 0;color:#334155;font-size:14px;line-height:1.55">
      ${stageLabel} concernant votre dossier <strong>${dossier.id}</strong> :
    </p>
    <p style="margin:0 0 14px 0;color:#334155;font-size:14px;line-height:1.55">
      Pour finaliser votre dossier, il nous manque encore les éléments suivants :
    </p>
    <ul style="margin:0 0 16px 18px;color:#334155;font-size:14px;line-height:1.55">
      ${missingList}
    </ul>
    <p style="margin:0 0 16px 0;color:#334155;font-size:14px;line-height:1.55">
      Vous pouvez simplement répondre à ce mail en joignant les documents.
    </p>
    <p style="margin:0;color:#1E3A8A;font-size:14px;font-weight:bold">Camille, l'assistante de Charles</p>
  `;
  return baseLayout(inner);
}

export function templateGenericFollowup(dossier: Dossier, text: string) {
  const clientName = dossier.formData?.assures?.[0]?.prenom || "Bonjour";
  const inner = `
    <h2 style="color:#1E3A8A;margin:0 0 12px 0;font-size:18px;">Bonjour ${clientName},</h2>
    <p style="margin:0 0 16px 0;color:#334155;font-size:14px;line-height:1.55">
      ${text}
    </p>
    <p style="margin:0;color:#1E3A8A;font-size:14px;font-weight:bold">Camille, l'assistante de Charles</p>
  `;
  return baseLayout(inner);
}

