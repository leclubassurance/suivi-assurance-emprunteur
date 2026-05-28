import { sanitizeLegacyDriveWorkspaceState } from "./driveConfig";
import { inferDocumentCategory } from "../shared/documentClassifier";

export type DossierStatus =
  | "NOUVEAU"
  | "EN_COURS"
  | "EN_ATTENTE_CLIENT"
  | "MAIL_ENVOYÉ"
  | "TRAITÉ"
  | "REFUSÉ"
  | "CLOS";

export type DossierEventType =
  | "DOSSIER_CREATED"
  | "STATUS_CHANGED"
  | "NOTE_ADDED"
  | "DOCUMENT_UPLOADED"
  | "EMAIL_SENT"
  | "EMAIL_FAILED"
  | "REMINDER_SCHEDULED"
  | "REMINDER_SENT"
  | "AI_DECISION";

export interface DossierEvent {
  id: string;
  type: DossierEventType;
  at: string;
  actor?: { kind: "SYSTEM" | "ADMIN" | "AI"; label?: string };
  message?: string;
  meta?: Record<string, any>;
}

export type ReminderTaskType =
  | "FOLLOWUP_MISSING_DOCS"
  | "FOLLOWUP_NO_REPLY"
  | "INTERNAL_ALERT";

export interface ReminderTask {
  id: string;
  type: ReminderTaskType;
  dueAt: string;
  status: "PENDING" | "DONE" | "CANCELLED";
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
  payload?: Record<string, any>;
  createdAt: string;
}

export interface EmailMessage {
  id: string;
  template: string;
  to: string;
  subject: string;
  html: string;
  createdAt: string;
  sentAt?: string;
  status: "QUEUED" | "SENT" | "FAILED";
  providerId?: string;
  error?: string;
}

export interface Dossier {
  id: string;
  status: DossierStatus | string;
  createdAt: string;
  updatedAt: string;
  formData: any;
  communications?: any[];
  extractedData?: any;
  workspaceStatus?: string;
  workspaceWarning?: string;
  workspaceError?: string;
  workspaceFolderId?: string;
  workspaceSheetId?: string;
  eventLog?: DossierEvent[];
  tasks?: ReminderTask[];
  emails?: EmailMessage[];
  notes?: { id: string; at: string; author: string; text: string }[];
  processedGmailIds?: string[];
  camilleEscalation?: {
    lastAt: string;
    lastGmailId?: string;
    reason?: string;
    remiNotifiedAt?: string;
    clientNotifiedAt?: string;
    followUpScheduledAt?: string;
    resolvedAt?: string;
    resolvedBy?: string;
  };
  /** Camille en mode soutien (ne pas contredire l'équipe) jusqu'à cette date ISO */
  camilleStaffHandledUntil?: string;
  studyDraft?: {
    kind: string;
    computedAt: string;
    reliability: string;
    reasons?: string[];
    extracted?: any;
    subject?: string | null;
    html?: string | null;
  };
}

export function newId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function ensureDossierShape(d: any): Dossier {
  const now = new Date().toISOString();
  const dossier: Dossier = {
    id: String(d.id),
    status: (d.status || "NOUVEAU") as any,
    createdAt: d.createdAt || now,
    updatedAt: d.updatedAt || now,
    formData: d.formData || d,
    communications: Array.isArray(d.communications) ? d.communications : [],
    extractedData: d.extractedData,
    workspaceStatus: d.workspaceStatus,
    workspaceWarning: d.workspaceWarning,
    workspaceError: d.workspaceError,
    workspaceFolderId: d.workspaceFolderId,
    workspaceSheetId: d.workspaceSheetId,
    eventLog: Array.isArray(d.eventLog) ? d.eventLog : [],
    tasks: Array.isArray(d.tasks) ? d.tasks : [],
    emails: Array.isArray(d.emails) ? d.emails : [],
    notes: Array.isArray(d.notes) ? d.notes : [],
    processedGmailIds: Array.isArray(d.processedGmailIds) ? d.processedGmailIds : [],
    camilleEscalation: d.camilleEscalation,
    camilleStaffHandledUntil: d.camilleStaffHandledUntil,
  };
  const shaped = sanitizeLegacyDriveWorkspaceState(
    dossier as unknown as Record<string, unknown>,
  ) as unknown as Dossier;
  if (Array.isArray(shaped.formData?.documents)) {
    shaped.formData.documents = shaped.formData.documents.map((doc: any) => {
      const category = inferDocumentCategory(doc);
      return category ? { ...doc, category } : doc;
    });
  }
  return shaped;
}

export function addEvent(dossier: Dossier, event: Omit<DossierEvent, "id" | "at"> & { id?: string; at?: string }) {
  const at = event.at || new Date().toISOString();
  const id = event.id || newId("evt");
  if (!dossier.eventLog) dossier.eventLog = [];
  dossier.eventLog.push({ id, at, type: event.type, actor: event.actor, message: event.message, meta: event.meta });
  dossier.updatedAt = new Date().toISOString();
}

export function scheduleTask(dossier: Dossier, task: Omit<ReminderTask, "id" | "createdAt" | "attempts" | "status"> & { id?: string; createdAt?: string }) {
  const createdAt = task.createdAt || new Date().toISOString();
  const id = task.id || newId("task");
  const newTask: ReminderTask = {
    id,
    type: task.type,
    dueAt: task.dueAt,
    status: "PENDING",
    attempts: 0,
    payload: task.payload || {},
    createdAt,
  };
  if (!dossier.tasks) dossier.tasks = [];
  dossier.tasks.push(newTask);
  addEvent(dossier, { type: "REMINDER_SCHEDULED", actor: { kind: "SYSTEM" }, meta: { task: newTask } });
  return newTask;
}

