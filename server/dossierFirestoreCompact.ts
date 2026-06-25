/** Réduit la taille d'un dossier avant écriture Firestore (limite ~1 Mo / document). */

import { normalizeDocumentForPersistence } from "./documentStoragePolicy";

const MAX_COMM_TEXT = 3500;
/** Études HTML (~8 ko) : tronquer trop tôt casse l'extraction KPI (bloc 36px + frais). */
const MAX_COMM_HTML = 12_000;
const MAX_COMMS = 35;
const MAX_EVENTS = 60;
const MAX_GMAIL_IDS = 250;
const MAX_IMPORTED_ATTACHMENT_KEYS = 800;
const MAX_IMPORTED_GMAIL_MESSAGES = 400;
const MAX_AUDIT = 25;
const TARGET_BYTES = 880_000;
/** Limite Firestore par document (1 MiB). */
const FIRESTORE_DOC_MAX_BYTES = 1_048_576;
const FIRESTORE_SAFE_TARGET = 960_000;

const STUDY_COMM_SUBJECT_RE =
  /\b(étude|etude)(\s+personnalisée|\s+personnalisee)?\b|économies|economies|économiser|economiser|assurance emprunteur/i;

function isStudyOutboundComm(c: any): boolean {
  if (c?.direction !== "outbound") return false;
  return STUDY_COMM_SUBJECT_RE.test(String(c?.subject || ""));
}

const lastOversizeWarnAt = new Map<string, number>();
const OVERSIZE_WARN_COOLDOWN_MS = 15 * 60_000;

function truncate(s: unknown, max: number): string | undefined {
  if (s == null) return undefined;
  const t = String(s);
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/** Firestore rejette les valeurs `undefined` (contrairement à JSON.stringify seul). */
export function stripUndefinedForFirestore<T>(value: T): T {
  if (value === undefined) return value;
  if (value === null) return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefinedForFirestore(item))
      .filter((item) => item !== undefined) as T;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val === undefined) continue;
      out[key] = stripUndefinedForFirestore(val);
    }
    return out as T;
  }
  return value;
}

function stripDocForStorage(doc: any) {
  if (!doc || typeof doc !== "object") return normalizeDocumentForPersistence(doc);
  const { localPath, base64, data, content, rawText, extractedText, ...rest } = doc;
  if (rest.loanSignal && typeof rest.loanSignal === "object") {
    const sig = { ...rest.loanSignal };
    delete sig.rawExcerpt;
    rest.loanSignal = sig;
  }
  return rest;
}

function dossierJsonBytes(d: Record<string, unknown>): number {
  return JSON.stringify(d).length;
}

function warnOversizeOnce(dossierId: string, bytes: number, detail: string) {
  const now = Date.now();
  const last = lastOversizeWarnAt.get(dossierId) || 0;
  if (now - last < OVERSIZE_WARN_COOLDOWN_MS) return;
  lastOversizeWarnAt.set(dossierId, now);
  console.warn(`[Firebase] Dossier ${dossierId} encore volumineux (${bytes} octets) — ${detail}.`);
}

/** Passe agressive : registres Gmail, mails, brouillons — pour passer sous 1 Mo Firestore. */
function aggressivelyShrinkForFirestore(d: Record<string, unknown>, pass: number) {
  const slice = (key: string, keep: number) => {
    if (!Array.isArray(d[key])) return;
    d[key] = (d[key] as unknown[]).slice(-keep);
  };

  if (pass === 0) {
    slice("importedGmailAttachmentKeys", 300);
    slice("importedGmailMessageIds", 120);
    slice("processedGmailIds", 60);
    if (Array.isArray(d.aiAuditTrail)) d.aiAuditTrail = (d.aiAuditTrail as any[]).slice(-8);
    if (Array.isArray(d.eventLog)) d.eventLog = (d.eventLog as any[]).slice(-15);
    if (Array.isArray(d.emails)) {
      d.emails = (d.emails as any[]).slice(-12).map((e) => ({
        ...e,
        html: truncate(e.html, 1500),
      }));
    }
    const studyDraft = d.studyDraft as Record<string, unknown> | undefined;
    if (studyDraft?.html) studyDraft.html = truncate(studyDraft.html, 2000);
    return;
  }

  if (pass === 1) {
    slice("importedGmailAttachmentKeys", 80);
    slice("importedGmailMessageIds", 40);
    slice("processedGmailIds", 30);
    if (Array.isArray(d.communications)) {
      d.communications = (d.communications as any[]).slice(-4).map((c) => {
        const row: Record<string, unknown> = {
          id: c.id,
          gmailId: c.gmailId,
          direction: c.direction,
          from: c.from,
          subject: truncate(c.subject, 120),
          text: truncate(c.text, 400),
          date: c.date,
        };
        if (isStudyOutboundComm(c) && c.html) {
          row.html = truncate(c.html, MAX_COMM_HTML);
        }
        return row;
      });
    }
    if (Array.isArray(d.eventLog)) d.eventLog = (d.eventLog as any[]).slice(-8);
    if (Array.isArray(d.emails)) d.emails = (d.emails as any[]).slice(-5);
    return;
  }

  slice("importedGmailAttachmentKeys", 20);
  slice("importedGmailMessageIds", 10);
  delete d.importedGmailAttachmentKeys;
  delete d.importedGmailMessageIds;
  delete d.aiAuditTrail;
  delete d.extractedData;
  if (Array.isArray(d.communications)) d.communications = (d.communications as any[]).slice(-2);
  if (Array.isArray(d.eventLog)) d.eventLog = (d.eventLog as any[]).slice(-5);
  const pending = d.camillePendingReview as Record<string, unknown> | undefined;
  if (pending) {
    pending.fullClientMessage = truncate(pending.fullClientMessage, 500);
    pending.proposedClientHtml = truncate(pending.proposedClientHtml, 500);
    pending.proposedClientPlain = truncate(pending.proposedClientPlain, 500);
  }
}

function enforceFirestoreSizeLimit(d: Record<string, unknown>): number {
  let bytes = dossierJsonBytes(d);
  if (bytes <= FIRESTORE_SAFE_TARGET) return bytes;

  for (let pass = 0; pass < 3 && bytes > FIRESTORE_SAFE_TARGET; pass++) {
    const before = bytes;
    aggressivelyShrinkForFirestore(d, pass);
    bytes = dossierJsonBytes(d);
    if (bytes >= before) break;
  }

  if (bytes > FIRESTORE_DOC_MAX_BYTES) {
    warnOversizeOnce(
      String(d.id || "?"),
      bytes,
      "compactage d'urgence insuffisant — écriture Firestore risquée",
    );
  }

  return bytes;
}

export function compactDossierForPersistence(dossier: unknown): Record<string, unknown> {
  const d = JSON.parse(JSON.stringify(dossier)) as Record<string, unknown>;

  if (Array.isArray(d.communications)) {
    d.communications = (d.communications as any[])
      .slice(-MAX_COMMS)
      .map((c) => {
        const row: Record<string, unknown> = {
          ...c,
          text: truncate(c.text, MAX_COMM_TEXT),
        };
        if (c.html) row.html = truncate(c.html, MAX_COMM_HTML);
        return row;
      });
  }

  if (Array.isArray(d.eventLog)) {
    d.eventLog = (d.eventLog as any[]).slice(-MAX_EVENTS);
  }

  if (Array.isArray(d.processedGmailIds)) {
    d.processedGmailIds = (d.processedGmailIds as string[]).slice(-MAX_GMAIL_IDS);
  }

  if (Array.isArray(d.acknowledgedStaffOutboundGmailIds)) {
    d.acknowledgedStaffOutboundGmailIds = (d.acknowledgedStaffOutboundGmailIds as string[]).slice(
      -MAX_GMAIL_IDS,
    );
  }

  if (Array.isArray(d.importedGmailAttachmentKeys)) {
    d.importedGmailAttachmentKeys = (d.importedGmailAttachmentKeys as string[]).slice(
      -MAX_IMPORTED_ATTACHMENT_KEYS,
    );
  }

  if (Array.isArray(d.importedGmailMessageIds)) {
    d.importedGmailMessageIds = (d.importedGmailMessageIds as string[]).slice(
      -MAX_IMPORTED_GMAIL_MESSAGES,
    );
  }

  if (Array.isArray(d.aiAuditTrail)) {
    d.aiAuditTrail = (d.aiAuditTrail as any[]).slice(-MAX_AUDIT).map((e) => ({
      ...e,
      prompt: truncate(e.prompt, 400),
      response: truncate(e.response, 400),
    }));
  }

  const formData = d.formData as Record<string, unknown> | undefined;
  if (formData && Array.isArray(formData.documents)) {
    formData.documents = (formData.documents as any[]).map(stripDocForStorage);
  }

  if (d.camilleKnowledgeCache) delete d.camilleKnowledgeCache;

  let json = JSON.stringify(d);
  if (json.length > TARGET_BYTES) {
    if (Array.isArray(d.communications)) {
      d.communications = (d.communications as any[]).slice(-15).map((c) => {
        const row: Record<string, unknown> = {
          id: c.id,
          gmailId: c.gmailId,
          direction: c.direction,
          from: c.from,
          subject: truncate(c.subject, 200),
          text: truncate(c.text, 800),
          date: c.date,
          ...(Array.isArray(c.attachments) ? { attachments: c.attachments.slice(0, 8) } : {}),
        };
        if (isStudyOutboundComm(c) && c.html) {
          row.html = truncate(c.html, MAX_COMM_HTML);
        }
        return row;
      });
    }
    if (Array.isArray(d.eventLog)) d.eventLog = (d.eventLog as any[]).slice(-25);
    json = JSON.stringify(d);
  }

  if (json.length > TARGET_BYTES) {
    if (Array.isArray(d.communications)) {
      d.communications = (d.communications as any[]).slice(-8);
    }
    json = JSON.stringify(d);
    warnOversizeOnce(
      String(d.id || "?"),
      json.length,
      "communications réduites au minimum, compactage registres Gmail",
    );
  }

  enforceFirestoreSizeLimit(d);
  return stripUndefinedForFirestore(d);
}
