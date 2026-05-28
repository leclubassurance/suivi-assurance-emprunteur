import type { EconomyComputation } from "./economyFromDocs";
import { LCIF_EMAIL_LOGO_HEADER_IMG } from "../shared/emailBrand";

function eur(n: number) {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

function eurPlain(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export function buildEconomyHtmlDraft(dossier: any, comp: EconomyComputation) {
  const prenom = dossier?.formData?.assures?.[0]?.prenom || "Bonjour";
  const nom2 = dossier?.formData?.assures?.[1]?.prenom;
  const greeting = nom2 ? `Bonjour ${prenom}, bonjour ${nom2},` : `Bonjour ${prenom},`;

  const r = comp.result!;
  const gross = r.grossSavings || 0;
  const feesAssureur = comp.extracted?.feesAssureurTotal ?? null;
  const feesCourtier = comp.extracted?.feesCourtierTotal ?? null;
  const feesKnown = feesAssureur != null || feesCourtier != null;
  const approxNet = gross - (feesAssureur ?? 0) - (feesCourtier ?? 0);

  const scenario: "A" | "B" | "C" =
    gross <= 0 ? "C" : approxNet >= 500 ? "A" : "B";
  const tableRows = (r.table || [])
    .filter((x) => x.proposedMonthly != null)
    .map((row, idx) => {
      const alt = idx % 2 === 1 ? "background-color:#F9FAFB;" : "";
      const cur = row.currentMonthly != null ? eurPlain(row.currentMonthly) : "—";
      const prop = row.proposedMonthly != null ? eurPlain(row.proposedMonthly) : "—";
      const gain = row.gainMonthly != null ? eurPlain(row.gainMonthly) : "—";
      const gainColor = row.gainMonthly != null && row.gainMonthly > 0 ? "#16A34A" : "#6B7280";
      return `<tr style="${alt}">
  <td style="padding:10px 12px;border-bottom:1px solid #E5E7EB;">${row.label}</td>
  <td style="padding:10px 12px;border-bottom:1px solid #E5E7EB;text-align:right;">${cur}</td>
  <td style="padding:10px 12px;border-bottom:1px solid #E5E7EB;text-align:right;">${prop}</td>
  <td style="padding:10px 12px;border-bottom:1px solid #E5E7EB;text-align:right;color:${gainColor};font-weight:600;">${gain}</td>
</tr>`;
    })
    .join("\n");

  if (scenario === "C") {
    const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background-color:#F8FAFC;color:#1F2937;line-height:1.6;">
<div style="max-width:640px;margin:0 auto;background-color:#FFFFFF;">
  <div style="background-color:#1E3A8A;padding:32px 24px;text-align:center;">
    ${LCIF_EMAIL_LOGO_HEADER_IMG}
  </div>

  <div style="padding:32px 28px;">
    <p style="font-size:16px;margin:0 0 16px 0;color:#1F2937;">${greeting}</p>
    <div style="background-color:#F0FDF4;border:1px solid #BBF7D0;border-left:4px solid #16A34A;padding:18px 16px;margin:18px 0;border-radius:6px;">
      <p style="margin:0 0 8px 0;color:#166534;font-weight:700;">Bonne nouvelle&nbsp;: votre assurance emprunteur est déjà bien optimisée.</p>
      <p style="margin:0;color:#166534;font-size:14px;">
        Après analyse des documents transmis, nous ne constatons pas, à ce stade, d'amélioration économique évidente par une substitution d'assurance (à garanties équivalentes).
      </p>
    </div>

    <p style="font-size:14px;margin:0 0 16px 0;color:#1F2937;">
      C'est plutôt rare, et c'est un vrai signe que vous avez bien fait les choses lors de la souscription de votre prêt.
      Si votre situation évolue (rachat, remboursement anticipé, nouveau prêt), je peux refaire une analyse à tout moment.
    </p>

    <div style="background-color:#EFF6FF;border-left:4px solid #1E3A8A;padding:16px 16px;margin:18px 0;border-radius:6px;">
      <p style="margin:0;color:#1E3A8A;font-weight:700;">Autour de vous</p>
      <p style="margin:8px 0 0 0;color:#1F2937;font-size:14px;">
        Si vous connaissez des proches propriétaires ou futurs acquéreurs, notre équipe peut vérifier gratuitement leur situation.
        Il suffit de répondre à ce mail.
      </p>
    </div>

    <p style="font-size:14px;margin:24px 0 0 0;color:#1F2937;">Une question ? Répondez à ce mail, je vous reviens sous 24h.</p>

    <p style="font-size:14px;margin:32px 0 0 0;color:#1F2937;">Bien cordialement,<br/>
      <strong>Charles Victor</strong><br/>
      <span style="color:#6B7280;">Conseiller en assurance emprunteur</span><br/>
      <span style="color:#6B7280;">Le Club Immobilier Français</span>
    </p>
  </div>

  <div style="background-color:#F8FAFC;padding:20px 28px;border-top:1px solid #E5E7EB;">
    <p style="font-size:11px;margin:0;color:#9CA3AF;line-height:1.5;">
      Le Club Immobilier Français — 17 Passage Leroy, 44000 Nantes<br/>
      N° ORIAS : 24002253 | Courtier en assurance emprunteur, indépendant de tout assureur<br/>
      Cette proposition est établie à titre indicatif et n'a pas de valeur contractuelle.
    </p>
  </div>
</div>
</body>
</html>`;
    const subject = `${prenom}, les résultats de l'analyse de votre assurance emprunteur`;
    return { subject, html };
  }

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background-color:#F8FAFC;color:#1F2937;line-height:1.6;">
<div style="max-width:640px;margin:0 auto;background-color:#FFFFFF;">
  <div style="background-color:#1E3A8A;padding:32px 24px;text-align:center;">
    ${LCIF_EMAIL_LOGO_HEADER_IMG}
  </div>

  <div style="padding:32px 28px;">
    <p style="font-size:16px;margin:0 0 16px 0;color:#1F2937;">${greeting}</p>
    <p style="font-size:15px;margin:0 0 16px 0;color:#1F2937;">
      J'ai analysé votre dossier avec des garanties <strong>équivalentes</strong> à votre contrat actuel.
    </p>

    <div style="background-color:#EFF6FF;border-left:4px solid #1E3A8A;padding:24px;margin:24px 0;border-radius:6px;">
      <p style="font-size:14px;margin:0 0 8px 0;color:#1E3A8A;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">
        Économie brute estimée (avant frais)
      </p>
      <p style="font-size:36px;margin:0 0 4px 0;color:#1E3A8A;font-weight:700;">${eurPlain(gross)}</p>
      <p style="font-size:13px;margin:0 0 16px 0;color:#6B7280;font-style:italic;">
        Les frais éventuels (si applicables) sont à déduire une seule fois à la mise en place.
      </p>

      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:10px 0;border-bottom:1px solid #DBEAFE;color:#4B5563;">Assurance actuelle (durée restante)</td><td style="padding:10px 0;border-bottom:1px solid #DBEAFE;text-align:right;color:#1F2937;font-weight:600;">${eurPlain(r.currentTotalRemaining || 0)}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #DBEAFE;color:#4B5563;">Nouvelle assurance (durée restante)</td><td style="padding:10px 0;border-bottom:1px solid #DBEAFE;text-align:right;color:#1F2937;font-weight:600;">${eurPlain(r.proposedTotalRemaining || 0)}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:2px solid #1E3A8A;color:#1E3A8A;font-weight:700;">Économie brute</td><td style="padding:10px 0;border-bottom:2px solid #1E3A8A;text-align:right;color:#1E3A8A;font-weight:700;">${eurPlain(gross)}</td></tr>
      </table>

      <div style="margin-top:14px;font-size:13px;color:#374151;">
        <div style="margin:6px 0;">
          <span style="font-weight:600;">Frais de dossier de la nouvelle assurance :</span>
          <span>${feesAssureur != null ? eurPlain(feesAssureur) : "___ €"}</span>
        </div>
        <div style="margin:6px 0;">
          <span style="font-weight:600;">Frais de courtage :</span>
          <span>${feesCourtier != null ? eurPlain(feesCourtier) : "___ €"}</span>
        </div>
        ${feesKnown ? `<div style="margin-top:6px;color:#6B7280;font-style:italic;">Ces frais ne se reproduisent pas aux renouvellements.</div>` : ""}
      </div>
    </div>

    <h3 style="font-size:18px;margin:28px 0 12px 0;color:#1E3A8A;">Évolution estimée des cotisations</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;">
      <thead>
        <tr style="background-color:#1E3A8A;color:#FFFFFF;">
          <th style="padding:12px;text-align:left;font-weight:600;">Période</th>
          <th style="padding:12px;text-align:right;font-weight:600;">Actuelle / mois</th>
          <th style="padding:12px;text-align:right;font-weight:600;">Proposée / mois</th>
          <th style="padding:12px;text-align:right;font-weight:600;">Gain / mois</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows || ""}
      </tbody>
    </table>

    <p style="font-size:12px;margin:8px 0 0 0;color:#6B7280;font-style:italic;">
      Ces estimations sont basées sur le capital restant dû et les éléments présents dans les documents transmis. Elles peuvent varier en cas de remboursement anticipé ou de changement de dates.
    </p>

    <h3 style="font-size:18px;margin:28px 0 12px 0;color:#1E3A8A;">Comment ça marche</h3>
    <ol style="margin:0 0 16px 18px;padding:0;color:#1F2937;font-size:14px;">
      <li style="margin:6px 0;">Vous me confirmez par retour de mail que vous souhaitez activer le changement.</li>
      <li style="margin:6px 0;">Vous joignez les pièces ci-dessous (si elles ne sont pas déjà en notre possession).</li>
      <li style="margin:6px 0;">Notre équipe constitue et soumet le dossier (en général 48h à 5 jours ouvrés). La banque dispose ensuite de 10 jours ouvrés pour statuer.</li>
    </ol>

    <h3 style="font-size:18px;margin:20px 0 12px 0;color:#1E3A8A;">Pièces à fournir</h3>
    <ul style="margin:0 0 22px 18px;padding:0;color:#1F2937;font-size:14px;">
      <li style="margin:6px 0;">Carte d'identité (recto-verso, en cours de validité)</li>
      <li style="margin:6px 0;">RIB (prélèvement des cotisations)</li>
    </ul>

    <div style="background-color:#1E3A8A;border-radius:8px;text-align:center;padding:14px 16px;margin:18px 0 0 0;">
      <p style="margin:0;color:#FFFFFF;font-weight:700;font-size:15px;">Répondez à ce mail en joignant vos documents</p>
    </div>

    <p style="font-size:14px;margin:24px 0 0 0;color:#1F2937;">Bien cordialement,<br/>
      <strong>Charles Victor</strong><br/>
      <span style="color:#6B7280;">Conseiller en assurance emprunteur</span><br/>
      <span style="color:#6B7280;">Le Club Immobilier Français</span>
    </p>
  </div>

  <div style="background-color:#F8FAFC;padding:20px 28px;border-top:1px solid #E5E7EB;">
    <p style="font-size:11px;margin:0;color:#9CA3AF;line-height:1.5;">
      Le Club Immobilier Français — 17 Passage Leroy, 44000 Nantes<br/>
      N° ORIAS : 24002253 | Courtier en assurance emprunteur, indépendant de tout assureur<br/>
      Cette proposition est établie à titre indicatif et n'a pas de valeur contractuelle.
    </p>
  </div>
</div>
</body>
</html>`;

  const subject =
    scenario === "A"
      ? `${prenom}, votre assurance emprunteur peut vous faire économiser ~${Math.round(gross).toLocaleString("fr-FR")} €`
      : `${prenom}, les résultats de l'analyse de votre assurance emprunteur`;
  return { subject, html };
}

