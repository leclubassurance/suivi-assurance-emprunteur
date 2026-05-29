/** Réduit la taille d'un dossier avant écriture Firestore (limite ~1 Mo / document). */

import { normalizeDocumentForPersistence } from "./documentStoragePolicy";

const MAX_COMM_TEXT = 3500;
/** Études HTML (~8 ko) : tronquer trop tôt casse l'extraction KPI (bloc 36px + frais). */
const MAX_COMM_HTML = 12_000;
const MAX_COMMS = 35;
const MAX_EVENTS = 60;
const MAX_GMAIL_IDS = 250;
const MAX_AUDIT = 25;
const TARGET_BYTES = 880_000;

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
      d.communications = (d.communications as any[]).slice(-15).map((c) => ({
        id: c.id,
        gmailId: c.gmailId,
        direction: c.direction,
        from: c.from,
        subject: truncate(c.subject, 200),
        text: truncate(c.text, 800),
        date: c.date,
        ...(Array.isArray(c.attachments) ? { attachments: c.attachments.slice(0, 8) } : {}),
      }));
    }
    if (Array.isArray(d.eventLog)) d.eventLog = (d.eventLog as any[]).slice(-25);
    json = JSON.stringify(d);
  }

  if (json.length > TARGET_BYTES) {
    console.warn(
      `[Firebase] Dossier ${d.id} encore volumineux après compact (${json.length} octets) — communications réduites au minimum.`,
    );
    if (Array.isArray(d.communications)) {
      d.communications = (d.communications as any[]).slice(-8);
    }
  }

  return stripUndefinedForFirestore(d);
}
