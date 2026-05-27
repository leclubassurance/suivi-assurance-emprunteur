import { google } from 'googleapis';

function extractEmail(fromRaw: string) {
  const emailMatch = fromRaw.match(/<([^>]+)>/);
  return (emailMatch ? emailMatch[1] : fromRaw).trim().toLowerCase();
}

function decodeBody(payload: any): string {
  let text = '';
  if (payload?.parts) {
    const textPart =
      payload.parts.find((p: any) => p.mimeType === 'text/plain') ||
      payload.parts.find((p: any) => p.mimeType === 'text/html');
    if (textPart?.body?.data) {
      text = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
    }
  } else if (payload?.body?.data) {
    text = Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }
  return text;
}

function pushCommunication(dossier: any, msg: any) {
  if (!dossier.communications) dossier.communications = [];
  const exists = dossier.communications.some((c: any) => c.gmailId === msg.gmailId);
  if (!exists) dossier.communications.push(msg);
}

export async function syncGmailInbox(accessToken: string, db: any, aiCallback: Function) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: 'v1', auth });

  try {
    const clientEmails = new Set<string>();
    for (const d of db.dossiers || []) {
      const email = d.formData?.assures?.[0]?.email;
      if (email) clientEmails.add(String(email).toLowerCase());
    }

    const processedIds = new Set<string>();
    let inboundCount = 0;

    for (const clientEmail of clientEmails) {
      const q = `(from:${clientEmail} OR to:${clientEmail}) newer_than:30d`;
      const listRes = await gmail.users.messages.list({ userId: 'me', q, maxResults: 25 });
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
        const toRaw = toHeader?.value || '';
        const senderEmail = extractEmail(fromRaw);
        const text = decodeBody(payload);

        const isFromClient = senderEmail === clientEmail;
        const isToClient = toRaw.toLowerCase().includes(clientEmail);

        if (!isFromClient && !isToClient) continue;

        const matchedDossiers = db.dossiers.filter((d: any) => {
          const primaryEmail = d.formData?.assures?.[0]?.email;
          return primaryEmail && primaryEmail.toLowerCase() === clientEmail;
        });

        if (matchedDossiers.length === 0) continue;

        const dossier = matchedDossiers.sort(
          (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )[0];

        const direction = isFromClient ? 'inbound' : 'outbound';
        pushCommunication(dossier, {
          id: `msg_${msgMeta.id}`,
          gmailId: msgMeta.id,
          direction,
          from: isFromClient ? senderEmail : 'assurance@leclubimmobilier.fr',
          to: isFromClient ? undefined : clientEmail,
          subject,
          text,
          date: new Date(Number(msgRes.data.internalDate || Date.now())).toISOString(),
        });

        if (isFromClient) {
          inboundCount++;
          const aiDecision = await aiCallback(dossier, text, senderEmail);
          if (aiDecision) {
            if (aiDecision.status === 'replied' && aiDecision.text) {
              const aiReplyText = aiDecision.text;
              pushCommunication(dossier, {
                id: `msg_ai_${Date.now()}`,
                direction: 'outbound',
                to: clientEmail,
                subject: `Re: ${subject}`,
                text: aiReplyText,
                date: new Date().toISOString(),
              });
              await sendEmailReplyWithGmailAPI(accessToken, clientEmail, `Re: ${subject}`, aiReplyText);
              dossier.status = 'EN_COURS';
            } else if (aiDecision.status === 'escalated' && aiDecision.reason) {
              pushCommunication(dossier, {
                id: `msg_esc_${Date.now()}`,
                direction: 'inbound',
                from: 'CAMILLE (IA)',
                subject: `ALERTE — intervention humaine requise`,
                text: `Raison : ${aiDecision.reason}\n\nClient : ${clientEmail}`,
                date: new Date().toISOString(),
              });
              dossier.status = 'EN_ATTENTE_CLIENT';
            }
          }
        }
      }
    }

    return { db, inboundCount, processed: processedIds.size };
  } catch (error) {
    console.error('Erreur de synchro Gmail API:', error);
    throw error;
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
