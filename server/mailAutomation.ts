import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { addEvent } from './dossierModel';

function getUploadsBaseDir() {
  if (process.env.VERCEL || process.env.RAILWAY_ENVIRONMENT) {
    return path.join('/tmp/data', 'uploads');
  }
  return path.join(process.cwd(), 'data', 'uploads');
}

type GmailAttachmentPart = {
  filename: string;
  mimeType: string;
  attachmentId: string;
};

function collectAttachmentParts(payload: any, out: GmailAttachmentPart[] = []): GmailAttachmentPart[] {
  if (!payload) return out;
  const filename = payload.filename;
  const attachmentId = payload.body?.attachmentId;
  if (filename && attachmentId) {
    const mimeType = payload.mimeType || 'application/octet-stream';
    const disp = (payload.headers || []).find(
      (h: any) => h.name?.toLowerCase() === 'content-disposition',
    )?.value;
    const isInline =
      mimeType.startsWith('image/') && disp?.toLowerCase().includes('inline') && !disp.includes('attachment');
    if (!isInline) {
      out.push({ filename, mimeType, attachmentId });
    }
  }
  if (payload.parts?.length) {
    for (const part of payload.parts) {
      collectAttachmentParts(part, out);
    }
  }
  return out;
}

async function downloadGmailAttachments(
  gmail: ReturnType<typeof google.gmail>,
  messageId: string,
  payload: any,
  dossierId: string,
) {
  const parts = collectAttachmentParts(payload);
  if (!parts.length) return [] as Array<{
    id: string;
    name: string;
    size: number;
    type: string;
    localPath: string;
    source: string;
  }>;

  const dir = path.join(getUploadsBaseDir(), dossierId, 'gmail');
  fs.mkdirSync(dir, { recursive: true });

  const saved: Array<{
    id: string;
    name: string;
    size: number;
    type: string;
    localPath: string;
    source: string;
  }> = [];

  for (const part of parts) {
    try {
      const att = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: part.attachmentId,
      });
      const raw = att.data?.data;
      if (!raw) continue;
      const buf = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
      if (buf.length < 80) continue;

      const safeName = part.filename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'piece-jointe.bin';
      const localPath = path.join(dir, `${Date.now()}_${safeName}`);
      fs.writeFileSync(localPath, buf);
      saved.push({
        id: `doc_gmail_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: part.filename,
        size: buf.length,
        type: part.mimeType,
        localPath,
        source: 'gmail',
      });
    } catch (err) {
      console.error('[Gmail] Échec téléchargement pièce jointe', part.filename, err);
    }
  }
  return saved;
}

function mergeDocumentsIntoDossier(dossier: any, newDocs: Array<{ name: string }>) {
  if (!newDocs.length) return [] as any[];
  if (!dossier.formData) dossier.formData = {};
  if (!dossier.formData.documents) dossier.formData.documents = [];
  const existing = new Set(
    dossier.formData.documents.map((d: any) => String(d.name || '').toLowerCase()),
  );
  const added: any[] = [];
  for (const doc of newDocs) {
    const key = String(doc.name || '').toLowerCase();
    if (!key || existing.has(key)) continue;
    dossier.formData.documents.push(doc);
    existing.add(key);
    added.push(doc);
  }
  return added;
}

function extractEmail(fromRaw: string) {
  const emailMatch = fromRaw.match(/<([^>]+)>/);
  return (emailMatch ? emailMatch[1] : fromRaw).trim().toLowerCase();
}

function decodeBody(payload: any): string {
  if (!payload) return '';

  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  if (payload.parts?.length) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
    }
    for (const part of payload.parts) {
      const nested = decodeBody(part);
      if (nested) return nested;
    }
  }

  return '';
}

function pushCommunication(dossier: any, msg: any) {
  if (!dossier.communications) dossier.communications = [];
  const exists = dossier.communications.some(
    (c: any) => (c.gmailId && c.gmailId === msg.gmailId) || c.id === msg.id,
  );
  if (!exists) dossier.communications.push(msg);
}

function getProcessedIds(dossier: any): Set<string> {
  if (!dossier.processedGmailIds) dossier.processedGmailIds = [];
  return new Set(dossier.processedGmailIds);
}

function markProcessed(dossier: any, gmailId: string) {
  if (!dossier.processedGmailIds) dossier.processedGmailIds = [];
  if (!dossier.processedGmailIds.includes(gmailId)) {
    dossier.processedGmailIds.push(gmailId);
  }
}

function isAiAutoReplyEnabled() {
  const v = (process.env.AI_AUTO_REPLY_ENABLED || 'true').toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'no';
}

export async function syncGmailInbox(accessToken: string, db: any, aiCallback: Function) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: 'v1', auth });

  const clientEmails = new Set<string>();
  for (const d of db.dossiers || []) {
    const email = d.formData?.assures?.[0]?.email;
    if (email) clientEmails.add(String(email).toLowerCase());
  }

  const processedIds = new Set<string>();
  let inboundCount = 0;
  let aiReplies = 0;
  let attachmentsSaved = 0;

  for (const clientEmail of clientEmails) {
    const q = `(from:${clientEmail} OR to:${clientEmail}) newer_than:30d`;
    const listRes = await gmail.users.messages.list({ userId: 'me', q, maxResults: 40 });
    const messages = listRes.data.messages || [];

    for (const msgMeta of messages) {
      if (!msgMeta.id || processedIds.has(msgMeta.id)) continue;
      processedIds.add(msgMeta.id);

      const msgRes = await gmail.users.messages.get({ userId: 'me', id: msgMeta.id, format: 'full' });
      const payload = msgRes.data.payload;
      if (!payload?.headers) continue;

      const subjectHeader = payload.headers.find((h) => h.name?.toLowerCase() === 'subject');
      const fromHeader = payload.headers.find((h) => h.name?.toLowerCase() === 'from');
      const toHeader = payload.headers.find((h) => h.name?.toLowerCase() === 'to');

      const subject = subjectHeader?.value || '';
      const fromRaw = fromHeader?.value || '';
      const toRaw = (toHeader?.value || '').toLowerCase();
      const senderEmail = extractEmail(fromRaw);
      const labelIds = msgRes.data.labelIds || [];
      const isSentByMe = labelIds.includes('SENT');

      const isFromClient = !isSentByMe && senderEmail === clientEmail;
      const isToClient = isSentByMe || toRaw.includes(clientEmail);

      if (!isFromClient && !isToClient) continue;

      const matchedDossiers = db.dossiers.filter((d: any) => {
        const primaryEmail = d.formData?.assures?.[0]?.email;
        return primaryEmail && primaryEmail.toLowerCase() === clientEmail;
      });
      if (matchedDossiers.length === 0) continue;

      const dossier = matchedDossiers.sort(
        (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )[0];

      const text = decodeBody(payload);
      const direction = isFromClient ? 'inbound' : 'outbound';

      let addedAttachments: any[] = [];
      if (isFromClient) {
        const downloaded = await downloadGmailAttachments(gmail, msgMeta.id, payload, dossier.id);
        addedAttachments = mergeDocumentsIntoDossier(dossier, downloaded);
        if (addedAttachments.length) {
          attachmentsSaved += addedAttachments.length;
          for (const doc of addedAttachments) {
            addEvent(dossier, {
              type: 'DOCUMENT_UPLOADED',
              actor: { kind: 'SYSTEM' },
              message: `Pièce jointe reçue par email : ${doc.name}`,
              meta: { source: 'gmail', gmailId: msgMeta.id },
            });
          }
        }
      }

      pushCommunication(dossier, {
        id: `msg_${msgMeta.id}`,
        gmailId: msgMeta.id,
        direction,
        from: isFromClient ? senderEmail : process.env.GMAIL_USER || 'assurance@leclubimmobilier.fr',
        to: isFromClient ? undefined : clientEmail,
        subject,
        text,
        attachments: addedAttachments.map((d) => ({ name: d.name, size: d.size })),
        date: new Date(Number(msgRes.data.internalDate || Date.now())).toISOString(),
      });

      if (isFromClient) {
        inboundCount++;
        const alreadyHandled = getProcessedIds(dossier).has(msgMeta.id);

        if (!alreadyHandled && isAiAutoReplyEnabled()) {
          markProcessed(dossier, msgMeta.id);
          try {
            const aiDecision = await aiCallback(dossier, text, senderEmail, {
              newAttachmentNames: addedAttachments.map((d) => d.name),
            });
            if (aiDecision?.status === 'replied' && aiDecision.text) {
              const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
              const sendResult = await sendEmailReplyWithGmailAPI(
                accessToken,
                clientEmail,
                replySubject,
                aiDecision.text,
              );
              if (sendResult.ok) {
                aiReplies++;
                pushCommunication(dossier, {
                  id: `msg_ai_${msgMeta.id}`,
                  gmailId: sendResult.messageId,
                  direction: 'outbound',
                  from: 'Camille (IA)',
                  to: clientEmail,
                  subject: replySubject,
                  text: aiDecision.text,
                  date: new Date().toISOString(),
                });
                addEvent(dossier, {
                  type: 'AI_DECISION',
                  actor: { kind: 'AI', label: 'Camille' },
                  message: 'Réponse automatique envoyée au client.',
                  meta: { gmailId: msgMeta.id },
                });
                dossier.status = 'EN_COURS';
              }
            } else if (aiDecision?.status === 'escalated') {
              pushCommunication(dossier, {
                id: `msg_esc_${msgMeta.id}`,
                direction: 'inbound',
                from: 'Camille (IA)',
                subject: 'ALERTE — intervention humaine requise',
                text: `Raison : ${aiDecision.reason || 'Escalade'}\n\nClient : ${clientEmail}`,
                date: new Date().toISOString(),
              });
              addEvent(dossier, {
                type: 'AI_DECISION',
                actor: { kind: 'AI', label: 'Camille' },
                message: 'Escalade vers un conseiller.',
                meta: { reason: aiDecision.reason },
              });
              dossier.status = 'EN_ATTENTE_CLIENT';
            }
          } catch (err: any) {
            console.error('[AI] Erreur traitement email:', err);
          }
        } else if (!alreadyHandled) {
          markProcessed(dossier, msgMeta.id);
        }
      }
    }
  }

  dossierTouchUpdatedAt(db);
  return { db, inboundCount, processed: processedIds.size, aiReplies, attachmentsSaved };
}

function dossierTouchUpdatedAt(db: any) {
  for (const d of db.dossiers || []) {
    if (d.communications?.length) {
      d.updatedAt = new Date().toISOString();
    }
  }
}

export async function sendEmailReplyWithGmailAPI(accessToken: string, toEmail: string, subject: string, bodyText: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: 'v1', auth });

  const isHtml = /<[a-z][\s\S]*>/i.test(bodyText);
  const mailLines = [];

  mailLines.push(`To: ${toEmail}`);
  mailLines.push(`Subject: =?utf-8?B?${Buffer.from(subject).toString('base64')}?=`);
  mailLines.push('MIME-Version: 1.0');
  mailLines.push(`Content-Type: text/${isHtml ? 'html' : 'plain'}; charset="UTF-8"`);
  mailLines.push('');
  mailLines.push(bodyText);

  const raw = Buffer.from(mailLines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  try {
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });
    return { ok: true as const, messageId: res.data.id };
  } catch (error: any) {
    console.error("Erreur d'envoi Gmail API:", error);
    return { ok: false as const, error: error?.message || String(error) };
  }
}
