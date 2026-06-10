import { addEvent } from "./dossierModel";
import { isLeadDossier } from "./leadDossierMerge";
import {
  buildInsurerGmailQuery,
  classifyInboundEmail,
  extractEmailAddress,
  isInsurerSender,
} from "./inboundEmailClassifier";
import {
  collectAttachmentParts,
  downloadGmailAttachments,
  findDossierByLcifReference,
  getImportedGmailAttachmentKeys,
  getImportedGmailMessageIds,
  isGmailPartImported,
  isGmailPartInDossierDocuments,
  markGmailMessageAttachmentsHandled,
  mergeDocumentsIntoDossier,
} from "./gmailAttachments";
import { finalizeGmailDocumentImport } from "./dossierDocumentSync";

function headerValue(headers: any[] | undefined, name: string): string {
  const h = headers?.find((x: any) => String(x.name || "").toLowerCase() === name.toLowerCase());
  return String(h?.value || "");
}

/** Ingestion des mails assureurs / Kereis vers le dossier (LCIF dans objet ou corps). Pas de réponse Camille. */
export async function syncInsurerInboundEmails(
  gmail: any,
  db: { dossiers: any[] },
  deps: {
    processedIds: Set<string>;
    decodeEmailBodies: (payload: any) => { text: string; html: string };
    upsertCommunication: (d: any, msg: any) => boolean;
    markDossierDirty: (d: any) => void;
    driveAccessToken: string | null;
    resolveGmailDriveUploadTarget: (
      dossier: any,
      driveAccessToken: string | null,
    ) => Promise<{ driveAccessToken: string | null; driveSubfolderId?: string | null }>;
    dossierDriveFilesCache: Map<string, Map<string, { fileId: string; webViewLink?: string | null }>>;
  },
): Promise<number> {
  const q = buildInsurerGmailQuery();
  const listRes = await gmail.users.messages.list({ userId: "me", q, maxResults: 40 });
  const messages = listRes.data.messages || [];
  let handled = 0;

  for (const msgMeta of messages) {
    if (!msgMeta.id || deps.processedIds.has(msgMeta.id)) continue;

    const msgRes = await gmail.users.messages.get({
      userId: "me",
      id: msgMeta.id,
      format: "full",
    });
    const payload = msgRes.data.payload;
    if (!payload?.headers) continue;

    const labelIds = msgRes.data.labelIds || [];
    if (labelIds.includes("SENT")) continue;

    const fromRaw = headerValue(payload.headers, "From");
    const subject = headerValue(payload.headers, "Subject");
    const senderEmail = extractEmailAddress(fromRaw);
    if (!senderEmail || !isInsurerSender(senderEmail, fromRaw)) continue;

    const classification = classifyInboundEmail({
      fromRaw,
      subject,
      toRaw: headerValue(payload.headers, "To"),
      deliveredToRaw: headerValue(payload.headers, "Delivered-To"),
      autoSubmitted: headerValue(payload.headers, "Auto-Submitted"),
      precedence: headerValue(payload.headers, "Precedence"),
      listUnsubscribe: headerValue(payload.headers, "List-Unsubscribe"),
    });
    if (classification.category !== "insurer") continue;

    const { text, html } = deps.decodeEmailBodies(payload);
    const dossier =
      findDossierByLcifReference(db, subject) ||
      findDossierByLcifReference(db, text.slice(0, 4000));
    if (!dossier || isLeadDossier(dossier)) {
      console.log(
        `[Gmail sync] mail assureur ignoré — dossier introuvable (${senderEmail}, « ${subject.slice(0, 50)} »)`,
      );
      deps.processedIds.add(msgMeta.id);
      continue;
    }

    deps.processedIds.add(msgMeta.id);
    let msgChanged = false;

    const msgDate = new Date(Number(msgRes.data.internalDate || Date.now())).toISOString();
    if (
      deps.upsertCommunication(dossier, {
        id: `msg_insurer_${msgMeta.id}`,
        gmailId: msgMeta.id,
        direction: "inbound",
        from: senderEmail,
        subject,
        text,
        html: html || undefined,
        date: msgDate,
        meta: { source: "insurer", insurerDomain: senderEmail.split("@")[1] },
      } as any)
    ) {
      msgChanged = true;
    }

    const attachmentParts = collectAttachmentParts(payload);
    if (attachmentParts.length > 0) {
      const importedKeys = getImportedGmailAttachmentKeys(dossier);
      const importedMessages = getImportedGmailMessageIds(dossier);
      if (
        !importedMessages.has(msgMeta.id) &&
        attachmentParts.some(
          (p) =>
            !isGmailPartImported(importedKeys, msgMeta.id, p) ||
            !isGmailPartInDossierDocuments(dossier, msgMeta.id, p),
        )
      ) {
        let driveFilesByName = deps.dossierDriveFilesCache.get(dossier.id);
        if (!driveFilesByName) {
          const driveCtx = await deps.resolveGmailDriveUploadTarget(dossier, deps.driveAccessToken);
          driveFilesByName = new Map();
          if (driveCtx.driveSubfolderId) {
            const { listDriveFilesInFolder } = await import("./gmailDriveUpload");
            driveFilesByName = await listDriveFilesInFolder(
              driveCtx.driveSubfolderId,
              driveCtx.driveAccessToken,
            );
          }
          deps.dossierDriveFilesCache.set(dossier.id, driveFilesByName);
        }
        const driveCtx = await deps.resolveGmailDriveUploadTarget(dossier, deps.driveAccessToken);
        const { saved } = await downloadGmailAttachments(
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
        const added = mergeDocumentsIntoDossier(dossier, saved);
        finalizeGmailDocumentImport(dossier, { driveFilesByName });
        markGmailMessageAttachmentsHandled(dossier, msgMeta.id, attachmentParts);
        if (added.length) {
          msgChanged = true;
          for (const doc of added) {
            addEvent(dossier, {
              type: "DOCUMENT_UPLOADED",
              actor: { kind: "SYSTEM" },
              message: `Pièce jointe assureur reçue : ${doc.name}`,
              meta: { source: "insurer_gmail", gmailId: msgMeta.id },
            });
          }
        }
      }
    }

    if (msgChanged) {
      addEvent(dossier, {
        type: "NOTE_ADDED",
        actor: { kind: "SYSTEM", label: "Assureur" },
        message: `Mail assureur reçu — ${subject.slice(0, 120)}`,
        meta: { template: "INSURER_INBOUND", from: senderEmail, gmailId: msgMeta.id },
      });
      deps.markDossierDirty(dossier);
      handled += 1;
      console.log(`[Gmail sync] mail assureur rattaché → ${dossier.id} (${senderEmail})`);
    }
  }

  return handled;
}
