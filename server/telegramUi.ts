import type { Dossier } from "./dossierModel";
import { computeDocumentChecklist } from "../shared/documentChecklist";
import { buildCamilleContextBlock } from "./camilleMail";
import { assessCertainLoanDocProblems } from "./loanDocCertainty";
import { hasStudyBeenSent } from "./dossierLifecycle";
import { clientHasAcceptedInsuranceChange } from "./insuranceAcceptance";
import { resolveLoanDocPresence } from "./loanDocPresence";

export function escapeTelegramHtml(s: string) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function statusBadge(status: string) {
  const s = String(status || "").toUpperCase();
  if (s === "EN_COURS") return "🟢 En cours";
  if (s === "EN_ATTENTE_CLIENT") return "🟡 Attente client";
  if (s === "NOUVEAU") return "🔵 Nouveau";
  if (s === "MAIL_ENVOYÉ" || s === "MAIL_ENVOYE") return "📨 Mail envoyé";
  if (s === "TRAITÉ" || s === "TRAITE") return "✅ Traité";
  return `📁 ${escapeTelegramHtml(s || "—")}`;
}

function suggestNextAction(d: Dossier, docProb: ReturnType<typeof assessCertainLoanDocProblems>) {
    const esc = d.camilleEscalation as any;
  const pending = d.camillePendingReview as any;
  if (pending?.status === "awaiting_staff") {
    return "Répondez à la question 🤔 de Camille pour guider la réponse client.";
  }
  if (pending?.status === "awaiting_confirm") {
    return "Validez ou annulez le brouillon proposé par Camille.";
  }
  if (esc?.lastAt && !esc?.resolvedAt) {
    return "Répondez à l'alerte 🟠 ou utilisez un bouton pour guider Camille.";
  }
  if (docProb.certain) {
    return "Demander offre de prêt + tableau d'amortissement en PDF banque en ligne.";
  }
  const missing = computeDocumentChecklist(d.formData?.documents || []).filter((c) => !c.ok);
  if (missing.some((m) => m.key === "offre" || m.key === "amort")) {
    return "Relancer offre de prêt + tableau d'amortissement.";
  }
  if (missing.some((m) => m.key === "cni" || m.key === "rib")) {
    return "CNI / RIB : uniquement après accord client pour le changement d'assurance.";
  }
  return "Dossier suivi — vous pouvez poser une question ou envoyer une consigne.";
}

/** Carte dossier lisible (HTML Telegram) */
export function formatDossierTelegramCard(d: Dossier): string {
  const a = d.formData?.assures?.[0];
  const name = escapeTelegramHtml([a?.prenom, a?.nom].filter(Boolean).join(" ") || "Client");
  const email = escapeTelegramHtml(a?.email || "—");
  const checklist = computeDocumentChecklist(d.formData?.documents || []);
  const ctx = buildCamilleContextBlock(d);
  const docProb = assessCertainLoanDocProblems(d);
  const loan = resolveLoanDocPresence(d);
  const esc = d.camilleEscalation as any;

  const missing = checklist.filter((c) => !c.ok);
  const missingLines =
    missing.length === 0
      ? "✅ Checklist complète"
      : missing.map((m) => `   • ${escapeTelegramHtml(m.label)}`).join("\n");

  const docIssue = docProb.certain
    ? "⚠️ <b>Documents prêt à refaire</b> (PDF complets depuis la banque, pas de scan)"
    : "✅ Format documents OK côté prêt";

  const loanOk = !loan.filesPresent
    ? "⏳ Offre ou tableau manquant"
    : loan.exploitable
      ? "✅ Offre + tableau exploitables"
      : "📎 Offre + tableau reçus (vérif. en cours)";
  const escLine =
    esc?.lastAt && !esc?.resolvedAt
      ? `🟠 <b>Escalade active</b> — ${escapeTelegramHtml(esc.reason || "intervention")}`
      : "✅ Pas d'escalade en cours";

  const lastIn = (d.communications || []).filter((c: any) => c.direction === "inbound").slice(-1)[0];
  const lastOut = (d.communications || []).filter((c: any) => c.direction === "outbound").slice(-1)[0];
  const lastLine = lastIn
    ? `📩 Dernier client : <i>${escapeTelegramHtml(String(lastIn.subject || "").slice(0, 60))}</i>`
    : lastOut
      ? `📤 Dernier envoi : <i>${escapeTelegramHtml(String(lastOut.subject || "").slice(0, 60))}</i>`
      : "";

  return [
    `<b>📂 ${escapeTelegramHtml(d.id)}</b>`,
    `${statusBadge(String(d.status))}`,
  ``,
    `👤 <b>${name}</b>`,
    `✉️ ${email}`,
    `📅 Créé le ${escapeTelegramHtml((d.createdAt || "").slice(0, 10))}`,
  ``,
    `<b>Documents prêt</b>`,
    loanOk,
    docIssue,
  ``,
    `<b>Checklist</b>`,
    missingLines,
  ``,
    escLine,
    lastLine,
  ``,
    `💡 <i>${escapeTelegramHtml(suggestNextAction(d, docProb))}</i>`,
  ].join("\n");
}

export function borrowerDisplayName(d: Dossier): string {
  const a = d.formData?.assures?.[0];
  return [a?.prenom, a?.nom].filter(Boolean).join(" ") || "Client";
}

/** Choix du dossier : libellé = prénom nom uniquement (pas de LCIF sur le bouton). */
export function buildDossierPickerKeyboard(dossiers: Dossier[]) {
  const rows = dossiers.slice(0, 6).map((d) => {
    const name = borrowerDisplayName(d).slice(0, 58);
    return [{ text: `👤 ${name}`, callback_data: `pick:${d.id.toUpperCase()}` }];
  });
  return { inline_keyboard: rows };
}

export function dossierCollaborationKeyboard(dossier: Dossier | string) {
  const d = typeof dossier === "string" ? null : dossier;
  const id = (d?.id || String(dossier)).toUpperCase();
  const rows: Array<Array<{ text: string; callback_data: string }>> = [
    [{ text: "📧 Mail — PDF banque", callback_data: `pdf:${id}` }],
    [
      { text: "📋 État du dossier", callback_data: `sum:${id}` },
      { text: "✅ Pris en charge", callback_data: `ok:${id}` },
    ],
  ];
  if (d && hasStudyBeenSent(d) && clientHasAcceptedInsuranceChange(d)) {
    rows[0].push({ text: "🪪 CNI + RIB", callback_data: `cni:${id}` });
  }
  if (d && hasStudyBeenSent(d)) {
    rows[0].push({ text: "📧 Relance étude", callback_data: `etude:${id}` });
  }
  return { inline_keyboard: rows };
}

export const PRESET_DIRECTIVES = {
  pdf: "Rédige un mail bienveillant : demande l'offre de prêt et le tableau d'amortissement complets en PDF depuis l'espace bancaire (pas de capture d'écran).",
  cni: "Rédige un mail : le client a accepté le changement d'assurance — demande poliment la pièce d'identité (CNI ou passeport) et le RIB pour la souscription.",
  etude:
    "Rédige un mail bienveillant pour savoir si le client a bien reçu l'étude des économies par email et s'il a des questions. Ne demande PAS CNI ni RIB : le client n'a pas encore confirmé vouloir activer le changement d'assurance.",
} as const;

export function reviewConfirmKeyboard(dossierId: string) {
  const id = dossierId.toUpperCase();
  return {
    inline_keyboard: [
      [
        { text: "📤 Envoyer au client", callback_data: `rvsend:${id}` },
        { text: "❌ Annuler", callback_data: `rvno:${id}` },
      ],
    ],
  };
}

export function parseCallbackData(data: string): { action: string; dossierId: string } | null {
  const m = String(data || "").match(/^(pick|pdf|cni|etude|sum|ok|info|rvsend|rvno):(LCIF-\d{6})$/i);
  if (!m) return null;
  return { action: m[1].toLowerCase(), dossierId: m[2].toUpperCase() };
}
