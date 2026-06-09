export enum Step {
  LANDING = 'LANDING',
  PREPARATION = 'PREPARATION',
  PROJET = 'PROJET',
  COORDONNEES = 'COORDONNEES',
  INFO_PERSO = 'INFO_PERSO',
  DOCUMENTS = 'DOCUMENTS',
  SUCCESS = 'SUCCESS',
  ADMIN_LOGIN = 'ADMIN_LOGIN',
  ADMIN_DASHBOARD = 'ADMIN_DASHBOARD',
  CONSEILLER_DASHBOARD = 'CONSEILLER_DASHBOARD',
  CLIENT_PORTAL = 'CLIENT_PORTAL',
}

export interface UserInfo {
  uid: string;
  email: string;
  role: 'ADMIN' | 'CONSEILLER';
}

export interface InsuranceFormData {
  objetFinancement: string;
  assures: any[];
  prets: any[];
  documents: AppFile[];
}

export interface FormErrors {
  [key: string]: string;
}

export interface AppFile {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
  status: string;
  base64Content?: string;
  storageUrl?: string;
}

export type DossierStatus =
  | "PROSPECT"
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
  createdAt: any;
  updatedAt: any;
  status: DossierStatus | string;
  formData: InsuranceFormData;
  communications?: any[];
  eventLog?: DossierEvent[];
  tasks?: ReminderTask[];
  emails?: EmailMessage[];
  notes?: { id: string; at: string; author: string; text: string }[];
  extractedData?: {
    loading: boolean;
    observations: string;
  };
}
