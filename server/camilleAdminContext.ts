import type { Dossier } from "./dossierModel";
import { buildDossierDetailBlock } from "./camilleTelegramChat";
import { buildCamilleContextBlock } from "./camilleMail";
import { getAiAuditTrail } from "./aiAuditLog";
import { resolveLoanDocPresence } from "./loanDocPresence";
import { computeDocumentChecklist } from "../shared/documentChecklist";
import {
  hasStudyBeenSent,
  getLastStudyOutbound,
  resolveClientPortalStatusKey,
  needsStatusStudySent,
} from "./dossierLifecycle";

export function buildCamilleAdminContext(dossier: Dossier) {
  const a = dossier.formData?.assures?.[0];
  const clientName = [a?.prenom, a?.nom].filter(Boolean).join(" ") || "Client";
  const ctx = buildCamilleContextBlock(dossier);
  const loan = resolveLoanDocPresence(dossier);
  const checklist = computeDocumentChecklist(dossier.formData?.documents || []);
  const esc = dossier.camilleEscalation;
  const audit = getAiAuditTrail(dossier).slice(0, 8);

  const lastIn = [...(dossier.communications || [])]
    .filter((c: any) => c.direction === "inbound")
    .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
  const lastOut = [...(dossier.communications || [])]
    .filter((c: any) => c.direction === "outbound")
    .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

  const studySent = hasStudyBeenSent(dossier);
  const portalKey = resolveClientPortalStatusKey(dossier);

  let suggestedNextStep = "Suivi standard.";
  if (esc?.lastAt && !esc?.resolvedAt) {
    suggestedNextStep = "Escalade ouverte — consigne Telegram ou mail depuis l'admin.";
  } else if (needsStatusStudySent(dossier)) {
    suggestedNextStep = "Étude déjà envoyée (visible dans les échanges) : passer le statut en MAIL ENVOYÉ pour le portail client.";
  } else if (loan.needsResubmit) {
    suggestedNextStep =
      "Demander offre de prêt + tableau d'amortissement en PDF complets depuis l'espace banque (pas de scan/capture).";
  } else if (!loan.filesPresent && !studySent) {
    suggestedNextStep = "Obtenir offre de prêt + tableau d'amortissement.";
  } else if (!studySent) {
    suggestedNextStep = "Préparer et envoyer l'étude personnalisée par email.";
  } else {
    suggestedNextStep = "Étude envoyée — répondre au client si nouveau mail.";
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
      !loan.filesPresent
        ? "Docs prêt : manquants"
        : loan.exploitable
          ? "Docs prêt : OK"
          : "Docs prêt : reçus (vérif. ou format)",
      loan.needsResubmit ? "Docs prêt : scan/photo à refaire" : "Format docs : OK",
      studySent ? `Étude envoyée (portail client : ${portalKey})` : "Étude : pas encore envoyée",
      dossier.studyKpi
        ? `KPI mail étude : ${dossier.studyKpi.grossSavingsEur} € économie brute · ${dossier.studyKpi.feesCourtageEur} € courtage · prêt ${dossier.studyKpi.loanCapitalEur} €`
        : null,
      getLastStudyOutbound(dossier)
        ? `Dernier mail étude : ${getLastStudyOutbound(dossier)!.subject.slice(0, 70)}`
        : null,
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
