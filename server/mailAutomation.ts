import { google } from 'googleapis';
import { addEvent } from './dossierModel';
import { canUseDomainWideDelegation, createDelegatedJwt, getDelegatedAccessToken } from "./googleDelegatedAuth";
import { hasServerOAuthRefreshToken, getServerAccessToken } from "./googleOAuthServer";
import {
  collectAttachmentParts,
  downloadGmailAttachments,
  findDossierForInboundMessage,
  getDossierClientEmails,
  mergeDocumentsIntoDossier,
} from './gmailAttachments';

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

function upsertCommunication(dossier: any, msg: any) {
  if (!dossier.communications) dossier.communications = [];
  const idx = dossier.communications.findIndex(
    (c: any) => (msg.gmailId && c.gmailId === msg.gmailId) || c.id === msg.id,
  );
  if (idx >= 0) {
    const prev = dossier.communications[idx];
    dossier.communications[idx] = {
      ...prev,
      ...msg,
      attachments:
        msg.attachments?.length > 0 ? msg.attachments : prev.attachments || [],
    };
  } else {
    dossier.communications.push(msg);
  }
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

function getAiEscalationEmail(): string | null {
  const raw = String(process.env.AI_ESCALATION_EMAIL || "remi@leclubimmobilier.fr").trim();
  return raw && raw.includes("@") ? raw : null;
}

function buildGmailQueriesForDossier(dossier: any, clientEmail: string): string[] {
  const dossierId = String(dossier?.id || '').trim();
  const queries = [
    `(from:${clientEmail} OR to:${clientEmail}) has:attachment newer_than:180d`,
    `from:${clientEmail} has:attachment newer_than:180d`,
    `from:${clientEmail} newer_than:180d`,
  ];
  if (dossierId) {
    queries.unshift(`subject:${dossierId} newer_than:180d`);
  }
  return queries;
}

async function resolveGmailDriveUploadTarget(dossier: any, accessToken: string) {
  const folderId = dossier?.workspaceFolderId;
  if (!folderId) return { driveSubfolderId: null as string | null, driveAccessToken: accessToken };

  const { ensureGmailAttachmentsSubfolder } = await import('./gmailDriveUpload');
  const subfolderId = await ensureGmailAttachmentsSubfolder(folderId, accessToken);
  return {
    driveSubfolderId: subfolderId || folderId,
    driveAccessToken: accessToken,
  };
}

async function createGmailAuth(accessToken?: string | null) {
  if (accessToken) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    return { auth, driveAccessToken: accessToken };
  }

  if (hasServerOAuthRefreshToken()) {
    const serverToken = await getServerAccessToken();
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: serverToken });
    return { auth, driveAccessToken: serverToken };
  }

  if (!canUseDomainWideDelegation()) {
    throw new Error("Token OAuth manquant et délégation Google Workspace non configurée (service account + subject).");
  }

  const scopes = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/drive",
  ];
  const auth = createDelegatedJwt(scopes);
  const driveAccessToken = await getDelegatedAccessToken(["https://www.googleapis.com/auth/drive"]);
  return { auth, driveAccessToken };
}

/** Rescanne les emails clients et extrait les pièces jointes (même si déjà importés). */
export async function resyncDossierGmailAttachments(
  accessToken: string | null,
  dossier: any,
): Promise<{
  added: string[];
  scanned: number;
  attachmentPartsFound: number;
  driveUploaded: number;
  errors: string[];
}> {
  const { auth, driveAccessToken } = await createGmailAuth(accessToken);
  const gmail = google.gmail({ version: 'v1', auth: auth as any });

  const emails = getDossierClientEmails(dossier);
  const added: string[] = [];
  const errors: string[] = [];
  let scanned = 0;
  let attachmentPartsFound = 0;
  let driveUploaded = 0;
  const seenMessageIds = new Set<string>();

  const driveCtx = await resolveGmailDriveUploadTarget(dossier, driveAccessToken);

  for (const clientEmail of emails) {
    for (const q of buildGmailQueriesForDossier(dossier, clientEmail)) {
      const listRes = await gmail.users.messages.list({ userId: 'me', q, maxResults: 40 });
      for (const msgMeta of listRes.data.messages || []) {
        if (!msgMeta.id || seenMessageIds.has(msgMeta.id)) continue;
        seenMessageIds.add(msgMeta.id);
        scanned++;

        const msgRes = await gmail.users.messages.get({
          userId: 'me',
          id: msgMeta.id,
          format: 'full',
        });
        const payload = msgRes.data.payload;
        const parts = collectAttachmentParts(payload);
        attachmentPartsFound += parts.length;

        const { saved, errors: dlErrors, driveUploaded: du } = await downloadGmailAttachments(
          gmail,
          msgMeta.id,
          payload,
          dossier.id,
          {
            dossier,
            driveAccessToken: driveCtx.driveAccessToken,
            driveSubfolderId: driveCtx.driveSubfolderId,
          },
        );
        driveUploaded += du;
        errors.push(...dlErrors);
        const merged = mergeDocumentsIntoDossier(dossier, saved);
        for (const doc of merged) {
          added.push(doc.name);
          addEvent(dossier, {
            type: 'DOCUMENT_UPLOADED',
            actor: { kind: 'SYSTEM' },
            message: `Pièce jointe reçue par email : ${doc.name}`,
            meta: {
              source: 'gmail',
              gmailId: msgMeta.id,
              driveFileId: doc.driveFileId,
            },
          });
        }

        const headers = msgRes.data.payload?.headers || [];
        const subject = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value || '';
        const fromHeader = headers.find((h) => h.name?.toLowerCase() === 'from')?.value || '';
        const text = decodeBody(msgRes.data.payload);
        const sender = extractEmail(fromHeader) || clientEmail;
        upsertCommunication(dossier, {
          id: `msg_${msgMeta.id}`,
          gmailId: msgMeta.id,
          direction: 'inbound',
          from: sender,
          subject,
          text,
          attachments: saved.map((d) => ({
            name: d.name,
            size: d.size,
            driveLink: d.driveLink,
          })),
          date: new Date(Number(msgRes.data.internalDate || Date.now())).toISOString(),
        });
      }
    }
  }

  if (!dossier.workspaceFolderId && added.length > 0) {
    errors.push(
      'Dossier Drive non créé : cliquez sur « Drive » une fois, puis relancez « Récupérer PJ email » pour archiver sur Drive.',
    );
  }

  return { added, scanned, attachmentPartsFound, driveUploaded, errors };
}

export async function syncGmailInbox(accessToken: string | null, db: any, aiCallback: Function) {
  const { auth, driveAccessToken } = await createGmailAuth(accessToken);
  const gmail = google.gmail({ version: 'v1', auth: auth as any });

  const clientEmails = new Set<string>();
  for (const d of db.dossiers || []) {
    for (const e of getDossierClientEmails(d)) clientEmails.add(e);
  }

  const processedIds = new Set<string>();
  let inboundCount = 0;
  let aiReplies = 0;
  let attachmentsSaved = 0;
  let driveAttachmentsUploaded = 0;
  const attachmentDebug: Array<{ messageId: string; found: number; saved: number; drive: number }> = [];

  for (const clientEmail of clientEmails) {
    const q = `(from:${clientEmail} OR to:${clientEmail}) newer_than:180d`;
    const listRes = await gmail.users.messages.list({ userId: 'me', q, maxResults: 50 });
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

      const dossier = findDossierForInboundMessage(db, senderEmail, subject);
      if (!dossier) continue;

      const dossierEmails = getDossierClientEmails(dossier);
      const isFromClient = !isSentByMe && dossierEmails.includes(senderEmail);
      const isToClient = isSentByMe || dossierEmails.some((e) => toRaw.includes(e));

      if (!isFromClient && !isToClient) continue;

      const text = decodeBody(payload);
      const direction = isFromClient ? 'inbound' : 'outbound';

      let addedAttachments: any[] = [];
      if (isFromClient) {
        const driveCtx = await resolveGmailDriveUploadTarget(dossier, driveAccessToken);
        const { saved, found, driveUploaded: du } = await downloadGmailAttachments(
          gmail,
          msgMeta.id,
          payload,
          dossier.id,
          {
            dossier,
            driveAccessToken: driveCtx.driveAccessToken,
            driveSubfolderId: driveCtx.driveSubfolderId,
          },
        );
        driveAttachmentsUploaded += du;
        attachmentDebug.push({
          messageId: msgMeta.id,
          found,
          saved: saved.length,
          drive: du,
        });
        addedAttachments = mergeDocumentsIntoDossier(dossier, saved);
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

      upsertCommunication(dossier, {
        id: `msg_${msgMeta.id}`,
        gmailId: msgMeta.id,
        direction,
        from: isFromClient ? senderEmail : process.env.GMAIL_USER || 'assurance@leclubimmobilier.fr',
        to: isFromClient ? undefined : getDossierClientEmails(dossier)[0],
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
                upsertCommunication(dossier, {
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
              upsertCommunication(dossier, {
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

              // Notifie le conseiller par email (24/7) pour éviter de rater une escalade
              const to = getAiEscalationEmail();
              if (to) {
                const subjectEsc = `ALERTE Camille — ${dossier.id} (${clientEmail})`;
                const body = [
                  `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#0f172a">`,
                  `<p><strong>Dossier :</strong> ${dossier.id}</p>`,
                  `<p><strong>Client :</strong> ${clientEmail}</p>`,
                  `<p><strong>Raison :</strong> ${aiDecision.reason || "Escalade"}</p>`,
                  `<p><strong>Extrait email :</strong></p>`,
                  `<pre style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;padding:12px;border-radius:8px">${String(text || "").slice(0, 1500)}</pre>`,
                  `</div>`,
                ].join("");
                sendEmailReplyWithGmailAPI(null, to, subjectEsc, body).catch(() => undefined);
              }
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
  return {
    db,
    inboundCount,
    processed: processedIds.size,
    aiReplies,
    attachmentsSaved,
    driveAttachmentsUploaded,
    attachmentDebug,
  };
}

function dossierTouchUpdatedAt(db: any) {
  for (const d of db.dossiers || []) {
    if (d.communications?.length) {
      d.updatedAt = new Date().toISOString();
    }
  }
}

export async function sendEmailReplyWithGmailAPI(accessToken: string | null, toEmail: string, subject: string, bodyText: string) {
  const { auth } = await createGmailAuth(accessToken);
  const gmail = google.gmail({ version: 'v1', auth: auth as any });

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
