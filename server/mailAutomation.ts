import { google } from 'googleapis';
import { addEvent } from './dossierModel';

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

      pushCommunication(dossier, {
        id: `msg_${msgMeta.id}`,
        gmailId: msgMeta.id,
        direction,
        from: isFromClient ? senderEmail : process.env.GMAIL_USER || 'assurance@leclubimmobilier.fr',
        to: isFromClient ? undefined : clientEmail,
        subject,
        text,
        date: new Date(Number(msgRes.data.internalDate || Date.now())).toISOString(),
      });

      if (isFromClient) {
        inboundCount++;
        const alreadyHandled = getProcessedIds(dossier).has(msgMeta.id);

        if (!alreadyHandled && isAiAutoReplyEnabled()) {
          markProcessed(dossier, msgMeta.id);
          try {
            const aiDecision = await aiCallback(dossier, text, senderEmail);
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
  return { db, inboundCount, processed: processedIds.size, aiReplies };
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
