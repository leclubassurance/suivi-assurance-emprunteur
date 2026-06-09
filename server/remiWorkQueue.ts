import type { Dossier } from "./dossierModel";
import { computeDocumentChecklist } from "../shared/documentChecklist";
import { resolveLoanDocPresence } from "./loanDocPresence";
import { isDossierStale } from "./rules";
import {
  hasStudyBeenSent,
  needsStatusStudySent,
  getLastStudyOutbound,
  getLastClientInbound,
  getLastOutbound,
} from "./dossierLifecycle";

export type WorkQueuePriority = "critical" | "high" | "medium" | "low";

export type WorkQueueKind =
  | "escalation"
  | "new_dossier"
  | "missing_loan_docs"
  | "doc_quality"
  | "status_sync"
  | "client_waiting"
  | "client_replied"
  | "study_pending"
  | "drive_failed";

export interface WorkQueueItem {
  dossierId: string;
  clientName: string;
  clientEmail: string;
  kind: WorkQueueKind;
  priority: WorkQueuePriority;
  title: string;
  detail: string;
  /** Action concrète pour Rémi */
  action: string;
  updatedAt: string;
  snoozedUntil?: string;
  dismissedAt?: string;
}

function borrower(d: Dossier) {
  const a = d.formData?.assures?.[0];
  return {
    name: [a?.prenom, a?.nom].filter(Boolean).join(" ") || "Client",
    email: a?.email || "",
  };
}

function isSnoozed(d: Dossier) {
  const until = d.remiQueue?.snoozedUntil;
  return until && new Date(until).getTime() > Date.now();
}

function isDismissed(d: Dossier, kind?: WorkQueueKind) {
  if (kind && (d.remiQueue?.dismissedKinds || []).includes(kind)) return true;
  return Boolean(d.remiQueue?.dismissedAt);
}

function shouldShowQueueItem(d: Dossier, kind: WorkQueueKind) {
  if (isDismissed(d)) return false;
  if (isDismissed(d, kind)) return false;
  return true;
}

function push(items: WorkQueueItem[], item: WorkQueueItem, d: Dossier) {
  if (!shouldShowQueueItem(d, item.kind)) return;
  items.push(item);
}

export function buildRemiWorkQueue(dossiers: Dossier[]): WorkQueueItem[] {
  const items: WorkQueueItem[] = [];

  for (const d of dossiers) {
    if (isSnoozed(d)) continue;
    if ((d as any).isLead) continue;

    const { name, email } = borrower(d);
    const esc = d.camilleEscalation;
    const checklist = computeDocumentChecklist(d.formData?.documents || []);
    const studySent = hasStudyBeenSent(d);
    const lastStudy = getLastStudyOutbound(d);
    const lastIn = getLastClientInbound(d);
    const lastOut = getLastOutbound(d);

    if (esc?.lastAt && !esc?.resolvedAt) {
      push(items, {
        dossierId: d.id,
        clientName: name,
        clientEmail: email,
        kind: "escalation",
        priority: "critical",
        title: "Escalade — décision requise",
        detail: esc.reason || "Camille attend votre consigne",
        action:
          "Répondre sur Telegram à l'alerte (ex. consigne pour le client) ou traiter le mail client depuis l'onglet Échanges.",
        updatedAt: esc.lastAt,
      }, d);
      continue;
    }

    if (needsStatusStudySent(d)) {
      push(items, {
        dossierId: d.id,
        clientName: name,
        clientEmail: email,
        kind: "status_sync",
        priority: "medium",
        title: "Étude déjà envoyée — aligner le statut",
        detail: lastStudy
          ? `Mail envoyé : « ${lastStudy.subject.slice(0, 70)} »`
          : "L'historique Gmail montre une étude envoyée",
        action:
          "Dans l'admin : passer le statut en « MAIL ENVOYÉ » pour que le portail client affiche « Étude envoyée ».",
        updatedAt: lastStudy?.date || d.updatedAt,
      }, d);
    }

    if (d.status === "NOUVEAU" && !studySent) {
      push(items, {
        dossierId: d.id,
        clientName: name,
        clientEmail: email,
        kind: "new_dossier",
        priority: "high",
        title: "Nouveau dossier à ouvrir",
        detail: `Reçu le ${(d.createdAt || "").slice(0, 10)}`,
        action:
          "Vérifier les pièces, lancer l'export Drive si besoin, puis traiter ou confier la relance documents à Camille.",
        updatedAt: d.createdAt,
      }, d);
    }

    const loanPresence = resolveLoanDocPresence(d);

    if (!studySent && !loanPresence.filesPresent) {
      const missing = checklist
        .filter((c) => (c.key === "offre" || c.key === "amort") && !c.ok)
        .map((c) => c.label);
      push(items, {
        dossierId: d.id,
        clientName: name,
        clientEmail: email,
        kind: "missing_loan_docs",
        priority: "high",
        title: "Documents de prêt manquants",
        detail: missing.length ? missing.join(" · ") : "Offre et/ou tableau d'amortissement",
        action:
          "Relancer le client (Camille ou mail manuel) pour l'offre de prêt + tableau d'amortissement en PDF depuis l'espace banque.",
        updatedAt: d.updatedAt,
      }, d);
    } else if (!studySent && loanPresence.needsResubmit) {
      push(items, {
        dossierId: d.id,
        clientName: name,
        clientEmail: email,
        kind: "doc_quality",
        priority: "high",
        title: "Documents de prêt non exploitables (scan / photo)",
        detail:
          "Fichiers reçus mais illisibles pour l'analyse — il faut des PDF complets depuis la banque en ligne.",
        action:
          "Demandez à Camille sur Telegram : « Envoie un mail pour préciser les PDF banque » — elle le fait automatiquement (sans CNI/RIB avant l'étude).",
        updatedAt: d.updatedAt,
      }, d);
    }

    if (lastIn && studySent) {
      const inDate = new Date(lastIn.date || 0).getTime();
      const studyDate = new Date(lastStudy?.date || 0).getTime();
      if (inDate > studyDate) {
        push(items, {
          dossierId: d.id,
          clientName: name,
          clientEmail: email,
          kind: "client_replied",
          priority: "high",
          title: "Le client a répondu après l'étude",
          detail: String(lastIn.subject || lastIn.text || "").slice(0, 120),
          action:
            "Lire le mail dans Échanges, répondre ou laisser Camille répondre ; mettre à jour le statut si le dossier est clos.",
          updatedAt: String(lastIn.date || d.updatedAt),
        }, d);
      }
    }

    if (
      !studySent &&
      loanPresence.exploitable &&
      (d.status === "EN_COURS" || d.status === "NOUVEAU")
    ) {
      push(items, {
        dossierId: d.id,
        clientName: name,
        clientEmail: email,
        kind: "study_pending",
        priority: "medium",
        title: "Préparer et envoyer l'étude",
        detail: "Offre + tableau OK — étude pas encore envoyée au client",
        action:
          "Calculer les économies si besoin, générer le mail d'étude (onglet Envoi mail) et envoyer au client.",
        updatedAt: d.updatedAt,
      }, d);
    }

    if (
      !studySent &&
      d.status === "EN_ATTENTE_CLIENT" &&
      isDossierStale(d, 5) &&
      (!lastIn || new Date(lastIn.date || 0) < new Date(Date.now() - 5 * 86400000))
    ) {
      push(items, {
        dossierId: d.id,
        clientName: name,
        clientEmail: email,
        kind: "client_waiting",
        priority: "medium",
        title: "Sans nouvelles du client",
        detail: "Statut attente client · aucune activité depuis 5+ jours",
        action:
          "Relance manuelle ou vérifier si Camille doit envoyer un rappel (éviter doublon si mail récent).",
        updatedAt: d.updatedAt,
      }, d);
    }

    if (d.workspaceStatus === "FAILED") {
      push(items, {
        dossierId: d.id,
        clientName: name,
        clientEmail: email,
        kind: "drive_failed",
        priority: "low",
        title: "Export Google Drive en échec",
        detail: d.workspaceError || "Erreur technique",
        action: "Onglet Suivi → Vérifier Drive ou relancer l'export dossier.",
        updatedAt: d.updatedAt,
      }, d);
    }

    void lastOut;
  }

  const rank: Record<WorkQueuePriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  items.sort(
    (a, b) =>
      rank[a.priority] - rank[b.priority] ||
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  return items;
}
