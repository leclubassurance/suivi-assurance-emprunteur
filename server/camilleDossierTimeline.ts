import type { Dossier } from "./dossierModel";
import { getLastStudyOutbound, hasStudyBeenSent } from "./dossierLifecycle";
import { clientHasAcceptedInsuranceChange } from "./insuranceAcceptance";
import { isLoanDocsStepComplete } from "./loanDocPresence";
import {
  resolveEffectiveSubscriptionPhase,
  SUBSCRIPTION_PHASE_OPTIONS,
  type SubscriptionPhase,
} from "./subscriptionProgress";

export function formatStudyKpiForAi(dossier: Dossier): string | null {
  const kpi = dossier.studyKpi;
  if (!kpi) return null;
  const parts: string[] = [];
  if (Number(kpi.grossSavingsEur) > 0) {
    parts.push(`économie brute estimée ~${Math.round(kpi.grossSavingsEur)} €`);
  }
  if (kpi.feesCourtageEur != null) {
    parts.push(`frais courtage ~${Math.round(kpi.feesCourtageEur)} €`);
  }
  if (kpi.feesAssureurEur != null) {
    parts.push(`frais assureur ~${Math.round(kpi.feesAssureurEur)} €`);
  }
  if (Number(kpi.loanCapitalEur) > 0) {
    parts.push(`capital prêt ~${Math.round(kpi.loanCapitalEur)} €`);
  }
  if (kpi.confidence) parts.push(`confiance extraction : ${kpi.confidence}`);
  return parts.length ? parts.join(" ; ") : null;
}

export function getSubscriptionPhaseLabel(phase: SubscriptionPhase | null): string {
  if (!phase) return "Avant étude — pas de souscription";
  const opt = SUBSCRIPTION_PHASE_OPTIONS.find((o) => o.value === phase);
  return opt?.label || phase;
}

/** Consignes Camille selon la phase post-étude (substitution / espace adhésion). */
export function buildSubscriptionGuidanceForPhase(
  phase: SubscriptionPhase | null,
  studySent: boolean,
): string {
  if (!studySent) {
    return "Phase initiale : accompagner sur offre + tableau ; ne pas évoquer l'espace d'adhésion ni Kereis.";
  }
  switch (phase) {
    case "awaiting_decision":
      return "En attente de décision : l'étude est partie — vérifier réception, répondre aux questions, proposer la substitution si le client est satisfait ; PAS de CNI/RIB sans accord explicite.";
    case "decision_received":
      return "Accord client reçu : confirmer la prise en compte ; Charles finalise côté assureur ; l'espace d'adhésion (questionnaire santé, signatures) sera transmis par email ; demander CNI/RIB uniquement s'ils manquent encore.";
    case "adhesion_space_sent":
      return "Espace adhésion envoyé : guider le client sur la connexion à l'espace sécurisé (CGU, questionnaire de santé, lecture et signature des documents, justificatifs) ; ne pas redemander l'étude ni les docs de prêt déjà validés.";
    case "completed":
      return "Souscription terminée en ligne : remercier ; questions résiduelles → Charles si besoin ; ne pas relancer sur les étapes déjà faites.";
    default:
      return "Étude envoyée — suivre la décision du client avant toute demande de pièces souscription.";
  }
}

function sortedComms(dossier: Dossier) {
  return [...(dossier.communications || [])].sort(
    (a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime(),
  );
}

/** Chronologie lisible pour Gemini (antériorités du dossier). */
export function buildDossierTimelineForAi(dossier: Dossier): string {
  const lines: string[] = [];
  const created = dossier.createdAt?.slice(0, 16) || "?";
  lines.push(`[${created}] Dossier ouvert — ${dossier.id} (statut : ${dossier.status || "NOUVEAU"})`);

  if (isLoanDocsStepComplete(dossier)) {
    lines.push(`[—] Offre de prêt + tableau d'amortissement : reçus et exploitables pour l'étude`);
  } else {
    lines.push(`[—] Documents de prêt : incomplets ou à préciser (voir checklist)`);
  }

  const study = getLastStudyOutbound(dossier);
  if (study?.date) {
    lines.push(
      `[${study.date.slice(0, 16)}] Étude des économies envoyée au client — sujet : « ${String(study.subject).slice(0, 70)} »`,
    );
  } else if (hasStudyBeenSent(dossier)) {
    lines.push(`[—] Étude des économies : envoyée (date exacte non retrouvée dans le fil)`);
  }

  if (clientHasAcceptedInsuranceChange(dossier)) {
    lines.push(`[—] Accord client pour la substitution / changement d'assurance : OUI (détecté dans le fil)`);
  }

  const subPhase = resolveEffectiveSubscriptionPhase(dossier);
  if (subPhase) {
    const sub = dossier.subscriptionProgress;
    const when = sub?.updatedAt?.slice(0, 16) || "—";
    const note = sub?.note ? ` — ${sub.note.slice(0, 120)}` : "";
    lines.push(`[${when}] Phase souscription : ${getSubscriptionPhaseLabel(subPhase)}${note}`);
  }

  const comms = sortedComms(dossier);
  const lastIn = [...comms].reverse().find((c) => c.direction === "inbound");
  const lastOut = [...comms].reverse().find((c) => c.direction === "outbound");
  if (lastIn?.date) {
    lines.push(
      `[${String(lastIn.date).slice(0, 16)}] Dernier message CLIENT : « ${String(lastIn.subject || "").slice(0, 50)} »`,
    );
  }
  if (lastOut?.date) {
    lines.push(
      `[${String(lastOut.date).slice(0, 16)}] Dernier message ÉQUIPE : « ${String(lastOut.subject || "").slice(0, 50)} »`,
    );
  }

  const prets = dossier.formData?.prets || [];
  if (prets.length > 0) {
    const pret = prets[0];
    const bank = pret?.banquePreteuse || pret?.organismePreteur || "";
    const crd = pret?.capitalRestant;
    const extra = [bank && `banque : ${bank}`, crd && `CRD ~${crd} €`].filter(Boolean).join(", ");
    if (extra) lines.push(`[—] Prêt principal : ${extra}`);
  }

  return lines.join("\n");
}

/** Bloc « situation dossier » injecté dans les prompts Camille. */
export function buildCamilleDossierSituationBlock(dossier: Dossier): string {
  const studySent = hasStudyBeenSent(dossier);
  const subPhase = resolveEffectiveSubscriptionPhase(dossier);
  const kpi = formatStudyKpiForAi(dossier);
  const study = getLastStudyOutbound(dossier);

  return [
    "SITUATION DOSSIER (source de vérité — tenir compte de l'historique, pas seulement du dernier mail) :",
    `Statut dossier : ${dossier.status || "NOUVEAU"}`,
    `Étude envoyée (studySent) : ${studySent ? "OUI" : "NON"}`,
    study?.date
      ? `Dernière étude : ${study.date.slice(0, 16)} — « ${study.subject.slice(0, 80)} »`
      : "Dernière étude : —",
    kpi ? `KPI étude (ne pas reciter au client mot pour mot — orienter vers l'email d'étude ou Charles si chiffrage précis) : ${kpi}` : "KPI étude : non extrait",
    `Accord client substitution (clientAcceptedInsurance) : ${clientHasAcceptedInsuranceChange(dossier) ? "OUI" : "NON"}`,
    `Phase souscription : ${getSubscriptionPhaseLabel(subPhase)}`,
    `Conduite selon la phase : ${buildSubscriptionGuidanceForPhase(subPhase, studySent)}`,
    "",
    "CHRONOLOGIE :",
    buildDossierTimelineForAi(dossier),
  ].join("\n");
}
