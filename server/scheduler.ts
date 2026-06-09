import { readDB, writeDirtyDossiers } from "./db";
import { addEvent, Dossier, EmailMessage, newId } from "./dossierModel";
import { detectMissingDocs, getPrimaryClientEmail } from "./rules";
import { shouldSendScheduledReminder } from "./smartReminders";
import { logAiAudit } from "./aiAuditLog";
import { sendEmail } from "./emailProvider";
import { templateGenericFollowup, templateMissingDocsFollowup } from "./emailTemplates";
import {
  getGmailAutosyncIntervalMs,
  isCamilleTestMode,
  isGmailAutosyncWindowOpen,
  isRailwayEcoMode,
} from "./businessHours";
import { syncGmailInbox } from "./mailAutomation";
import { processIncomingClientEmail } from "./aiAssistant";
import { canUseDomainWideDelegation } from "./googleDelegatedAuth";
import { hasServerOAuthRefreshToken } from "./googleOAuthServer";
import { sendEscalationReminderToRemi } from "./camilleEscalation";

let gmailSyncInProgress = false;

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
  const dirtyIds = new Set<string>();

  for (const dossier of db.dossiers) {
    if (!dossier.tasks || dossier.tasks.length === 0) continue;
    const due = dossier.tasks.filter(t => t.status === "PENDING" && new Date(t.dueAt).getTime() <= Date.now());
    if (due.length === 0) continue;

    for (const task of due) {
      processed += 1;
      dirtyIds.add(dossier.id);
      task.attempts += 1;
      task.lastAttemptAt = new Date().toISOString();

      try {
        if (task.type === "INTERNAL_ALERT") {
          const kind = String(task.payload?.kind || "");
          if (kind === "ESCALATION_FOLLOWUP") {
            const stillWaiting =
              dossier.status === "EN_ATTENTE_CLIENT" && Boolean(dossier.camilleEscalation?.lastAt);
            if (!stillWaiting) {
              task.status = "DONE";
              addEvent(dossier, {
                type: "REMINDER_SENT",
                actor: { kind: "SYSTEM" },
                message: "Rappel escalade annulé (dossier repris ou statut changé).",
              });
              continue;
            }
            const r = await sendEscalationReminderToRemi(dossier, task.payload || {});
            if (r.ok) {
              task.status = "DONE";
              sent += 1;
              addEvent(dossier, {
                type: "EMAIL_SENT",
                actor: { kind: "SYSTEM" },
                message: "Rappel escalade Camille envoyé à Rémi.",
              });
            } else {
              task.lastError = r.error || "Échec rappel escalade";
              failed += 1;
            }
          } else {
            task.status = "DONE";
            task.lastError = `INTERNAL_ALERT inconnu: ${kind || "—"}`;
          }
          continue;
        }

        const to = getPrimaryClientEmail(dossier);
        if (!to) {
          task.lastError = "Client email introuvable";
          continue;
        }

        if (task.type === "FOLLOWUP_MISSING_DOCS") {
          const gate = shouldSendScheduledReminder(dossier, "FOLLOWUP_MISSING_DOCS");
          if (!gate.ok) {
            task.status = "DONE";
            addEvent(dossier, {
              type: "REMINDER_SENT",
              actor: { kind: "SYSTEM" },
              message: `Relance annulée : ${gate.reason}`,
            });
            logAiAudit(dossier, {
              action: "RELANCE_MISSING_DOCS_SKIPPED",
              channel: "scheduler",
              actor: "Système",
              outcome: "skipped",
              summary: gate.reason,
            });
            continue;
          }
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
          const gate = shouldSendScheduledReminder(dossier, "FOLLOWUP_NO_REPLY");
          if (!gate.ok) {
            task.status = "DONE";
            addEvent(dossier, {
              type: "REMINDER_SENT",
              actor: { kind: "SYSTEM" },
              message: `Relance annulée : ${gate.reason}`,
            });
            logAiAudit(dossier, {
              action: "RELANCE_NO_REPLY_SKIPPED",
              channel: "scheduler",
              actor: "Système",
              outcome: "skipped",
              summary: gate.reason,
            });
            continue;
          }
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

  if (dirtyIds.size > 0) {
    await writeDirtyDossiers(db, dirtyIds);
  }
  return { processed, sent, failed };
}

export function startScheduler() {
  const enabled = ((process.env as any).SCHEDULER_ENABLED || "true").toLowerCase() === "true";
  const intervalMs = Number(
    (process.env as any).SCHEDULER_INTERVAL_MS ||
      (isRailwayEcoMode() ? 300_000 : 60_000),
  );
  if (!enabled) return;
  if (isCamilleTestMode()) {
    console.log("[Camille] Mode test actif — sync Gmail 24h/24, cooldown réduit, réponses plus rapides.");
  }
  setInterval(() => {
    runSchedulerOnce().catch(() => undefined);
  }, intervalMs);

  // Autosync Gmail (sync + réponses Camille)
  const gmailEnabled = ((process.env as any).GMAIL_AUTOSYNC_ENABLED || "true").toLowerCase() === "true";
  const gmailIntervalMs = getGmailAutosyncIntervalMs();
  if (gmailEnabled) {
    setInterval(() => {
      if (gmailSyncInProgress) return;
      if (!isGmailAutosyncWindowOpen()) return;
      if (!hasServerOAuthRefreshToken() && !canUseDomainWideDelegation()) return;
      gmailSyncInProgress = true;
      readDB()
        .then((db) => syncGmailInbox(null, db, processIncomingClientEmail))
        .then(async ({ db, inboundCount, aiReplies, dirtyDossierIds }) => {
          if (inboundCount > 0 || aiReplies > 0) {
            console.log(`[Gmail autosync] inbound=${inboundCount} aiReplies=${aiReplies}`);
          }
          const { written, failed } = await writeDirtyDossiers(db, dirtyDossierIds || []);
          if (failed > 0) {
            console.warn(`[Gmail autosync] Firestore: ${written} dossier(s) OK, ${failed} échec(s).`);
          }
        })
        .catch((err) => console.error("[Gmail autosync]", err?.message || err))
        .finally(() => {
          gmailSyncInProgress = false;
        });
    }, gmailIntervalMs);
  }

  const { startOpsDailyReportScheduler } = require("./opsDailyReport") as typeof import("./opsDailyReport");
  startOpsDailyReportScheduler();
}

