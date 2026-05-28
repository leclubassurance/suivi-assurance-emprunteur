import type { Dossier } from "./dossierModel";
import { buildDossierDetailBlock } from "./camilleTelegramChat";
import { buildCamilleContextBlock } from "./camilleMail";
import { getAiAuditTrail } from "./aiAuditLog";
import { assessCertainLoanDocProblems } from "./loanDocCertainty";
import { computeDocumentChecklist } from "../shared/documentChecklist";

export function buildCamilleAdminContext(dossier: Dossier) {
  const a = dossier.formData?.assures?.[0];
  const clientName = [a?.prenom, a?.nom].filter(Boolean).join(" ") || "Client";
  const ctx = buildCamilleContextBlock(dossier);
  const docProb = assessCertainLoanDocProblems(dossier);
  const checklist = computeDocumentChecklist(dossier.formData?.documents || []);
  const esc = dossier.camilleEscalation;
  const audit = getAiAuditTrail(dossier).slice(0, 8);

  const lastIn = [...(dossier.communications || [])]
    .filter((c: any) => c.direction === "inbound")
    .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
  const lastOut = [...(dossier.communications || [])]
    .filter((c: any) => c.direction === "outbound")
    .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

  let suggestedNextStep = "Suivi standard.";
  if (esc?.lastAt && !esc?.resolvedAt) {
    suggestedNextStep = "Escalade ouverte — consigne Telegram ou mail depuis l'admin.";
  } else if (docProb.certain) {
    suggestedNextStep = "Relancer PDF banque (offre + tableau complets).";
  } else if (!ctx.loanDocsOk) {
    suggestedNextStep = "Obtenir offre de prêt + tableau d'amortissement.";
  } else if (!dossier.studyDraft) {
    suggestedNextStep = "Préparer et envoyer l'étude personnalisée.";
  } else {
    suggestedNextStep = "Dossier avancé — répondre aux questions client si besoin.";
  }

  const staffUntil = dossier.camilleStaffHandledUntil;
  const telegramRefs = (dossier as any).camilleTelegramStaff?.messageRefs || [];

  return {
    dossierId: dossier.id,
    clientName,
    status: dossier.status,
    summary: [
      `${dossier.id} — ${clientName}`,
      `Statut : ${dossier.status}`,
      esc?.lastAt && !esc?.resolvedAt ? `Escalade : ${esc.reason || "oui"}` : "Pas d'escalade",
      ctx.loanDocsOk ? "Docs prêt : OK" : "Docs prêt : incomplets",
      docProb.certain ? "Alerte PDF / scan" : "Format docs : OK",
      staffUntil && new Date(staffUntil) > new Date()
        ? `Mode équipe actif jusqu'au ${staffUntil.slice(0, 16)}`
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
    detailBlock: buildDossierDetailBlock(dossier),
    checklist: checklist.map((c) => ({ label: c.label, ok: c.ok, key: c.key })),
    lastClientMessage: lastIn
      ? { at: lastIn.date, subject: lastIn.subject, preview: String(lastIn.text || "").slice(0, 280) }
      : null,
    lastOutbound: lastOut
      ? { at: lastOut.date, subject: lastOut.subject, from: lastOut.from }
      : null,
    suggestedNextStep,
    recentAiAudit: audit,
    telegramMessageRefs: telegramRefs.slice(-5),
    camilleStaffUntil: staffUntil || null,
  };
}
