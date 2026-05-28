import { computeDocumentChecklist } from "../shared/documentChecklist";

function stripLeadingGreeting(bodyText: string) {
  const raw = String(bodyText || "").trim();
  if (!raw) return "";
  const lines = raw.split(/\r?\n/);
  let i = 0;
  // Remove 1-3 leading greeting lines like "Bonjour", "Bonjour X,", "Bonjour Monsieur Y,"
  while (i < lines.length && i < 3) {
    const l = lines[i].trim();
    if (!l) {
      i++;
      continue;
    }
    if (/^bonjour\b/i.test(l)) {
      i++;
      continue;
    }
    break;
  }
  return lines.slice(i).join("\n").trim();
}

export function wrapCamilleHtmlReply(bodyText: string, clientPrenom?: string) {
  const greeting = clientPrenom ? `Bonjour ${clientPrenom},` : "Bonjour,";
  const cleaned = stripLeadingGreeting(bodyText);
  const inner = cleaned.replace(/\n/g, "<br/>");

  return `<div style="font-family: Arial, sans-serif; color: #334155; max-width: 600px; line-height: 1.55; font-size: 14px;">
  <img src="https://res.cloudinary.com/dji8akleo/image/upload/v1772999309/5_yn8wfm.png" alt="Le Club Immobilier Français" style="max-width: 140px; margin-bottom: 16px;" />
  <p style="color: #1E3A8A; font-weight: bold; margin: 0 0 12px 0;">${greeting}</p>
  <div>${inner}</div>
  <div style="margin-top: 24px; padding-top: 14px; border-top: 1px solid #EFF6FF;">
    <p style="margin: 0; color: #1E3A8A; font-weight: bold;">Camille</p>
    <p style="margin: 2px 0 0 0; font-size: 12px; color: #64748B;">Assistante de Charles — Le Club Immobilier Français</p>
  </div>
</div>`;
}

export function buildCamilleContextBlock(dossier: any, newAttachmentNames: string[] = []) {
  const checklist = computeDocumentChecklist(dossier.formData?.documents || []);
  const missingBlocking = checklist.filter((c) => !c.ok && (c.key === "cni" || c.key === "rib"));
  const loanDocs = checklist.filter((c) => c.key === "offre" || c.key === "amort");
  const docs = (dossier.formData?.documents || []) as any[];
  const qualityIssues = docs
    .filter((d) => d?.quality && d.quality.ok === false)
    .map((d) => `${d.name || d.id}: ${(d.quality.reasons || []).join(", ")}`)
    .slice(0, 6);

  return {
    checklist,
    missingBlocking,
    loanDocsOk: loanDocs.every((c) => c.ok),
    newAttachmentNames,
    qualityIssues,
    documentSummary: checklist
      .map((c) => {
        const files = c.matchedFiles?.length ? ` (${c.matchedFiles.join(", ")})` : "";
        return `${c.label}: ${c.ok ? "reçu" : "manquant"}${files}`;
      })
      .join("\n"),
  };
}
