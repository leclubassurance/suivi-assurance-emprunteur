import type { EconomyComputation } from "./economyFromDocs";

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

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background-color:#F8FAFC;color:#1F2937;line-height:1.6;">
<div style="max-width:640px;margin:0 auto;background-color:#FFFFFF;">
  <div style="background-color:#1E3A8A;padding:32px 24px;text-align:center;">
    <img src="https://res.cloudinary.com/dji8akleo/image/upload/v1772999309/5_yn8wfm.png" alt="Le Club Immobilier Français" style="max-width:180px;height:auto;display:inline-block;" />
  </div>

  <div style="padding:32px 28px;">
    <p style="font-size:16px;margin:0 0 16px 0;color:#1F2937;">${greeting}</p>
    <p style="font-size:15px;margin:0 0 16px 0;color:#1F2937;">
      J'ai analysé votre dossier de prêt immobilier et je suis en mesure de vous présenter les résultats de notre étude de substitution d'assurance emprunteur.
    </p>

    <div style="background-color:#EFF6FF;border-left:4px solid #1E3A8A;padding:24px;margin:24px 0;border-radius:4px;">
      <p style="font-size:14px;margin:0 0 8px 0;color:#1E3A8A;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">
        Économie brute sur la durée restante du prêt
      </p>
      <p style="font-size:36px;margin:0 0 4px 0;color:#1E3A8A;font-weight:700;">${eurPlain(r.grossSavings || 0)}</p>
      <p style="font-size:13px;margin:0 0 20px 0;color:#6B7280;font-style:italic;">
        avant déduction des frais éventuels (si applicables)
      </p>

      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:10px 0;border-bottom:1px solid #DBEAFE;color:#4B5563;">Assurance actuelle (durée restante)</td><td style="padding:10px 0;border-bottom:1px solid #DBEAFE;text-align:right;color:#1F2937;font-weight:600;">${eurPlain(r.currentTotalRemaining || 0)}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #DBEAFE;color:#4B5563;">Nouvelle assurance (durée restante)</td><td style="padding:10px 0;border-bottom:1px solid #DBEAFE;text-align:right;color:#1F2937;font-weight:600;">${eurPlain(r.proposedTotalRemaining || 0)}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:2px solid #1E3A8A;color:#1E3A8A;font-weight:700;">Économie brute</td><td style="padding:10px 0;border-bottom:2px solid #1E3A8A;text-align:right;color:#1E3A8A;font-weight:700;">${eurPlain(r.grossSavings || 0)}</td></tr>
      </table>
    </div>

    <h3 style="font-size:18px;margin:32px 0 12px 0;color:#1E3A8A;">Évolution estimée des cotisations</h3>
    <p style="font-size:14px;margin:0 0 16px 0;color:#1F2937;">
      Les cotisations de la nouvelle assurance évoluent au fil du temps. Voici une estimation par périodes :
    </p>

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
      Estimations basées sur les informations présentes dans les documents transmis. Elles peuvent varier en cas de modulation, remboursement anticipé ou changement de dates.
    </p>

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

  const subject = `${prenom}, votre étude personnalisée d’assurance emprunteur`;
  return { subject, html };
}

