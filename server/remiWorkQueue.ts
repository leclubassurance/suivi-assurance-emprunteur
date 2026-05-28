import type { Dossier } from "./dossierModel";
import { computeDocumentChecklist } from "../shared/documentChecklist";
import { assessCertainLoanDocProblems } from "./loanDocCertainty";
import { buildCamilleContextBlock } from "./camilleMail";
import { isDossierStale } from "./rules";

export type WorkQueuePriority = "critical" | "high" | "medium" | "low";

export type WorkQueueKind =
  | "escalation"
  | "new_dossier"
  | "missing_loan_docs"
  | "doc_quality"
  | "client_waiting"
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
  const until = (d as any).remiQueue?.snoozedUntil;
  return until && new Date(until).getTime() > Date.now();
}

function isDismissed(d: Dossier) {
  return Boolean((d as any).remiQueue?.dismissedAt);
}

export function buildRemiWorkQueue(dossiers: Dossier[]): WorkQueueItem[] {
  const items: WorkQueueItem[] = [];

  for (const d of dossiers) {
    if (isDismissed(d) || isSnoozed(d)) continue;

    const { name, email } = borrower(d);
    const esc = d.camilleEscalation;
    const checklist = computeDocumentChecklist(d.formData?.documents || []);
    const ctx = buildCamilleContextBlock(d);
    const docProb = assessCertainLoanDocProblems(d);

    if (esc?.lastAt && !esc?.resolvedAt) {
      items.push({
        dossierId: d.id,
        clientName: name,
        clientEmail: email,
        kind: "escalation",
        priority: "critical",
        title: "Escalade Camille",
        detail: esc.reason || "Intervention requise",
        updatedAt: esc.lastAt,
      });
      continue;
    }

    if (d.status === "NOUVEAU") {
      items.push({
        dossierId: d.id,
        clientName: name,
        clientEmail: email,
        kind: "new_dossier",
        priority: "high",
        title: "Nouveau dossier",
        detail: "À prendre en charge",
        updatedAt: d.createdAt,
      });
    }

    if (!ctx.loanDocsOk) {
      items.push({
        dossierId: d.id,
        clientName: name,
        clientEmail: email,
        kind: "missing_loan_docs",
        priority: "high",
        title: "Offre ou tableau manquant",
        detail: checklist
          .filter((c) => (c.key === "offre" || c.key === "amort") && !c.ok)
          .map((c) => c.label)
          .join(", ") || "Documents prêt incomplets",
        updatedAt: d.updatedAt,
      });
    } else if (docProb.certain) {
      items.push({
        dossierId: d.id,
        clientName: name,
        clientEmail: email,
        kind: "doc_quality",
        priority: "high",
        title: "PDF banque à refaire",
        detail: docProb.problems.map((p) => p.kind).join(", "),
        updatedAt: d.updatedAt,
      });
    }

    if (d.status === "EN_ATTENTE_CLIENT" && isDossierStale(d, 5)) {
      items.push({
        dossierId: d.id,
        clientName: name,
        clientEmail: email,
        kind: "client_waiting",
        priority: "medium",
        title: "Attente client",
        detail: "Sans activité depuis 5+ jours",
        updatedAt: d.updatedAt,
      });
    }

    if (ctx.loanDocsOk && !d.studyDraft && (d.status === "EN_COURS" || d.status === "NOUVEAU")) {
      items.push({
        dossierId: d.id,
        clientName: name,
        clientEmail: email,
        kind: "study_pending",
        priority: "medium",
        title: "Étude à préparer / envoyer",
        detail: "Docs prêt OK — pas d'étude enregistrée",
        updatedAt: d.updatedAt,
      });
    }

    if (d.workspaceStatus === "FAILED") {
      items.push({
        dossierId: d.id,
        clientName: name,
        clientEmail: email,
        kind: "drive_failed",
        priority: "low",
        title: "Export Drive en échec",
        detail: d.workspaceError || "Erreur workspace",
        updatedAt: d.updatedAt,
      });
    }
  }

  const rank: Record<WorkQueuePriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  items.sort(
    (a, b) =>
      rank[a.priority] - rank[b.priority] ||
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  return items;
}
