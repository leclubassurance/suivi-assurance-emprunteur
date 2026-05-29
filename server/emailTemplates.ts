import { Dossier } from "./dossierModel";
import { wrapLcifClientEmailHtml } from "../shared/emailBrand";

function baseLayout(innerHtml: string) {
  return wrapLcifClientEmailHtml(
    `${innerHtml}
  <div style="margin-top: 20px; padding-top: 12px; border-top: 1px solid #E2E8F0; color:#64748B; font-size:12px; line-height:1.45">
    Le Club Immobilier Français<br/>
    17 Passage Leroy, 44000 Nantes<br/>
    N° ORIAS : 24002253
  </div>`,
  );
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
  `;
  return baseLayout(inner);
}

