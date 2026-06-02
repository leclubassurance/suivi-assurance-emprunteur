import { google } from 'googleapis';
import { addEvent } from './dossierModel';
import { writeDB } from './db';
import {
  acquireCamilleClientEmailLock,
  canCamilleEmailClient,
  cancelScheduledDocFollowUp,
  releaseCamilleClientEmailLock,
} from './camilleClientEmailGuard';
import { canUseDomainWideDelegation, createDelegatedJwt, getDelegatedAccessToken } from "./googleDelegatedAuth";
import { hasServerOAuthRefreshToken, getServerAccessToken } from "./googleOAuthServer";
import {
  collectAttachmentParts,
  downloadGmailAttachments,
  findDossierForGmailMessage,
  getDossierClientEmails,
  mergeDocumentsIntoDossier,
  getImportedGmailAttachmentKeys,
  getImportedGmailMessageIds,
  isGmailPartImported,
  markGmailMessageAttachmentsHandled,
} from './gmailAttachments';

export function extractEmail(fromRaw: string) {
  const emailMatch = fromRaw.match(/<([^>]+)>/);
  return (emailMatch ? emailMatch[1] : fromRaw).trim().toLowerCase();
}

export function decodeEmailBodies(payload: any): { text: string; html: string } {
  let text = "";
  let html = "";

  function walk(part: any) {
    if (!part) return;
    if (part.mimeType === "text/plain" && part.body?.data && !text) {
      text = Buffer.from(part.body.data, "base64").toString("utf-8");
    }
    if (part.mimeType === "text/html" && part.body?.data) {
      html = Buffer.from(part.body.data, "base64").toString("utf-8");
    }
    for (const child of part.parts || []) walk(child);
  }

  if (payload?.body?.data) {
    const raw = Buffer.from(payload.body.data, "base64").toString("utf-8");
    if (payload.mimeType === "text/html") html = raw;
    else text = raw;
  }
  walk(payload);

  if (!text && html) {
    text = html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return { text, html };
}

function decodeBody(payload: any): string {
  return decodeEmailBodies(payload).text;
}

function truncateCommText(s: unknown, max = 3500): string {
  const t = String(s || "");
  return t.length <= max ? t : `${t.slice(0, max)}…`;
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
    dossier.communications.push({
      ...msg,
      text: msg.text != null ? truncateCommText(msg.text) : msg.text,
    });
  }
  if (dossier.communications.length > 40) {
    dossier.communications = dossier.communications.slice(-40);
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function getParisParts(d: Date) {
  const fmt = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const weekday = (parts.find((p) => p.type === "weekday")?.value || "").toLowerCase();
  const hour = Number(parts.find((p) => p.type === "hour")?.value || "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value || "0");
  return { weekday, hour, minute };
}

function isBusinessHoursGateEnabled() {
  const v = (process.env.AI_BUSINESS_HOURS_ENABLED || "false").toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function isWithinBusinessHours(now = new Date()) {
  const { weekday, hour } = getParisParts(now);
  const isWeekend = weekday.startsWith("sam") || weekday.startsWith("dim");
  if (isWeekend) return false;
  // Mon–Fri 09:00–19:00 Paris time
  return hour >= 9 && hour < 19;
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
  if (!subfolderId) {
    console.warn(
      `[Gmail→Drive] workspaceFolderId invalide pour ${dossier?.id || "?"} (${folderId}), réinitialisation`,
    );
    delete dossier.workspaceFolderId;
    return { driveSubfolderId: null, driveAccessToken: accessToken };
  }
  return {
    driveSubfolderId: subfolderId,
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

/** Rescanne les emails clients et n'importe que les pièces jointes pas encore enregistrées. */
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
  const importedKeys = getImportedGmailAttachmentKeys(dossier);
  const importedMessages = getImportedGmailMessageIds(dossier);
  let driveFilesByName = new Map<string, { fileId: string; webViewLink?: string | null }>();
  if (driveCtx.driveSubfolderId) {
    const { listDriveFilesInFolder } = await import("./gmailDriveUpload");
    driveFilesByName = await listDriveFilesInFolder(
      driveCtx.driveSubfolderId,
      driveCtx.driveAccessToken,
    );
  }

  for (const clientEmail of emails) {
    for (const q of buildGmailQueriesForDossier(dossier, clientEmail)) {
      const listRes = await gmail.users.messages.list({ userId: 'me', q, maxResults: 40 });
      for (const msgMeta of listRes.data.messages || []) {
        if (!msgMeta.id || seenMessageIds.has(msgMeta.id)) continue;
        seenMessageIds.add(msgMeta.id);
        scanned++;

        if (importedMessages.has(msgMeta.id)) continue;

        const msgRes = await gmail.users.messages.get({
          userId: 'me',
          id: msgMeta.id,
          format: 'full',
        });
        const payload = msgRes.data.payload;
        const parts = collectAttachmentParts(payload);
        attachmentPartsFound += parts.length;

        if (!parts.length) continue;

        const hasNewParts = parts.some((p) => !isGmailPartImported(importedKeys, msgMeta.id, p));
        if (!hasNewParts) {
          markGmailMessageAttachmentsHandled(dossier, msgMeta.id, parts);
          continue;
        }

        const { saved, errors: dlErrors, driveUploaded: du } = await downloadGmailAttachments(
          gmail,
          msgMeta.id,
          payload,
          dossier.id,
          {
            dossier,
            driveAccessToken: driveCtx.driveAccessToken,
            driveSubfolderId: driveCtx.driveSubfolderId,
            importedKeys,
            driveFilesByName,
          },
        );
        driveUploaded += du;
        errors.push(...dlErrors);
        const merged = mergeDocumentsIntoDossier(dossier, saved);
        markGmailMessageAttachmentsHandled(dossier, msgMeta.id, parts);
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

/**
 * Marque les mails déjà vus comme traités (sans retélécharger les PJ).
 * À utiliser une fois après nettoyage Drive pour stopper les ré-imports.
 */
export async function seedDossierGmailImportRegistry(
  accessToken: string | null,
  dossier: any,
): Promise<{ scanned: number; messagesMarked: number }> {
  const { auth } = await createGmailAuth(accessToken);
  const gmail = google.gmail({ version: "v1", auth: auth as any });
  const emails = getDossierClientEmails(dossier);
  const seenMessageIds = new Set<string>();
  let scanned = 0;
  let messagesMarked = 0;

  for (const clientEmail of emails) {
    for (const q of buildGmailQueriesForDossier(dossier, clientEmail)) {
      const listRes = await gmail.users.messages.list({ userId: "me", q, maxResults: 40 });
      for (const msgMeta of listRes.data.messages || []) {
        if (!msgMeta.id || seenMessageIds.has(msgMeta.id)) continue;
        seenMessageIds.add(msgMeta.id);
        scanned++;

        const msgRes = await gmail.users.messages.get({
          userId: "me",
          id: msgMeta.id,
          format: "full",
        });
        const parts = collectAttachmentParts(msgRes.data.payload);
        if (!parts.length) continue;

        markGmailMessageAttachmentsHandled(dossier, msgMeta.id, parts);
        messagesMarked++;
      }
    }
  }

  return { scanned, messagesMarked };
}

let gmailSyncRunning = false;

export async function syncGmailInbox(accessToken: string | null, db: any, aiCallback: Function) {
  if (gmailSyncRunning) {
    return {
      db,
      inboundCount: 0,
      processed: 0,
      aiReplies: 0,
      attachmentsSaved: 0,
      driveAttachmentsUploaded: 0,
      attachmentDebug: [] as Array<{ messageId: string; found: number; saved: number; drive: number }>,
      skippedConcurrent: true,
      dirtyDossierIds: [] as string[],
    };
  }
  gmailSyncRunning = true;
  try {
  const { auth, driveAccessToken } = await createGmailAuth(accessToken);
  const gmail = google.gmail({ version: 'v1', auth: auth as any });
  const dirtyDossierIds = new Set<string>();
  const markDossierDirty = (dossier: any) => {
    if (!dossier?.id) return;
    dirtyDossierIds.add(String(dossier.id));
    dossier.updatedAt = new Date().toISOString();
  };

  const clientEmails = new Set<string>();
  for (const d of db.dossiers || []) {
    for (const e of getDossierClientEmails(d)) clientEmails.add(e);
  }

  const processedIds = new Set<string>();
  /** Un seul traitement IA par dossier et par sync (évite 5 escalades sur l'historique Gmail). */
  const aiLockedDossierIds = new Set<string>();
  let inboundCount = 0;
  let aiReplies = 0;
  let attachmentsSaved = 0;
  let driveAttachmentsUploaded = 0;
  const attachmentDebug: Array<{ messageId: string; found: number; saved: number; drive: number }> = [];
  const dossierDriveFilesCache = new Map<
    string,
    Map<string, { fileId: string; webViewLink?: string | null }>
  >();

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

      const msgDate = new Date(Number(msgRes.data.internalDate || Date.now())).toISOString();
      const dossier = findDossierForGmailMessage(db, {
        senderEmail,
        toRaw,
        subject,
        messageDate: msgDate,
        isSentByMe,
      });
      if (!dossier) continue;

      const dossierEmails = getDossierClientEmails(dossier);
      const isFromClient = !isSentByMe && dossierEmails.includes(senderEmail);
      const isToClient = isSentByMe || dossierEmails.some((e) => toRaw.includes(e));

      if (!isFromClient && !isToClient) continue;

      const { text, html } = decodeEmailBodies(payload);
      const direction = isFromClient ? 'inbound' : 'outbound';

      let addedAttachments: any[] = [];
      if (isFromClient) {
        const importedKeys = getImportedGmailAttachmentKeys(dossier);
        const importedMessages = getImportedGmailMessageIds(dossier);
        const attachmentParts = collectAttachmentParts(payload);

        if (!importedMessages.has(msgMeta.id) && attachmentParts.length > 0) {
          const hasNewParts = attachmentParts.some(
            (p) => !isGmailPartImported(importedKeys, msgMeta.id, p),
          );

          if (hasNewParts) {
            let driveFilesByName = dossierDriveFilesCache.get(dossier.id);
            if (!driveFilesByName) {
              const driveCtx = await resolveGmailDriveUploadTarget(dossier, driveAccessToken);
              driveFilesByName = new Map();
              if (driveCtx.driveSubfolderId) {
                const { listDriveFilesInFolder } = await import("./gmailDriveUpload");
                driveFilesByName = await listDriveFilesInFolder(
                  driveCtx.driveSubfolderId,
                  driveCtx.driveAccessToken,
                );
              }
              dossierDriveFilesCache.set(dossier.id, driveFilesByName);
            }

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
                importedKeys,
                driveFilesByName,
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
                  meta: { source: 'gmail', gmailId: msgMeta.id, gmailImportKey: doc.gmailImportKey },
                });
              }
            }
          }
          markGmailMessageAttachmentsHandled(dossier, msgMeta.id, attachmentParts);
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
        html: html || undefined,
        attachments: addedAttachments.map((d) => ({ name: d.name, size: d.size })),
        date: msgDate,
      });

      if (isSentByMe && isToClient && !isFromClient) {
        const { acknowledgeStaffOutboundToClient } = await import("./camilleStaffHandoff");
        acknowledgeStaffOutboundToClient(dossier, {
          gmailId: msgMeta.id,
          source: "gmail_sync_outbound",
          subject,
        });
        try {
          const { applyStudyKpiFromGmailOutbound } = await import("./studyEmailKpi");
          applyStudyKpiFromGmailOutbound(dossier, {
            subject,
            html,
            text,
            gmailId: msgMeta.id,
            date: msgDate,
          });
        } catch (kpiErr: any) {
          console.warn(`[KPI] Extraction étude Gmail: ${kpiErr?.message || kpiErr}`);
        }
        const { hasStudyBeenSent } = await import("./dossierLifecycle");
        if (
          hasStudyBeenSent(dossier) &&
          !["MAIL_ENVOYÉ", "MAIL_ENVOYE", "TRAITÉ", "TRAITE", "CLOS"].includes(String(dossier.status))
        ) {
          dossier.status = "MAIL_ENVOYÉ";
        }
      }

      if (isFromClient) {
        inboundCount++;
        const alreadyHandled = getProcessedIds(dossier).has(msgMeta.id);
        const { hasUnansweredClientInbound } = await import("./gmailConversation");
        const unanswered = hasUnansweredClientInbound(dossier, msgMeta.id);

        if (!alreadyHandled) {
          const {
            wasTelegramNotifiedRecently,
            markTelegramNotified,
            telegramNotifyKey,
          } = await import("./telegramNotifyDedup");
          const tgKey = telegramNotifyKey(dossier.id, "client_message", msgMeta.id);
          if (!wasTelegramNotifiedRecently(dossier, tgKey, 24 * 60 * 60 * 1000)) {
            markTelegramNotified(dossier, tgKey);
            const attNote =
              addedAttachments.length > 0
                ? `Pièces jointes : ${addedAttachments.map((d) => d.name).join(", ")}`
                : undefined;
            void import("./telegramNotify")
              .then(({ notifyTelegramClientInbound }) =>
                notifyTelegramClientInbound({
                  dossier,
                  clientEmail: senderEmail,
                  subject,
                  excerpt: String(text || "").slice(0, 500),
                  gmailId: msgMeta.id,
                  extra: attNote,
                }),
              )
              .catch(() => undefined);
          }
        }

        const shouldReply =
          isAiAutoReplyEnabled() && (!alreadyHandled || unanswered);

        if (shouldReply) {
          if (aiLockedDossierIds.has(dossier.id)) continue;

          const sendGate = canCamilleEmailClient(dossier, {
            allowIfUnansweredInbound: true,
          });

          if (!sendGate.ok && sendGate.reason === "staff_handling") {
            if (!alreadyHandled) markProcessed(dossier, msgMeta.id);
            addEvent(dossier, {
              type: "AI_DECISION",
              actor: { kind: "AI", label: "Camille" },
              message: "Réponse auto reportée (équipe en cours sur le fil).",
              meta: { gmailId: msgMeta.id },
            });
            continue;
          }

          if (!acquireCamilleClientEmailLock(dossier.id)) continue;

          aiLockedDossierIds.add(dossier.id);
          try {
            const { normalizeDossierDocumentsForPersistence } = await import(
              "./documentStoragePolicy"
            );
            normalizeDossierDocumentsForPersistence(dossier);
            markDossierDirty(dossier);

            const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
            const finishInbound = () => markProcessed(dossier, msgMeta.id);

            if (isBusinessHoursGateEnabled() && !isWithinBusinessHours()) {
              const outOfHours = [
                `Merci pour votre message. Nous avons bien reçu votre demande.`,
                `Notre équipe vous répondra dès la prochaine plage d'ouverture.`,
              ].join("\n");
              const { wrapCamilleHtmlReply } = await import("./camilleMail");
              const nom = dossier.formData?.assures?.[0]?.nom || "";
              const prenom = dossier.formData?.assures?.[0]?.prenom || "";
              const html = wrapCamilleHtmlReply(outOfHours, prenom, nom);
              const sent = await sendEmailReplyWithGmailAPI(
                accessToken,
                clientEmail,
                replySubject,
                html,
              );
              if (sent.ok) {
                finishInbound();
                markDossierDirty(dossier);
                upsertCommunication(dossier, {
                  id: `msg_ack_${msgMeta.id}`,
                  gmailId: sent.messageId,
                  direction: "outbound",
                  from: "Camille (IA)",
                  to: clientEmail,
                  subject: replySubject,
                  text: outOfHours,
                  date: new Date().toISOString(),
                });
                addEvent(dossier, {
                  type: "AI_DECISION",
                  actor: { kind: "AI", label: "Camille" },
                  message: "Accusé de réception hors horaires envoyé au client.",
                  meta: { gmailId: msgMeta.id },
                });
              } else {
                console.warn(`[Gmail] Échec envoi hors horaires → ${clientEmail}: ${sent.error}`);
              }
              continue;
            }

            if (!sendGate.ok && sendGate.reason === "cooldown") {
              const ack = [
                `Merci pour votre message, nous avons bien reçu votre email.`,
                `Nous revenons vers vous très prochainement avec une réponse détaillée.`,
              ].join("\n");
              const { wrapCamilleHtmlReply } = await import("./camilleMail");
              const nom = dossier.formData?.assures?.[0]?.nom || "";
              const prenom = dossier.formData?.assures?.[0]?.prenom || "";
              const html = wrapCamilleHtmlReply(ack, prenom, nom);
              const sent = await sendEmailReplyWithGmailAPI(
                accessToken,
                clientEmail,
                replySubject,
                html,
              );
              if (sent.ok) {
                finishInbound();
                markDossierDirty(dossier);
                upsertCommunication(dossier, {
                  id: `msg_ack_${msgMeta.id}`,
                  gmailId: sent.messageId,
                  direction: "outbound",
                  from: "Camille (IA)",
                  to: clientEmail,
                  subject: replySubject,
                  text: ack,
                  date: new Date().toISOString(),
                });
                addEvent(dossier, {
                  type: "AI_DECISION",
                  actor: { kind: "AI", label: "Camille" },
                  message: "Accusé de réception envoyé (cooldown actif).",
                  meta: { gmailId: msgMeta.id },
                });
              } else {
                console.warn(`[Gmail] Échec envoi accusé cooldown → ${clientEmail}: ${sent.error}`);
              }
              continue;
            }

            if (!sendGate.ok) {
              addEvent(dossier, {
                type: "AI_DECISION",
                actor: { kind: "AI", label: "Camille" },
                message: `Réponse auto non envoyée (${sendGate.reason}).`,
                meta: { gmailId: msgMeta.id, reason: sendGate.reason },
              });
              continue;
            }

            const { ensureSubscriptionProgressOnAcceptance } = await import("./subscriptionProgress");
            if (ensureSubscriptionProgressOnAcceptance(dossier)) {
              markDossierDirty(dossier);
            }

            await sleep(45_000 + Math.floor(Math.random() * 135_000));

            const aiDecision = await aiCallback(dossier, text, senderEmail, {
              newAttachmentNames: addedAttachments.map((d) => d.name),
              emailSubject: subject,
              allDossiers: db.dossiers,
            });
            if (aiDecision?.status === "replied" && aiDecision.text) {
              const sendResult = await sendEmailReplyWithGmailAPI(
                accessToken,
                clientEmail,
                replySubject,
                aiDecision.text,
              );
              if (!sendResult.ok) {
                console.warn(
                  `[Gmail] Échec envoi réponse Camille → ${clientEmail}: ${sendResult.error}`,
                );
                addEvent(dossier, {
                  type: "EMAIL_FAILED",
                  actor: { kind: "AI", label: "Camille" },
                  message: "Échec envoi réponse automatique.",
                  meta: { gmailId: msgMeta.id, error: sendResult.error },
                });
                markDossierDirty(dossier);
              }
              if (sendResult.ok) {
                aiReplies++;
                finishInbound();
                markDossierDirty(dossier);
                cancelScheduledDocFollowUp(dossier.id);
                upsertCommunication(dossier, {
                  id: `msg_ai_${msgMeta.id}`,
                  gmailId: sendResult.messageId,
                  direction: "outbound",
                  from: "Camille (IA)",
                  to: clientEmail,
                  subject: replySubject,
                  text: aiDecision.text,
                  date: new Date().toISOString(),
                });
                addEvent(dossier, {
                  type: "AI_DECISION",
                  actor: { kind: "AI", label: "Camille" },
                  message: "Réponse automatique envoyée au client.",
                  meta: { gmailId: msgMeta.id },
                });
                dossier.status = "EN_COURS";
                void import("./telegramNotify")
                  .then(({ notifyTelegramCamilleReplied }) =>
                    notifyTelegramCamilleReplied({
                      dossier,
                      subject: replySubject,
                      gmailId: sendResult.messageId || msgMeta.id,
                    }),
                  )
                  .catch(() => undefined);
                void import("./aiAuditLog")
                  .then(({ logAiAudit }) =>
                    logAiAudit(dossier, {
                      action: "AUTO_REPLY_CLIENT",
                      channel: "gmail",
                      actor: "Camille",
                      outcome: "sent",
                      model: "gemini",
                      summary: "Réponse automatique au client.",
                      meta: { gmailId: msgMeta.id },
                    }),
                  )
                  .catch(() => undefined);
              }
            } else if (aiDecision?.status === "escalated") {
              finishInbound();
              const { handleCamilleEscalation } = await import("./camilleEscalation");
              await handleCamilleEscalation({
                dossier,
                accessToken,
                clientEmail,
                clientPrenom: dossier.formData?.assures?.[0]?.prenom,
                subject,
                reason: String(aiDecision.reason || "Escalade"),
                clientMessageText: text,
                gmailId: msgMeta.id,
              });
            }
          } catch (err: any) {
            console.error("[AI] Erreur traitement email:", err);
          } finally {
            releaseCamilleClientEmailLock(dossier.id);
          }
        } else if (!alreadyHandled) {
          markProcessed(dossier, msgMeta.id);
          markDossierDirty(dossier);
        }
      }

      markDossierDirty(dossier);
    }
  }

  let staffEscalationHandled = 0;
  try {
    const { syncStaffEscalationReplyEmails } = await import("./camilleEscalationReply");
    staffEscalationHandled = await syncStaffEscalationReplyEmails(gmail, db, processedIds, {
      getProcessedIds,
      markProcessed,
      upsertCommunication,
    });
  } catch (err: any) {
    console.warn(`[Gmail] Sync réponses escalade équipe: ${err?.message || err}`);
  }

  return {
    db,
    inboundCount,
    processed: processedIds.size,
    aiReplies,
    attachmentsSaved,
    driveAttachmentsUploaded,
    attachmentDebug,
    staffEscalationHandled,
    dirtyDossierIds: [...dirtyDossierIds],
  };
  } finally {
    gmailSyncRunning = false;
  }
}

export async function sendEmailReplyWithGmailAPI(
  accessToken: string | null,
  toEmail: string,
  subject: string,
  bodyText: string,
  options?: { cc?: string[] },
) {
  const { auth } = await createGmailAuth(accessToken);
  const gmail = google.gmail({ version: 'v1', auth: auth as any });

  const isHtml = /<[a-z][\s\S]*>/i.test(bodyText);
  const mailLines = [];

  mailLines.push(`To: ${toEmail}`);
  const cc = (options?.cc || []).filter(Boolean);
  if (cc.length) {
    mailLines.push(`Cc: ${cc.join(", ")}`);
  }
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
