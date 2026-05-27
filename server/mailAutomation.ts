import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

export async function syncGmailInbox(accessToken: string, db: any, aiCallback: Function) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: 'v1', auth });

  try {
    const listRes = await gmail.users.messages.list({ userId: 'me', q: 'is:unread', maxResults: 10 });
    const messages = listRes.data.messages || [];

    for (const msgMeta of messages) {
      if (!msgMeta.id) continue;
      
      const msgRes = await gmail.users.messages.get({ userId: 'me', id: msgMeta.id, format: 'full' });
      const payload = msgRes.data.payload;
      if (!payload || !payload.headers) continue;

      const subjectHeader = payload.headers.find(h => h.name?.toLowerCase() === 'subject');
      const fromHeader = payload.headers.find(h => h.name?.toLowerCase() === 'from');
      
      const subject = subjectHeader ? subjectHeader.value || '' : '';
      const fromRaw = fromHeader ? fromHeader.value || '' : '';
      
      // Extract email address roughly:
      const emailMatch = fromRaw.match(/<([^>]+)>/);
      const senderEmail = emailMatch ? emailMatch[1] : fromRaw;

      if (!senderEmail) continue;

      // Extract parts for body
      let text = '';
      if (payload.parts) {
        const textPart = payload.parts.find(p => p.mimeType === 'text/plain');
        if (textPart && textPart.body?.data) {
          text = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
        }
      } else if (payload.body?.data) {
        text = Buffer.from(payload.body.data, 'base64').toString('utf-8');
      }

      // Match dossier
      const matchedDossiers = db.dossiers.filter((d: any) => {
        const primaryEmail = d.formData?.assures?.[0]?.email;
        return primaryEmail && primaryEmail.toLowerCase() === senderEmail.toLowerCase();
      });

      if (matchedDossiers.length > 0) {
        const dossier = matchedDossiers.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
        if (!dossier.communications) dossier.communications = [];
        
        dossier.communications.push({
          id: "msg_" + Date.now() + "_" + msgMeta.id,
          direction: "inbound",
          from: senderEmail,
          subject,
          text,
          date: new Date().toISOString()
        });

        // Trigger AI callback for CRM
        const aiDecision = await aiCallback(dossier, text, senderEmail);
        if (aiDecision) {
          if (aiDecision.status === "replied" && aiDecision.text) {
             const aiReplyText = aiDecision.text;
             dossier.communications.push({
                id: "msg_" + Date.now() + "_ai",
                direction: "outbound",
                to: senderEmail,
                subject: `Re: ${subject}`,
                text: aiReplyText,
                date: new Date().toISOString()
             });
             await sendEmailReplyWithGmailAPI(accessToken, senderEmail, `Re: ${subject}`, aiReplyText);
             dossier.status = "EN_COURS";
          } else if (aiDecision.status === "escalated" && aiDecision.reason) {
             dossier.communications.push({
                id: "msg_" + Date.now() + "_escalation",
                direction: "inbound", // Admin needs to see this locally
                from: "CAMILLE (IA)",
                subject: `🚨 ALERTE L'IA NE PEUT PAS RÉPONDRE`,
                text: `Raison de l'escalade : ${aiDecision.reason}\n\nClient: ${senderEmail}\nA vous de jouer !`,
                date: new Date().toISOString()
             });
             dossier.status = "EN_ATTENTE_CLIENT"; // Wait for human intervention
          }
        }
      }

      // Mark as read
      await gmail.users.messages.modify({ userId: 'me', id: msgMeta.id, requestBody: { removeLabelIds: ['UNREAD'] } });
    }
    return db;
  } catch (error) {
    console.error("Erreur de synchro Gmail API:", error);
    return db;
  }
}

export async function sendEmailReplyWithGmailAPI(accessToken: string, toEmail: string, subject: string, bodyText: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: 'v1', auth });

  const isHtml = /<[a-z][\s\S]*>/i.test(bodyText);
  const boundary = 'foo_bar_baz';
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
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });
    return true;
  } catch (error) {
    console.error("Erreur d'envoi Gmail API:", error);
    return false;
  }
}
