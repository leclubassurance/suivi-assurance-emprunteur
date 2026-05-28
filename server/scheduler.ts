import { readDB, writeDB } from "./db";
import { addEvent, Dossier, EmailMessage, newId } from "./dossierModel";
import { detectMissingDocs, getPrimaryClientEmail } from "./rules";
import { sendEmail } from "./emailProvider";
import { templateGenericFollowup, templateMissingDocsFollowup } from "./emailTemplates";
import { syncGmailInbox } from "./mailAutomation";
import { processIncomingClientEmail } from "./aiAssistant";
import { canUseDomainWideDelegation } from "./googleDelegatedAuth";
import { hasServerOAuthRefreshToken } from "./googleOAuthServer";

export type SchedulerRunResult = {
  processed: number;
  sent: number;
  failed: number;
};

function enqueueEmail(dossier: Dossier, email: Omit<EmailMessage, "id" | "createdAt" | "status">) {
  if (!dossier.emails) dossier.emails = [];
  const msg: EmailMessage = {
    id: newId("email"),
    createdAt: new Date().toISOString(),
    status: "QUEUED",
    template: email.template,
    to: email.to,
    subject: email.subject,
    html: email.html,
  };
  dossier.emails.push(msg);
  return msg;
}

export async function runSchedulerOnce(): Promise<SchedulerRunResult> {
  const db = await readDB();
  let processed = 0;
  let sent = 0;
  let failed = 0;

  for (const dossier of db.dossiers) {
    if (!dossier.tasks || dossier.tasks.length === 0) continue;
    const due = dossier.tasks.filter(t => t.status === "PENDING" && new Date(t.dueAt).getTime() <= Date.now());
    if (due.length === 0) continue;

    for (const task of due) {
      processed += 1;
      task.attempts += 1;
      task.lastAttemptAt = new Date().toISOString();

      const to = getPrimaryClientEmail(dossier);
      if (!to) {
        task.lastError = "Client email introuvable";
        continue;
      }

      try {
        if (task.type === "FOLLOWUP_MISSING_DOCS") {
          const missing = detectMissingDocs(dossier);
          if (missing.length === 0) {
            task.status = "DONE";
            addEvent(dossier, { type: "REMINDER_SENT", actor: { kind: "SYSTEM" }, message: "Relance ignorée (pièces complètes)." });
            continue;
          }
          const stage = Number(task.payload?.stage || 1);
          const html = templateMissingDocsFollowup(dossier, missing, stage);
          const subject = `Relance ${stage} - Documents manquants — Dossier ${dossier.id}`;
          const queued = enqueueEmail(dossier, { template: "FOLLOWUP_MISSING_DOCS", to, subject, html });
          const r = await sendEmail({ to, subject, html });
          if ("error" in r) {
            const error = r.error;
            queued.status = "FAILED";
            queued.error = error;
            task.lastError = error;
            failed += 1;
            addEvent(dossier, { type: "EMAIL_FAILED", actor: { kind: "SYSTEM" }, meta: { emailId: queued.id, template: queued.template, to, error } });
          } else {
            queued.status = "SENT";
            queued.sentAt = new Date().toISOString();
            queued.providerId = r.providerId;
            task.status = "DONE";
            sent += 1;
            addEvent(dossier, { type: "EMAIL_SENT", actor: { kind: "SYSTEM" }, meta: { emailId: queued.id, template: queued.template, to } });
          }
        } else if (task.type === "FOLLOWUP_NO_REPLY") {
          const html = templateGenericFollowup(dossier, "Nous revenons vers vous pour savoir si vous avez pu consulter notre message. Vous pouvez répondre directement à ce mail.");
          const subject = `Relance — Dossier ${dossier.id}`;
          const queued = enqueueEmail(dossier, { template: "FOLLOWUP_NO_REPLY", to, subject, html });
          const r = await sendEmail({ to, subject, html });
          if ("error" in r) {
            const error = r.error;
            queued.status = "FAILED";
            queued.error = error;
            task.lastError = error;
            failed += 1;
            addEvent(dossier, { type: "EMAIL_FAILED", actor: { kind: "SYSTEM" }, meta: { emailId: queued.id, template: queued.template, to, error } });
          } else {
            queued.status = "SENT";
            queued.sentAt = new Date().toISOString();
            queued.providerId = r.providerId;
            task.status = "DONE";
            sent += 1;
            addEvent(dossier, { type: "EMAIL_SENT", actor: { kind: "SYSTEM" }, meta: { emailId: queued.id, template: queued.template, to } });
          }
        } else {
          task.lastError = `Type de task inconnu: ${task.type}`;
        }
      } catch (err: any) {
        task.lastError = err?.message || String(err);
        failed += 1;
      }
    }
  }

  await writeDB(db);
  return { processed, sent, failed };
}

export function startScheduler() {
  const enabled = ((process.env as any).SCHEDULER_ENABLED || "true").toLowerCase() === "true";
  const intervalMs = Number((process.env as any).SCHEDULER_INTERVAL_MS || 60_000);
  if (!enabled) return;
  setInterval(() => {
    runSchedulerOnce().catch(() => undefined);
  }, intervalMs);

  // Autosync Gmail autonome (sans connexion admin) via service account + délégation domaine
  const gmailEnabled = ((process.env as any).GMAIL_AUTOSYNC_ENABLED || "true").toLowerCase() === "true";
  const gmailIntervalMs = Number((process.env as any).GMAIL_AUTOSYNC_INTERVAL_MS || 120_000);
  if (gmailEnabled) {
    setInterval(() => {
      // accessToken=null => refresh_token OAuth serveur (ou DWD si activé)
      if (!hasServerOAuthRefreshToken() && !canUseDomainWideDelegation()) return;
      readDB()
        .then((db) => syncGmailInbox(null, db, processIncomingClientEmail))
        .then(({ db }) => writeDB(db))
        .catch(() => undefined);
    }, gmailIntervalMs);
  }
}

