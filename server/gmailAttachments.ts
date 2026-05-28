import fs from 'fs';
import path from 'path';
import type { gmail_v1 } from 'googleapis';
import { classifyFileName, type DocumentCategory } from '../shared/documentClassifier';
import { assessDocumentQuality } from '../shared/documentQuality';

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
};

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

  for (const part of parts) {
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
      const doc: SavedGmailAttachment = {
        id: `${idPrefix}-gmail_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        category: category || undefined,
        name: part.filename,
        size: buf.length,
        type: part.mimeType,
        localPath,
        source: 'gmail',
        gmailMessageId: messageId,
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
            mimeType: part.mimeType,
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
        const { uploadBufferToDriveFolder } = await import('./gmailDriveUpload');
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
        } else {
          errors.push(`${part.filename}: enregistré localement mais échec upload Drive`);
        }
      }

      saved.push(doc);
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

  const added: SavedGmailAttachment[] = [];
  for (const doc of newDocs) {
    const nameKey = String(doc.name || '').toLowerCase();
    const fp = docFingerprint(doc);
    if (!nameKey) continue;

    const singleSlot = doc.category === 'offre' || doc.category === 'tableau' || doc.category === 'fiche';
    const dupByCategory =
      singleSlot &&
      dossier.formData.documents.some((d: any) => d.category === doc.category);

    if (existingNames.has(nameKey) || existingFp.has(fp) || dupByCategory) continue;

    dossier.formData.documents.push(doc);
    existingNames.add(nameKey);
    existingFp.add(fp);
    added.push(doc);
  }
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
