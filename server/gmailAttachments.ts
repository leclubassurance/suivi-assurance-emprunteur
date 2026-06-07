import fs from 'fs';
import path from 'path';
import type { gmail_v1 } from 'googleapis';
import { classifyFileName, type DocumentCategory } from '../shared/documentClassifier';
import { assessDocumentQuality } from '../shared/documentQuality';
import { normalizeDocumentForPersistence } from './documentStoragePolicy';

export function getUploadsBaseDir() {
  if (process.env.VERCEL || process.env.RAILWAY_ENVIRONMENT) {
    return path.join('/tmp/data', 'uploads');
  }
  return path.join(process.cwd(), 'data', 'uploads');
}

export type SavedGmailAttachment = {
  id: string;
  name: string;
  size: number;
  type: string;
  localPath: string;
  source: string;
  category?: string;
  gmailMessageId?: string;
  /** Clé stable messageId:attachmentId (ou nom de fichier) — anti-doublon au resync Gmail. */
  gmailImportKey?: string;
  driveFileId?: string;
  driveLink?: string;
  quality?: { ok: boolean; reasons: string[]; confidence?: string };
};

type CollectedPart = {
  filename: string;
  mimeType: string;
  attachmentId?: string;
  inlineBase64?: string;
};

function decodeRfc2047(value: string): string {
  try {
    return value.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b64) =>
      Buffer.from(b64, 'base64').toString('utf8'),
    );
  } catch {
    return value;
  }
}

function getPartFilename(part: gmail_v1.Schema$MessagePart): string {
  if (part.filename) return decodeRfc2047(part.filename);
  const headers = part.headers || [];
  const cd =
    headers.find((h) => h.name?.toLowerCase() === 'content-disposition')?.value || '';
  const fnStar = cd.match(/filename\*=UTF-8''([^;\s]+)/i);
  if (fnStar) {
    try {
      return decodeURIComponent(fnStar[1]);
    } catch {
      return fnStar[1];
    }
  }
  const fn = cd.match(/filename="?([^";\n]+)"?/i);
  if (fn) return decodeRfc2047(fn[1].trim());
  const ct = headers.find((h) => h.name?.toLowerCase() === 'content-type')?.value || '';
  const ctFn = ct.match(/name="?([^";\n]+)"?/i);
  if (ctFn) return decodeRfc2047(ctFn[1].trim());
  return '';
}

function isContainerMime(mimeType: string) {
  return (
    mimeType.startsWith('multipart/') ||
    mimeType === 'text/plain' ||
    mimeType === 'text/html' ||
    mimeType === 'message/rfc822'
  );
}

function guessFilename(mimeType: string, index: number) {
  const ext =
    mimeType.includes('pdf')
      ? 'pdf'
      : mimeType.includes('png')
        ? 'png'
        : mimeType.includes('jpeg') || mimeType.includes('jpg')
          ? 'jpg'
          : 'bin';
  return `piece-jointe-${index + 1}.${ext}`;
}

/** Parcourt tout l'arbre MIME Gmail (y compris PJ inline dans body.data). */
export function collectAttachmentParts(
  part: gmail_v1.Schema$MessagePart | undefined,
  out: CollectedPart[] = [],
): CollectedPart[] {
  if (!part) return out;

  const mimeType = part.mimeType || 'application/octet-stream';
  let filename = getPartFilename(part);
  const hasBinary = Boolean(part.body?.attachmentId || part.body?.data);

  if (!filename && hasBinary && !isContainerMime(mimeType)) {
    filename = guessFilename(mimeType, out.length);
  }

  if (filename && !isContainerMime(mimeType) && hasBinary) {
    if (part.body?.attachmentId) {
      out.push({ filename, mimeType, attachmentId: part.body.attachmentId });
    } else if (part.body?.data) {
      out.push({ filename, mimeType, inlineBase64: part.body.data });
    }
  }

  for (const child of part.parts || []) {
    collectAttachmentParts(child, out);
  }
  return out;
}

function decodeGmailBase64(data: string) {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64');
}

export type GmailDownloadOptions = {
  dossier?: { id?: string; workspaceFolderId?: string };
  driveAccessToken?: string | null;
  driveSubfolderId?: string | null;
  /** Pièces déjà importées pour ce dossier (ne pas retélécharger ni ré-uploader Drive). */
  importedKeys?: Set<string>;
  /** Fichiers déjà présents sur Drive (nom minuscule → id). */
  driveFilesByName?: Map<string, { fileId: string; webViewLink?: string | null }>;
};

export function buildGmailImportKey(
  messageId: string,
  part: { attachmentId?: string; filename: string },
): string {
  const partId = part.attachmentId || `fn:${String(part.filename || '').toLowerCase()}`;
  return `${messageId}:${partId}`;
}

/** Variantes de clé (attachmentId vs nom) pour matcher anciens imports. */
export function getGmailImportKeyVariants(
  messageId: string,
  part: { attachmentId?: string; filename: string },
): string[] {
  const variants = new Set<string>();
  variants.add(buildGmailImportKey(messageId, part));
  const fn = String(part.filename || "").toLowerCase();
  if (fn) {
    variants.add(`${messageId}:fn:${fn}`);
    if (part.attachmentId) {
      variants.add(buildGmailImportKey(messageId, { filename: part.filename }));
    }
  }
  return [...variants];
}

export function isGmailPartImported(
  importedKeys: Set<string>,
  messageId: string,
  part: { attachmentId?: string; filename: string },
): boolean {
  return getGmailImportKeyVariants(messageId, part).some((k) => importedKeys.has(k));
}

/** Vérifie qu'une PJ Gmail est bien enregistrée dans formData.documents (pas seulement dans le registre). */
export function isGmailPartInDossierDocuments(
  dossier: any,
  messageId: string,
  part: { attachmentId?: string; filename: string },
): boolean {
  const docs = dossier?.formData?.documents || [];
  const variants = getGmailImportKeyVariants(messageId, part);
  if (
    docs.some(
      (d: any) => d?.gmailImportKey && variants.includes(String(d.gmailImportKey)),
    )
  ) {
    return true;
  }
  const nameKey = String(part.filename || "").toLowerCase();
  if (!nameKey) return false;
  return docs.some(
    (d: any) =>
      String(d.name || "").toLowerCase() === nameKey &&
      (!d.gmailMessageId || String(d.gmailMessageId) === messageId),
  );
}

function guessMimeFromFilename(name: string): string {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

type PartImportAction =
  | { action: "download" }
  | { action: "skip" }
  | { action: "reuse_drive"; driveFile: { fileId: string; webViewLink?: string | null } };

function resolvePartImportAction(
  importedKeys: Set<string>,
  messageId: string,
  part: CollectedPart,
  driveFilesByName: Map<string, { fileId: string; webViewLink?: string | null }> | undefined,
  dossierRef: any | undefined,
): PartImportAction {
  const nameKey = String(part.filename || "").toLowerCase();
  const driveHit = nameKey && driveFilesByName?.has(nameKey) ? driveFilesByName.get(nameKey)! : null;

  if (isGmailPartImported(importedKeys, messageId, part)) {
    if (dossierRef && !isGmailPartInDossierDocuments(dossierRef, messageId, part)) {
      if (driveHit) return { action: "reuse_drive", driveFile: driveHit };
      return { action: "download" };
    }
    return { action: "skip" };
  }

  if (driveHit) {
    const variants = getGmailImportKeyVariants(messageId, part);
    for (const k of variants) importedKeys.add(k);
    if (dossierRef) registerImportedGmailAttachmentKeys(dossierRef, variants);
    return { action: "reuse_drive", driveFile: driveHit };
  }

  return { action: "download" };
}

export function getImportedGmailMessageIds(dossier: any): Set<string> {
  const ids = new Set<string>();
  for (const id of dossier?.importedGmailMessageIds || []) {
    if (id) ids.add(String(id));
  }
  for (const id of dossier?.processedGmailIds || []) {
    if (id) ids.add(String(id));
  }
  for (const comm of dossier?.communications || []) {
    if (comm?.gmailId && Array.isArray(comm.attachments) && comm.attachments.length > 0) {
      ids.add(String(comm.gmailId));
    }
  }
  return ids;
}

export function markGmailMessageAttachmentsHandled(
  dossier: any,
  messageId: string,
  parts?: { attachmentId?: string; filename: string }[],
) {
  if (!messageId) return;
  if (!Array.isArray(dossier.importedGmailMessageIds)) {
    dossier.importedGmailMessageIds = [];
  }
  if (!dossier.importedGmailMessageIds.includes(messageId)) {
    dossier.importedGmailMessageIds.push(messageId);
  }
  dossier.importedGmailMessageIds = dossier.importedGmailMessageIds.slice(-2500);

  if (parts?.length) {
    const keys: string[] = [];
    for (const p of parts) keys.push(...getGmailImportKeyVariants(messageId, p));
    registerImportedGmailAttachmentKeys(dossier, keys);
  }
}

/** Registre des PJ Gmail déjà importées (persisté sur le dossier). */
export function getImportedGmailAttachmentKeys(dossier: any): Set<string> {
  const keys = new Set<string>();
  for (const k of dossier?.importedGmailAttachmentKeys || []) {
    if (k) keys.add(String(k));
  }
  for (const doc of dossier?.formData?.documents || []) {
    if (doc?.gmailImportKey) {
      keys.add(String(doc.gmailImportKey));
    }
    if (doc?.gmailMessageId && doc?.name) {
      for (const k of getGmailImportKeyVariants(String(doc.gmailMessageId), {
        filename: String(doc.name),
      })) {
        keys.add(k);
      }
    }
  }
  for (const comm of dossier?.communications || []) {
    const gmailId = comm?.gmailId;
    if (!gmailId || !Array.isArray(comm.attachments)) continue;
    for (const att of comm.attachments) {
      const name = att?.name;
      if (!name) continue;
      for (const k of getGmailImportKeyVariants(String(gmailId), { filename: String(name) })) {
        keys.add(k);
      }
    }
  }
  return keys;
}

/** Supprime les doublons déjà présents (même PJ Gmail ou même empreinte nom/taille/catégorie). */
export function dedupeDossierDocuments(dossier: any): { removed: number; remaining: number } {
  const docs = dossier?.formData?.documents;
  if (!Array.isArray(docs) || docs.length < 2) {
    return { removed: 0, remaining: docs?.length || 0 };
  }

  const winnerByKey = new Map<string, any>();
  const keyForDoc = (doc: any) => {
    if (doc?.gmailImportKey) return `import:${doc.gmailImportKey}`;
    if (doc?.gmailMessageId && doc?.name) {
      return `import:${buildGmailImportKey(String(doc.gmailMessageId), { filename: String(doc.name) })}`;
    }
    if (doc.category === "offre" || doc.category === "tableau" || doc.category === "fiche") {
      return `cat:${doc.category}`;
    }
    return `fp:${docFingerprint(doc)}`;
  };

  const score = (doc: any) =>
    (doc?.driveFileId ? 4 : 0) + (doc?.loanSignal ? 2 : 0) + (Number(doc?.size) || 0) / 1_000_000;

  for (const doc of docs) {
    const key = keyForDoc(doc);
    const prev = winnerByKey.get(key);
    if (!prev || score(doc) > score(prev)) winnerByKey.set(key, doc);
  }

  const seen = new Set<string>();
  const deduped: any[] = [];
  for (const doc of docs) {
    const key = keyForDoc(doc);
    if (winnerByKey.get(key) !== doc) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(doc);
  }
  const removed = docs.length - deduped.length;
  dossier.formData.documents = deduped;

  const keys: string[] = [];
  for (const doc of deduped) {
    if (doc.gmailImportKey) keys.push(doc.gmailImportKey);
    else if (doc.gmailMessageId && doc.name) {
      keys.push(buildGmailImportKey(String(doc.gmailMessageId), { filename: String(doc.name) }));
    }
  }
  registerImportedGmailAttachmentKeys(dossier, keys);

  return { removed, remaining: deduped.length };
}

export function registerImportedGmailAttachmentKeys(dossier: any, keys: string[]) {
  if (!keys.length) return;
  if (!Array.isArray(dossier.importedGmailAttachmentKeys)) {
    dossier.importedGmailAttachmentKeys = [];
  }
  const merged = new Set<string>([...dossier.importedGmailAttachmentKeys, ...keys]);
  dossier.importedGmailAttachmentKeys = [...merged].slice(-5000);
}

export async function downloadGmailAttachments(
  gmail: gmail_v1.Gmail,
  messageId: string,
  payload: gmail_v1.Schema$MessagePart | undefined,
  dossierId: string,
  options?: GmailDownloadOptions,
): Promise<{ saved: SavedGmailAttachment[]; found: number; errors: string[]; driveUploaded: number }> {
  const parts = collectAttachmentParts(payload);
  const errors: string[] = [];
  if (!parts.length) {
    return { saved: [], found: 0, errors, driveUploaded: 0 };
  }

  const dir = path.join(getUploadsBaseDir(), dossierId, 'gmail');
  fs.mkdirSync(dir, { recursive: true });

  const saved: SavedGmailAttachment[] = [];
  let driveUploaded = 0;
  const driveFolderId = options?.driveSubfolderId || options?.dossier?.workspaceFolderId;
  const driveToken = options?.driveAccessToken;
  const importedKeys =
    options?.importedKeys ||
    (options?.dossier ? getImportedGmailAttachmentKeys(options.dossier) : new Set<string>());
  const driveFilesByName = options?.driveFilesByName;
  const dossierRef = options?.dossier;

  for (const part of parts) {
    const importAction = resolvePartImportAction(
      importedKeys,
      messageId,
      part,
      driveFilesByName,
      dossierRef,
    );

    if (importAction.action === "skip") continue;

    if (importAction.action === "reuse_drive") {
      try {
        const category: DocumentCategory | null = classifyFileName(part.filename);
        const idPrefix = category && category !== "autre" ? category : "pj";
        const importKey = buildGmailImportKey(messageId, part);
        const doc: SavedGmailAttachment = {
          id: `${idPrefix}-drive_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          category: category || undefined,
          name: part.filename,
          size: 0,
          type: part.mimeType || guessMimeFromFilename(part.filename),
          localPath: "",
          source: "gmail",
          gmailMessageId: messageId,
          gmailImportKey: importKey,
          driveFileId: importAction.driveFile.fileId,
          driveLink: importAction.driveFile.webViewLink || undefined,
          quality: assessDocumentQuality({
            name: part.filename,
            size: 0,
            type: part.mimeType || guessMimeFromFilename(part.filename),
            category: category || undefined,
          }),
        };
        saved.push(doc);
        const variants = getGmailImportKeyVariants(messageId, part);
        for (const k of variants) importedKeys.add(k);
        if (dossierRef) registerImportedGmailAttachmentKeys(dossierRef, variants);
      } catch (err: any) {
        errors.push(`${part.filename}: réutilisation Drive — ${err?.message || err}`);
      }
      continue;
    }

    try {
      let buf: Buffer | null = null;
      if (part.attachmentId) {
        const att = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId,
          id: part.attachmentId,
        });
        if (att.data?.data) {
          buf = decodeGmailBase64(att.data.data);
        }
      } else if (part.inlineBase64) {
        buf = decodeGmailBase64(part.inlineBase64);
      }
      if (!buf || buf.length < 80) {
        errors.push(`${part.filename}: fichier vide ou trop petit (${buf?.length || 0} o)`);
        continue;
      }

      const category: DocumentCategory | null = classifyFileName(part.filename);
      const idPrefix = category && category !== 'autre' ? category : 'pj';
      const safeName = part.filename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'piece-jointe.bin';
      const localPath = path.join(dir, `${Date.now()}_${safeName}`);
      fs.writeFileSync(localPath, buf);
      const importKey = buildGmailImportKey(messageId, part);
      const doc: SavedGmailAttachment = {
        id: `${idPrefix}-gmail_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        category: category || undefined,
        name: part.filename,
        size: buf.length,
        type: part.mimeType,
        localPath,
        source: 'gmail',
        gmailMessageId: messageId,
        gmailImportKey: importKey,
        quality: assessDocumentQuality({
          name: part.filename,
          size: buf.length,
          type: part.mimeType,
          category: category || undefined,
        }),
      };

      // Analyse interne du PDF pour documents clés
      try {
        const { analyzeLoanPdf, isLoanPdfOrImage } = await import("./documentPdfSignals");
        if (
          (category === "offre" || category === "tableau") &&
          isLoanPdfOrImage(part.filename, part.mimeType)
        ) {
          const sig = await analyzeLoanPdf(localPath, category as any, {
            mimeType: part.mimeType || doc.type,
          });
          (doc as any).loanSignal = sig;
          if (doc.quality && !sig.ok) {
            doc.quality.ok = false;
            doc.quality.reasons = [...new Set([...(doc.quality.reasons || []), ...(sig.reasons || [])])];
          }
        }
      } catch {
        // ignore
      }

      if (driveFolderId) {
        const { uploadBufferToDriveFolder, findDriveFileIdInFolder } = await import(
          "./gmailDriveUpload",
        );
        const nameKey = String(part.filename || "").toLowerCase();
        const cached = nameKey ? driveFilesByName?.get(nameKey) : undefined;
        let existingId = cached?.fileId || null;
        if (!existingId) {
          existingId = await findDriveFileIdInFolder(
            driveFolderId,
            part.filename,
            driveToken,
          );
        }

        if (existingId) {
          doc.driveFileId = existingId;
          doc.driveLink = cached?.webViewLink || doc.driveLink;
          if (nameKey && driveFilesByName && !driveFilesByName.has(nameKey)) {
            driveFilesByName.set(nameKey, {
              fileId: existingId,
              webViewLink: doc.driveLink,
            });
          }
        } else {
          const uploaded = await uploadBufferToDriveFolder(
            driveFolderId,
            part.filename,
            part.mimeType,
            buf,
            driveToken,
          );
          if (uploaded) {
            doc.driveFileId = uploaded.fileId;
            doc.driveLink = uploaded.webViewLink || undefined;
            driveUploaded += 1;
            if (nameKey && driveFilesByName) {
              driveFilesByName.set(nameKey, {
                fileId: uploaded.fileId,
                webViewLink: uploaded.webViewLink,
              });
            }
          } else {
            errors.push(`${part.filename}: enregistré localement mais échec upload Drive`);
          }
        }
      }

      saved.push(doc);
      const variants = getGmailImportKeyVariants(messageId, part);
      for (const k of variants) importedKeys.add(k);
      if (dossierRef) registerImportedGmailAttachmentKeys(dossierRef, variants);
    } catch (err: any) {
      const msg = `${part.filename}: ${err?.message || err}`;
      console.error('[Gmail] PJ', msg);
      errors.push(msg);
    }
  }

  return { saved, found: parts.length, errors, driveUploaded };
}

function docFingerprint(doc: { name?: string; size?: number; category?: string }) {
  return `${String(doc.category || '')}|${String(doc.name || '').toLowerCase()}|${doc.size || 0}`;
}

export function mergeDocumentsIntoDossier(dossier: any, newDocs: SavedGmailAttachment[]) {
  if (!newDocs.length) return [] as SavedGmailAttachment[];
  if (!dossier.formData) dossier.formData = {};
  if (!dossier.formData.documents) dossier.formData.documents = [];

  const existingNames = new Set(
    dossier.formData.documents.map((d: any) => String(d.name || '').toLowerCase()),
  );
  const existingFp = new Set(
    dossier.formData.documents.map((d: any) => docFingerprint(d)),
  );
  const existingImportKeys = getImportedGmailAttachmentKeys(dossier);

  const added: SavedGmailAttachment[] = [];
  const registeredKeys: string[] = [];
  for (const doc of newDocs) {
    const nameKey = String(doc.name || '').toLowerCase();
    const fp = docFingerprint(doc);
    if (!nameKey) continue;

    const importKey =
      doc.gmailImportKey ||
      (doc.gmailMessageId
        ? buildGmailImportKey(doc.gmailMessageId, { filename: doc.name })
        : null);

    const singleSlot = doc.category === 'offre' || doc.category === 'tableau' || doc.category === 'fiche';
    const dupByCategory =
      singleSlot &&
      dossier.formData.documents.some((d: any) => d.category === doc.category);

    if (
      (importKey && existingImportKeys.has(importKey)) ||
      existingNames.has(nameKey) ||
      existingFp.has(fp) ||
      dupByCategory
    ) {
      continue;
    }

    const row = normalizeDocumentForPersistence({
      ...doc,
      gmailImportKey: importKey || doc.gmailImportKey,
    });
    dossier.formData.documents.push(row);
    existingNames.add(nameKey);
    existingFp.add(fp);
    if (importKey) {
      existingImportKeys.add(importKey);
      registeredKeys.push(importKey);
    }
    added.push(doc);
  }
  registerImportedGmailAttachmentKeys(dossier, registeredKeys);
  return added;
}

export function getDossierClientEmails(dossier: any): string[] {
  const emails = new Set<string>();
  for (const a of dossier.formData?.assures || []) {
    if (a?.email) emails.add(String(a.email).trim().toLowerCase());
  }
  const primary = dossier.formData?.assures?.[0]?.email;
  if (primary) emails.add(String(primary).trim().toLowerCase());
  return [...emails];
}

function matchDossierByLcif(db: { dossiers: any[] }, subject: string) {
  const lcif = subject.match(/LCIF-\d{6}/i)?.[0]?.toUpperCase();
  if (!lcif) return null;
  return db.dossiers.find((d) => String(d.id).toUpperCase() === lcif) || null;
}

function pickBestDossierForClient(
  matches: any[],
  messageDate?: string,
): any | null {
  if (matches.length === 0) return null;
  const msgTs = messageDate ? new Date(messageDate).getTime() : NaN;
  if (Number.isFinite(msgTs)) {
    const eligible = matches.filter((d) => {
      const createdTs = new Date(d.createdAt || 0).getTime();
      return createdTs <= msgTs + 6 * 3600 * 1000;
    });
    if (eligible.length > 0) {
      return eligible.sort((a, b) => {
        const da = Math.abs(msgTs - new Date(a.createdAt || 0).getTime());
        const dbb = Math.abs(msgTs - new Date(b.createdAt || 0).getTime());
        return da - dbb;
      })[0];
    }
    return null;
  }
  return matches.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];
}

/** Email entrant client ou sortant assurance@ → client (sync Gmail). */
export function findDossierForGmailMessage(
  db: { dossiers: any[] },
  params: {
    senderEmail: string;
    toRaw: string;
    subject: string;
    messageDate?: string;
    isSentByMe: boolean;
  },
): any | null {
  const byId = matchDossierByLcif(db, params.subject);
  if (byId) return byId;

  const toLc = String(params.toRaw || "").toLowerCase();

  if (params.isSentByMe) {
    const matches = db.dossiers.filter((d) =>
      getDossierClientEmails(d).some((ce) => toLc.includes(ce)),
    );
    return pickBestDossierForClient(matches, params.messageDate);
  }

  return findDossierForInboundMessage(db, params.senderEmail, params.subject, params.messageDate);
}

export function findDossierForInboundMessage(
  db: { dossiers: any[] },
  senderEmail: string,
  subject: string,
  messageDate?: string,
): any | null {
  const byId = matchDossierByLcif(db, subject);
  if (byId) return byId;

  const matches = db.dossiers.filter((d) => getDossierClientEmails(d).includes(senderEmail));
  return pickBestDossierForClient(matches, messageDate);
}
