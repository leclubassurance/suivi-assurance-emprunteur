import express from "express";
import path from "path";
import multer from "multer";
import fs from "fs";
import cors from "cors";
import rateLimit from "express-rate-limit";

import {
  exportDossierToGoogleWorkspace,
  deleteDossierFromGoogleWorkspace,
} from "./googleAutomation";
import { sendEmailReplyWithGmailAPI } from "./mailAutomation";
import {
  processIncomingClientEmail,
  generateInsuranceStudyMail,
} from "./aiAssistant";
import {
  initFirebaseSync,
  getFirebaseStatus,
} from "./firebaseSync";
import { readDB, writeDB, getDataStoreMode, deleteDossierFromStore } from "./db";
import { addEvent, ensureDossierShape, newId, scheduleTask } from "./dossierModel";
import { runSchedulerOnce, startScheduler } from "./scheduler";
import { isEmailConfigured, sendEmail } from "./emailProvider";
import { auditAiDecision, proposeNextActions } from "./nextActionEngine";
import { RAILWAY_BUILD_ID } from "./buildInfo";
import { LCIF_EMAIL_LOGO_HEADER_IMG } from "../shared/emailBrand";
import { DRIVE_CONFIG_VERSION, resolveDriveParentFolderId } from "./driveConfig";
import { mergeFormDocumentsWithUploads } from "./documentMerge";
import { canUseDomainWideDelegation } from "./googleDelegatedAuth";
import { hasServerOAuthRefreshToken } from "./googleOAuthServer";
import { getServerAccessToken } from "./googleOAuthServer";
import {
  hasServiceAccountConfigured,
  hasServiceAccountReady,
  loadServiceAccountDetails,
} from "./serviceAccount";

function getRuntimeDataDir() {
  // Vercel serverless + Railway : disque éphémère → /tmp
  if (process.env.VERCEL || process.env.RAILWAY_ENVIRONMENT) {
    return "/tmp/data";
  }
  return path.join(process.cwd(), "data");
}

let schedulerStarted = false;
let firebaseInitPromise: Promise<void> | null = null;
function ensureBackgroundServicesStarted() {
  if (!firebaseInitPromise) {
    firebaseInitPromise = initFirebaseSync().catch((err) => {
      console.error("initFirebaseSync failed", err);
    }) as Promise<void>;
  }
  if (!schedulerStarted && !process.env.VERCEL) {
    // Avoid long-running timers on serverless.
    startScheduler();
    schedulerStarted = true;
    const { scheduleRgpdRegisterSyncOnBoot } = require("./rgpdGoogleSheets") as typeof import("./rgpdGoogleSheets");
    scheduleRgpdRegisterSyncOnBoot((msg) => console.log(msg));
  }
  return firebaseInitPromise;
}

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(cors());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // Rate limiting:
  // - allow frequent admin polling on GET /api/dossiers
  // - protect public POST /api/dossiers (form submissions)
  const listDossiersLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600, // ~1 req / 1.5s per IP for 15 min
    message: { error: "Trop de requêtes, veuillez réessayer plus tard." },
    validate: false,
  });
  const createDossierLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60, // protect against spam while allowing retries
    message: { error: "Trop de requêtes, veuillez réessayer plus tard." },
    validate: false,
  });

  const DATA_DIR = getRuntimeDataDir();
  const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
  const LOG_FILE = path.join(DATA_DIR, "log.txt");

  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  } catch (err) {
    console.error("Failed to init data dirs", err);
  }

  function appendLog(message: string) {
    const time = new Date().toISOString();
    try {
      fs.appendFileSync(LOG_FILE, `[${time}] ${message}\n`, "utf-8");
    } catch (err) {
      console.error("Log write failed", err);
    }
    console.log(`[${time}] ${message}`);
  }

  app.use((req, _res, next) => {
    appendLog(
      `${req.method} ${req.url} - Content-Length: ${req.headers["content-length"] || 0} - IP: ${req.ip}`,
    );
    next();
  });

  let latestAccessToken = "";
  app.use((req, _res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      latestAccessToken = authHeader.split(" ")[1] || "";
    }
    next();
  });

  async function readDBAsync() {
    return readDB();
  }

  const storage = multer.diskStorage({
    destination: function (req, _file, cb) {
      const dossierId = (req.params as any).id || (req.params as any).dossierId || "unknown";
      const dir = path.join(UPLOADS_DIR, dossierId);
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      } catch (err) {
        console.error("Failed to create upload dir", err);
      }
      cb(null, dir);
    },
    filename: function (_req, file, cb) {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
      cb(null, `${Date.now()}_${safeName}`);
    },
  });
  const upload = multer({ storage });
  const quoteUpload = multer({ storage });
  const adminDocUpload = multer({ storage });

  // --- API ROUTES ---

  app.post("/api/telegram/webhook", async (req, res) => {
    const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
    if (secret && req.headers["x-telegram-bot-api-secret-token"] !== secret) {
      console.warn("[Telegram webhook] secret mismatch — refusé");
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json({ ok: true });
    const { handleTelegramWebhookUpdate } = await import("./telegramCamille");
    handleTelegramWebhookUpdate(req.body).catch((e: any) => {
      console.error("[Telegram webhook]", e?.message || e);
    });
  });

  app.get("/api/telegram/status", async (req, res) => {
    const setupSecret = String(process.env.TELEGRAM_SETUP_SECRET || "").trim();
    if (!setupSecret || req.query.secret !== setupSecret) {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      const { getTelegramWebhookInfo, isTelegramEnabled } = await import("./telegramCamille");
      const info = await getTelegramWebhookInfo();
      res.json({ ...info, telegramOperational: isTelegramEnabled() });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  /** Une fois le bot créé : GET /api/telegram/setup-webhook?secret=... pour enregistrer l'URL Railway */
  app.get("/api/telegram/setup-webhook", async (req, res) => {
    const setupSecret = String(process.env.TELEGRAM_SETUP_SECRET || "").trim();
    if (!setupSecret || req.query.secret !== setupSecret) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const base =
      String(process.env.APP_URL || process.env.VITE_API_URL || "").trim() ||
      `https://${req.get("host")}`;
    try {
      const { registerTelegramWebhook } = await import("./telegramCamille");
      const url = await registerTelegramWebhook(base);
      res.json({ ok: true, webhookUrl: url });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  app.get("/api/health", async (_req, res) => {
    await ensureBackgroundServicesStarted();
    const resolved = resolveDriveParentFolderId();
    const sa = loadServiceAccountDetails();
    const firebase = await getFirebaseStatus();
    const saReady = hasServiceAccountReady();
    res.json({
      status: "ok",
      build: RAILWAY_BUILD_ID,
      deploySource: "tsx-server.ts",
      gitCommit: process.env.RAILWAY_GIT_COMMIT_SHA || null,
      gitBranch: process.env.RAILWAY_GIT_BRANCH || null,
      dataStore: getDataStoreMode(),
      firebase,
      adminAuthEmail: "assurance@leclubimmobilier.fr",
      driveConfigVersion: DRIVE_CONFIG_VERSION,
      effectiveDriveParentId: resolved.parentId,
      rawDriveParentEnv: resolved.rawEnv,
      driveParentAutoCorrected: resolved.autoCorrected,
      hasServiceAccountEnv: hasServiceAccountConfigured(),
      hasServiceAccountReady: saReady,
      // rétrocompat ancien health
      hasServiceAccount: saReady,
      serviceAccountEmail: sa.clientEmail,
      serviceAccountSource: sa.source,
      serviceAccountParseError: sa.parseError,
      telegram: {
        botToken: (await import("./telegramCamille")).hasTelegramBotToken(),
        operational: (await import("./telegramCamille")).isTelegramEnabled(),
      },
    });
  });

  app.post("/api/dossiers", createDossierLimiter, upload.array("documents"), async (req, res) => {
    await ensureBackgroundServicesStarted();
    try {
      const formData = JSON.parse((req.body as any).formData);
      const { parsePrivacyConsentFromForm } = await import("./privacyConsent");
      const consentParsed = parsePrivacyConsentFromForm(formData, req);
      if (consentParsed.ok === false) {
        return res.status(400).json({ error: consentParsed.error });
      }
      const privacyConsentRecord = consentParsed.record;
      const db = await readDBAsync();

      const documents = mergeFormDocumentsWithUploads(
        Array.isArray(formData.documents) ? formData.documents : [],
        (req.files as Express.Multer.File[]) || [],
      );

      const { privacyConsent: _clientConsent, ...formDataWithoutConsent } = formData || {};
      const newDossier = ensureDossierShape({
        id:
          formData.id ||
          `LCIF-${Math.floor(Math.random() * 1000000)
            .toString()
            .padStart(6, "0")}`,
        status: "NOUVEAU",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        formData: { ...formDataWithoutConsent, documents },
        privacyConsent: privacyConsentRecord,
        communications: [],
        tasks: [],
        emails: [],
        notes: [],
        eventLog: [],
      });
      addEvent(newDossier, {
        type: "DOSSIER_CREATED",
        actor: { kind: "SYSTEM" },
        message: "Dossier créé via formulaire client.",
      });
      addEvent(newDossier, {
        type: "PRIVACY_CONSENT_RECORDED",
        actor: { kind: "SYSTEM" },
        message: "Consentement politique de confidentialité enregistré.",
        meta: {
          policyVersion: privacyConsentRecord.policyVersion,
          acceptedAt: privacyConsentRecord.acceptedAt,
        },
      });

      const {
        ensureClientPortalToken,
        getClientPortalAbsoluteUrl,
        resolvePublicAppBaseUrl,
        buildClientPortalEmailCtaHtml,
      } = await import("./clientPortal");
      const portalToken = ensureClientPortalToken(newDossier);
      const portalBase = resolvePublicAppBaseUrl(
        String(req.headers.origin || req.headers.referer || "").replace(/\/$/, ""),
      );
      const portalUrlForEmail = getClientPortalAbsoluteUrl(portalToken, portalBase);
      const portalCtaHtml = buildClientPortalEmailCtaHtml(portalUrlForEmail);
      if (!portalCtaHtml) {
        appendLog(
          `[Email] Lien suivi client absent du mail de confirmation (${newDossier.id}) : définir PUBLIC_APP_URL sur Railway.`,
        );
      }

      const t0 = Date.now();
      scheduleTask(newDossier, {
        type: "FOLLOWUP_MISSING_DOCS",
        dueAt: new Date(t0 + 7 * 24 * 3600 * 1000).toISOString(),
        payload: { stage: 1 },
      });
      scheduleTask(newDossier, {
        type: "FOLLOWUP_MISSING_DOCS",
        dueAt: new Date(t0 + 14 * 24 * 3600 * 1000).toISOString(),
        payload: { stage: 2 },
      });
      scheduleTask(newDossier, {
        type: "FOLLOWUP_MISSING_DOCS",
        dueAt: new Date(t0 + 21 * 24 * 3600 * 1000).toISOString(),
        payload: { stage: 3 },
      });

      db.dossiers.push(newDossier);

      // Déplace les fichiers uploadés sous /uploads/<dossierId>/... (évite /uploads/unknown et stabilise les chemins)
      try {
        const dossierDir = path.join(UPLOADS_DIR, newDossier.id);
        if (!fs.existsSync(dossierDir)) fs.mkdirSync(dossierDir, { recursive: true });
        if (newDossier.formData?.documents?.length) {
          for (const doc of newDossier.formData.documents) {
            if (!doc?.localPath || typeof doc.localPath !== "string") continue;
            if (!fs.existsSync(doc.localPath)) continue;
            const base = path.basename(doc.localPath);
            const nextPath = path.join(dossierDir, base);
            if (doc.localPath !== nextPath) {
              fs.renameSync(doc.localPath, nextPath);
              doc.localPath = nextPath;
            }
          }
        }
      } catch (mvErr: any) {
        appendLog(`[Uploads Warning] Déplacement fichiers ${newDossier.id} impossible: ${mvErr?.message || mvErr}`);
      }

      // Analyse interne des docs clés (offre/tableau) pour fiabiliser la relance (non visible client)
      try {
        const { analyzeLoanPdf, isLoanPdfOrImage } = await import("./documentPdfSignals");
        const { ensureDocumentLocalFile } = await import("./documentFileResolve");
        for (const doc of newDossier.formData?.documents || []) {
          if (!doc?.category) continue;
          const cat = String(doc.category);
          if ((cat === "offre" || cat === "tableau") && isLoanPdfOrImage(doc.name, doc.type)) {
            const resolved = await ensureDocumentLocalFile(newDossier, doc, UPLOADS_DIR);
            if (!resolved.localPath) continue;
            const sig = await analyzeLoanPdf(resolved.localPath, cat as any, { mimeType: doc.type });
            doc.loanSignal = sig;
            if (doc.quality) {
              if (!sig.ok) {
                doc.quality.ok = false;
                doc.quality.reasons = [...new Set([...(doc.quality.reasons || []), ...(sig.reasons || [])])];
              }
            }
          }
        }
      } catch (e: any) {
        appendLog(`[Docs Warning] Analyse PDF impossible: ${e?.message || String(e)}`);
      }

      try {
        const { scheduleCamilleDocumentFollowUpIfNeeded } = await import("./camilleDocumentFollowUp");
        scheduleCamilleDocumentFollowUpIfNeeded(newDossier);
      } catch (followUpErr: any) {
        appendLog(`[Camille] Relance documents non programmée: ${followUpErr?.message || String(followUpErr)}`);
      }

      const primaryAssure = newDossier.formData?.assures?.[0] || {};
      try {
        const { appendPrivacyConsentToSheet } = await import("./rgpdGoogleSheets");
        const sheetRes = await appendPrivacyConsentToSheet(newDossier.id, privacyConsentRecord, {
          email: primaryAssure.email,
          name: [primaryAssure.prenom, primaryAssure.nom].filter(Boolean).join(" ").trim(),
        });
        if (sheetRes.ok) {
          newDossier.privacyConsent = {
            ...privacyConsentRecord,
            sheetsLoggedAt: new Date().toISOString(),
          };
        } else {
          appendLog(`[RGPD] Journal Sheets (${newDossier.id}): ${sheetRes.error}`);
        }
      } catch (sheetErr: any) {
        appendLog(`[RGPD] Journal Sheets erreur (${newDossier.id}): ${sheetErr?.message || sheetErr}`);
      }

      await writeDB(db, newDossier);
      appendLog(`Succès d'écriture du dossier ${newDossier.id} dans la base de données.`);

      void import("./telegramNotify")
        .then(({ notifyTelegramNewDossier }) =>
          notifyTelegramNewDossier({
            dossier: newDossier,
            clientEmail: formData.assures?.[0]?.email || "",
            clientName: [formData.assures?.[0]?.prenom, formData.assures?.[0]?.nom]
              .filter(Boolean)
              .join(" "),
          }),
        )
        .catch(() => undefined);

      const toEmail = formData.assures?.[0]?.email;
      const ccEmails = Array.isArray(formData.assures)
        ? formData.assures
            .map((a: any) => String(a?.email || "").trim().toLowerCase())
            .filter((e: string) => e && e !== String(toEmail || "").trim().toLowerCase())
        : [];
      const clientName = formData.assures?.[0]?.prenom || "Cher client";
      if (toEmail) {
        const confirmationSubject = `Confirmation de réception - Dossier N° ${newDossier.id}`;
        const confirmationHtml = `
<div style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background-color:#F8FAFC;color:#1F2937;line-height:1.6;">
  <div style="max-width:640px;margin:0 auto;background-color:#FFFFFF;border:1px solid #E5E7EB;">
    <div style="background-color:#1E3A8A;padding:24px 20px;text-align:center;">
      ${LCIF_EMAIL_LOGO_HEADER_IMG}
    </div>
    <div style="padding:24px 22px;">
      <p style="font-size:16px;margin:0 0 14px 0;color:#111827;"><strong>Bonjour ${clientName},</strong></p>
      <p style="font-size:14px;margin:0 0 12px 0;color:#374151;">
        Nous avons bien reçu votre dossier d'assurance emprunteur sous le numéro <strong>${newDossier.id}</strong>.
      </p>
      <p style="font-size:14px;margin:0 0 18px 0;color:#374151;">
        Notre équipe vous revient sous 48h ouvrées.
      </p>
      ${portalCtaHtml}
      <p style="font-size:14px;margin:18px 0 0 0;color:#111827;">Bien cordialement,<br/>
        <strong>Charles Victor</strong><br/>
        <span style="color:#6B7280;">Le Club Immobilier Français</span>
      </p>
    </div>
    <div style="background-color:#F8FAFC;padding:16px 22px;border-top:1px solid #E5E7EB;">
      <p style="font-size:11px;margin:0;color:#9CA3AF;line-height:1.5;">
        Le Club Immobilier Français — 17 Passage Leroy, 44000 Nantes<br/>
        N° ORIAS : 24002253
      </p>
    </div>
  </div>
</div>`;
        if (latestAccessToken) {
          sendEmailReplyWithGmailAPI(
            latestAccessToken,
            toEmail,
            confirmationSubject,
            confirmationHtml,
            { cc: ccEmails },
          )
            .then(async (sendResult) => {
              if (sendResult?.ok) {
                appendLog(
                  `[Email] Mail de confirmation automatique envoyé de Charles Victor à ${toEmail} pour le dossier ${newDossier.id}`,
                );
                addEvent(newDossier, {
                  type: "EMAIL_SENT",
                  actor: { kind: "SYSTEM" },
                  meta: { template: "CONFIRMATION", to: toEmail, cc: ccEmails.join(", "), subject: confirmationSubject },
                });
                await writeDB(db, newDossier);
              } else {
                appendLog(`[Email Warning] Échec d'envoi automatique du mail de confirmation à ${toEmail}`);
                addEvent(newDossier, {
                  type: "EMAIL_FAILED",
                  actor: { kind: "SYSTEM" },
                  meta: {
                    template: "CONFIRMATION",
                    to: toEmail,
                    cc: ccEmails.join(", "),
                    subject: confirmationSubject,
                  },
                });
                await writeDB(db, newDossier);
              }
            })
            .catch(async (err: any) => {
              appendLog(`[Email Error] Erreur d'envoi automatique du mail : ${err.message}`);
              addEvent(newDossier, {
                type: "EMAIL_FAILED",
                actor: { kind: "SYSTEM" },
                meta: {
                  template: "CONFIRMATION",
                  to: toEmail,
                  cc: ccEmails.join(", "),
                  subject: confirmationSubject,
                  error: err.message,
                },
              });
              await writeDB(db, newDossier);
            });
        } else if (hasServerOAuthRefreshToken()) {
          // Mode autonome 24/7 : envoi Gmail via refresh_token OAuth serveur (sans login admin)
          sendEmailReplyWithGmailAPI(null, toEmail, confirmationSubject, confirmationHtml, { cc: ccEmails })
            .then(async (sendResult) => {
              if (sendResult?.ok) {
                appendLog(
                  `[Email] Mail de confirmation automatique envoyé via Gmail (refresh_token) à ${toEmail} pour le dossier ${newDossier.id}`,
                );
                addEvent(newDossier, {
                  type: "EMAIL_SENT",
                  actor: { kind: "SYSTEM" },
                  meta: {
                    template: "CONFIRMATION",
                    to: toEmail,
                    cc: ccEmails.join(", "),
                    subject: confirmationSubject,
                    channel: "GMAIL_REFRESH_TOKEN",
                  },
                });
              } else {
                appendLog(
                  `[Email Warning] Échec d'envoi Gmail (refresh_token) du mail de confirmation à ${toEmail}: ${sendResult?.error || "unknown"}`,
                );
                addEvent(newDossier, {
                  type: "EMAIL_FAILED",
                  actor: { kind: "SYSTEM" },
                  meta: {
                    template: "CONFIRMATION",
                    to: toEmail,
                    cc: ccEmails.join(", "),
                    subject: confirmationSubject,
                    channel: "GMAIL_REFRESH_TOKEN",
                    error: sendResult?.error || "unknown",
                  },
                });
              }
              await writeDB(db, newDossier);
            })
            .catch(async (err: any) => {
              appendLog(
                `[Email Error] Erreur Gmail (refresh_token) mail de confirmation : ${err?.message || String(err)}`,
              );
              addEvent(newDossier, {
                type: "EMAIL_FAILED",
                actor: { kind: "SYSTEM" },
                meta: {
                  template: "CONFIRMATION",
                  to: toEmail,
                  cc: ccEmails.join(", "),
                  subject: confirmationSubject,
                  channel: "GMAIL_REFRESH_TOKEN",
                  error: err?.message || String(err),
                },
              });
              await writeDB(db, newDossier);
            });
        } else if (canUseDomainWideDelegation()) {
          // Mode autonome 24/7 : envoi Gmail via service account + délégation domaine (sans login admin)
          sendEmailReplyWithGmailAPI(null, toEmail, confirmationSubject, confirmationHtml, { cc: ccEmails })
            .then(async (sendResult) => {
              if (sendResult?.ok) {
                appendLog(
                  `[Email] Mail de confirmation automatique envoyé via Gmail (DWD) à ${toEmail} pour le dossier ${newDossier.id}`,
                );
                addEvent(newDossier, {
                  type: "EMAIL_SENT",
                  actor: { kind: "SYSTEM" },
                  meta: { template: "CONFIRMATION", to: toEmail, cc: ccEmails.join(", "), subject: confirmationSubject, channel: "GMAIL_DWD" },
                });
              } else {
                appendLog(
                  `[Email Warning] Échec d'envoi Gmail (DWD) du mail de confirmation à ${toEmail}: ${sendResult?.error || "unknown"}`,
                );
                addEvent(newDossier, {
                  type: "EMAIL_FAILED",
                  actor: { kind: "SYSTEM" },
                  meta: {
                    template: "CONFIRMATION",
                    to: toEmail,
                    cc: ccEmails.join(", "),
                    subject: confirmationSubject,
                    channel: "GMAIL_DWD",
                    error: sendResult?.error || "unknown",
                  },
                });
              }
              await writeDB(db, newDossier);
            })
            .catch(async (err: any) => {
              appendLog(`[Email Error] Erreur Gmail (DWD) mail de confirmation : ${err?.message || String(err)}`);
              addEvent(newDossier, {
                type: "EMAIL_FAILED",
                actor: { kind: "SYSTEM" },
                meta: {
                  template: "CONFIRMATION",
                  to: toEmail,
                  cc: ccEmails.join(", "),
                  subject: confirmationSubject,
                  channel: "GMAIL_DWD",
                  error: err?.message || String(err),
                },
              });
              await writeDB(db, newDossier);
            });
        } else if (isEmailConfigured()) {
          // Pas d'OAuth admin : on envoie via SMTP si configuré (pour que le formulaire client fonctionne sans admin connecté)
          sendEmail({ to: [toEmail, ...ccEmails].join(","), subject: confirmationSubject, html: confirmationHtml })
            .then(async (smtpResult) => {
              if (smtpResult.ok) {
                appendLog(
                  `[Email] Mail de confirmation automatique envoyé via SMTP à ${toEmail} pour le dossier ${newDossier.id}`,
                );
                addEvent(newDossier, {
                  type: "EMAIL_SENT",
                  actor: { kind: "SYSTEM" },
                  meta: {
                    template: "CONFIRMATION",
                    to: toEmail,
                    cc: ccEmails.join(", "),
                    subject: confirmationSubject,
                    channel: "SMTP",
                    providerId: smtpResult.providerId,
                  },
                });
              } else if (smtpResult.ok === false) {
                appendLog(
                  `[Email Warning] Échec d'envoi SMTP du mail de confirmation à ${toEmail}: ${smtpResult.error}`,
                );
                addEvent(newDossier, {
                  type: "EMAIL_FAILED",
                  actor: { kind: "SYSTEM" },
                  meta: {
                    template: "CONFIRMATION",
                    to: toEmail,
                    cc: ccEmails.join(", "),
                    subject: confirmationSubject,
                    channel: "SMTP",
                    error: smtpResult.error,
                  },
                });
              } else {
                appendLog(
                  `[Email Warning] Échec d'envoi SMTP du mail de confirmation à ${toEmail}: résultat inconnu`,
                );
                addEvent(newDossier, {
                  type: "EMAIL_FAILED",
                  actor: { kind: "SYSTEM" },
                  meta: {
                    template: "CONFIRMATION",
                    to: toEmail,
                    cc: ccEmails.join(", "),
                    subject: confirmationSubject,
                    channel: "SMTP",
                    error: "Unknown SMTP result shape",
                  },
                });
              }
              await writeDB(db, newDossier);
            })
            .catch(async (err: any) => {
              appendLog(`[Email Error] Erreur SMTP mail de confirmation : ${err?.message || String(err)}`);
              addEvent(newDossier, {
                type: "EMAIL_FAILED",
                actor: { kind: "SYSTEM" },
                meta: {
                  template: "CONFIRMATION",
                  to: toEmail,
                  cc: ccEmails.join(", "),
                  subject: confirmationSubject,
                  channel: "SMTP",
                  error: err?.message || String(err),
                },
              });
              await writeDB(db, newDossier);
            });
        } else {
          appendLog(
            `[Email Skipped] Aucun token OAuth admin et SMTP non configuré : confirmation non envoyée à ${toEmail} (dossier ${newDossier.id}).`,
          );
          addEvent(newDossier, {
            type: "EMAIL_FAILED",
            actor: { kind: "SYSTEM" },
            meta: {
              template: "CONFIRMATION",
              to: toEmail,
              cc: ccEmails.join(", "),
              subject: confirmationSubject,
              channel: "NONE",
              error: "No OAuth token available and SMTP is not configured",
            },
          });
          await writeDB(db, newDossier);
        }
      }

      // Export auto Drive (compte de service recommandé — formulaire sans admin connecté)
      const {
        hasServiceAccountReady,
        hasServiceAccountConfigured,
        loadServiceAccountDetails,
      } = await import("./serviceAccount");
      const saDetails = loadServiceAccountDetails();
      const canAutoDrive = hasServiceAccountReady() || Boolean(latestAccessToken);

      if (!canAutoDrive) {
        newDossier.workspaceStatus = "FAILED";
        newDossier.workspaceError =
          saDetails.parseError ||
          (hasServiceAccountConfigured()
            ? "Compte de service Google invalide sur Railway (vérifiez GOOGLE_SERVICE_ACCOUNT_JSON_BASE64)."
            : "Export Drive auto impossible : ajoutez GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 sur Railway et partagez le dossier parent avec le compte de service.");
        await writeDB(db, newDossier);
        appendLog(`[Drive] Export auto ignoré pour ${newDossier.id}: ${newDossier.workspaceError}`);
      } else {
        newDossier.workspaceStatus = "PENDING";
        await writeDB(db, newDossier);
      }

      let driveTokenForAutoExport: string | null = null;
      if (latestAccessToken) {
        driveTokenForAutoExport = latestAccessToken;
      } else if (hasServerOAuthRefreshToken()) {
        try {
          driveTokenForAutoExport = await getServerAccessToken();
        } catch (e: any) {
          appendLog(`[Drive Warning] Impossible d'obtenir un token OAuth serveur: ${e?.message || String(e)}`);
          driveTokenForAutoExport = hasServiceAccountReady() ? null : null;
        }
      } else {
        // fallback service account si configuré
        driveTokenForAutoExport = hasServiceAccountReady() ? null : null;
      }

      exportDossierToGoogleWorkspace(newDossier, driveTokenForAutoExport)
        .then(async (result) => {
          const currentDb = await readDBAsync();
          const existing = currentDb.dossiers.find((d: any) => d.id === newDossier.id);
          if (existing) {
            if (result.success) {
              existing.status = "EN_COURS";
              existing.workspaceStatus = result.status;
              existing.workspaceWarning = result.warning;
              existing.workspaceFolderId = result.folderId;
              existing.workspaceSheetId = result.spreadsheetId;
              existing.updatedAt = new Date().toISOString();
              // Sauvegarde des liens Drive par document (si dispo)
              if (newDossier.formData?.documents?.length) {
                existing.formData = existing.formData || {};
                existing.formData.documents = newDossier.formData.documents;
              }
              await writeDB(currentDb, existing);
              appendLog(
                `Dossier ${newDossier.id} mis à jour au statut EN_COURS après export Google Workspace. (Statut: ${result.status})`,
              );
            } else {
              existing.workspaceStatus = "FAILED";
              existing.workspaceError = result.error;
              existing.updatedAt = new Date().toISOString();
              await writeDB(currentDb, existing);
              appendLog(`Échec de l'export Google Workspace pour le dossier ${newDossier.id}: ${result.error}`);
            }
          }
        })
        .catch((err) => {
          appendLog(
            `Erreur de tâche en arrière plan Google Workspace pour ${newDossier.id}: ${err.message || err}`,
          );
        });

      const portalUrl =
        portalUrlForEmail.startsWith("http")
          ? portalUrlForEmail
          : getClientPortalAbsoluteUrl(portalToken, portalBase);
      res.json({ success: true, dossierId: newDossier.id, portalUrl, portalToken });
    } catch (error: any) {
      appendLog(`Erreur de création de dossier : ${error.stack || error.message || error}`);
      console.error("Erreur de création de dossier :", error);
      res.status(500).json({ error: "Erreur serveur lors de la création du dossier." });
    }
  });

  const helpLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 8 });
  app.post("/api/public/help", helpLimiter, express.json(), async (req, res) => {
    await ensureBackgroundServicesStarted();
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      const prenom = String(req.body?.prenom || "").trim();
      const message = String(req.body?.message || "").trim();
      if (!email || !email.includes("@")) return res.status(400).json({ error: "Email invalide" });
      if (!message || message.length < 3) return res.status(400).json({ error: "Message manquant" });

      const db = await readDBAsync();
      const leadId = `LCIF-${Math.floor(Math.random() * 1000000).toString().padStart(6, "0")}`;
      const leadDossier = ensureDossierShape({
        id: leadId,
        status: "NOUVEAU",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        formData: {
          assures: [{ prenom, nom: "", email }],
          documents: [],
        },
        communications: [],
        tasks: [],
        emails: [],
        notes: [],
        eventLog: [],
        isLead: true,
      } as any);
      addEvent(leadDossier, {
        type: "DOSSIER_CREATED",
        actor: { kind: "SYSTEM" },
        message: "Pré-dossier créé via aide formulaire (Camille).",
      });
      db.dossiers.push(leadDossier);
      await writeDB(db, leadDossier);

      const { generateCamillePreDossierHelpEmail } = await import("./aiAssistant");
      const draft = await generateCamillePreDossierHelpEmail({
        clientEmail: email,
        clientPrenom: prenom,
        message,
      });
      const subj = `Re: Aide formulaire — Réf. ${leadId}`;

      const { sendEmailReplyWithGmailAPI } = await import("./mailAutomation");
      const send = await sendEmailReplyWithGmailAPI(null, email, subj, draft.html);
      if (!send.ok) return res.status(500).json({ error: send.error || "Echec envoi email" });

      res.json({ success: true, ref: leadId });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  app.get("/api/dossiers", listDossiersLimiter, async (_req, res) => {
    await ensureBackgroundServicesStarted();
    const db = await readDBAsync();
    const sorted = db.dossiers.sort(
      (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    res.json(sorted.slice(0, 100));
  });

  app.post("/api/dossiers/:id/status", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const { id } = req.params;
    const db = await readDBAsync();

    const index = db.dossiers.findIndex((d: any) => d.id === id);
    if (index !== -1) {
      const before = db.dossiers[index];
      db.dossiers[index] = ensureDossierShape({
        ...before,
        ...(req.body || {}),
        updatedAt: new Date().toISOString(),
      });
      const dossier = db.dossiers[index];
      if (req.body?.status && req.body.status !== before.status) {
        addEvent(dossier, {
          type: "STATUS_CHANGED",
          actor: { kind: "ADMIN" },
          meta: { from: before.status, to: req.body.status },
        });

        if (req.body.status === "EN_ATTENTE_CLIENT") {
          const hasPendingNoReply = (dossier.tasks || []).some(
            (t: any) => t.status === "PENDING" && t.type === "FOLLOWUP_NO_REPLY",
          );
          if (!hasPendingNoReply) {
            scheduleTask(dossier, {
              type: "FOLLOWUP_NO_REPLY",
              dueAt: new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString(),
              payload: { stage: 1 },
            });
          }
        }
      }
      await writeDB(db, dossier);
      res.json({ success: true, dossier });
    } else {
      res.status(404).json({ error: "Dossier introuvable" });
    }
  });

  app.post("/api/dossiers/:id/notes", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const { id } = req.params;
    const { author, text } = (req.body || {}) as any;
    if (!text || typeof text !== "string") return res.status(400).json({ error: "Missing text" });
    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });
    if (!dossier.notes) dossier.notes = [];
    const note = { id: newId("note"), at: new Date().toISOString(), author: author || "ADMIN", text };
    dossier.notes.push(note);
    addEvent(dossier, {
      type: "NOTE_ADDED",
      actor: { kind: "ADMIN", label: author || "ADMIN" },
      meta: { noteId: note.id },
    });
    await writeDB(db, dossier);
    res.json({ success: true, note, dossier });
  });

  app.post("/api/admin/dossiers/:id/send-email", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const { id } = req.params;
    const { to, cc, subject, html } = (req.body || {}) as any;
    if (!subject || !html) return res.status(400).json({ error: "Missing subject or html" });

    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });

    const toEmail = to || dossier.formData?.assures?.[0]?.email;
    if (!toEmail) return res.status(400).json({ error: "Missing recipient email" });

    const { validateStudyEmailRecipient } = await import("./studyEmailRecipient");
    const recipientCheck = validateStudyEmailRecipient(dossier, String(subject || ""));
    if (!recipientCheck.ok) {
      return res.status(400).json({
        error: recipientCheck.error,
        dossierId: dossier.id,
        expectedPrenom: recipientCheck.clientPrenom,
        toEmail: recipientCheck.toEmail,
      });
    }
    const ccEmails =
      Array.isArray(cc) && cc.length
        ? cc.map((e: any) => String(e || "").trim()).filter(Boolean)
        : ((dossier.formData?.assures || []) as any[])
            .map((a: any) => String(a?.email || "").trim())
            .filter((e: string) => e && e.toLowerCase() !== String(toEmail).toLowerCase());

    const authHeader = req.headers.authorization;
    const googleToken =
      authHeader && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : latestAccessToken;

    let providerId: string | null = null;
    let channel: "gmail" | "smtp" | "simulated" = "simulated";

    if (googleToken) {
      const { sendEmailReplyWithGmailAPI } = await import("./mailAutomation");
      const gmailResult = await sendEmailReplyWithGmailAPI(googleToken, toEmail, subject, html, { cc: ccEmails });
      if (gmailResult.ok) {
        providerId = gmailResult.messageId || null;
        channel = "gmail";
      } else {
        addEvent(dossier, {
          type: "EMAIL_FAILED",
          actor: { kind: "ADMIN", label: "Admin" },
          meta: { to: toEmail, subject, error: gmailResult.error, channel: "gmail" },
        });
        await writeDB(db, dossier);
        return res.status(500).json({
          error: `Échec Gmail : ${gmailResult.error}. Reconnectez-vous à Google (Déconnexion puis connexion).`,
        });
      }
    } else {
      const result = await sendEmail({ to: [toEmail, ...ccEmails].join(","), subject, html });
      if ("error" in result) {
        const error = (result as any).error;
        addEvent(dossier, {
          type: "EMAIL_FAILED",
          actor: { kind: "ADMIN", label: "Admin" },
          meta: { to: toEmail, subject, error },
        });
        await writeDB(db, dossier);
        return res.status(500).json({ error });
      }
      providerId = (result as any).providerId || null;
      channel = providerId === "SIMULATED" ? "simulated" : "smtp";
      if (channel === "simulated") {
        return res.status(400).json({
          error:
            "Email non envoyé : connectez-vous avec Google dans l'admin (Gmail) ou configurez SMTP sur Railway.",
        });
      }
    }

    const sentAt = new Date().toISOString();
    if (!dossier.communications) dossier.communications = [];
    dossier.communications.push({
      id: `msg_out_${Date.now()}`,
      direction: "outbound",
      to: toEmail,
      subject,
      text: html,
      html,
      gmailId: providerId || undefined,
      date: sentAt,
    });

    addEvent(dossier, {
      type: "EMAIL_SENT",
      actor: { kind: "ADMIN", label: "Admin" },
      meta: { to: toEmail, subject, providerId, channel },
      message: `Email envoyé au client (${channel}).`,
    });
    const { acknowledgeStaffOutboundToClient } = await import("./camilleStaffHandoff");
    acknowledgeStaffOutboundToClient(dossier, { source: "admin_send_email", subject });
    try {
      const { applyStudyKpiFromGmailOutbound, applyStudyKpiFromStudyDraft } = await import(
        "./studyEmailKpi"
      );
      const { hasStudyBeenSent } = await import("./dossierLifecycle");
      const kpiFromMail = applyStudyKpiFromGmailOutbound(dossier, {
        subject,
        html,
        text: html,
        gmailId: providerId || `admin_send_${dossier.id}_${Date.now()}`,
        date: sentAt,
      });
      if (!kpiFromMail || !(Number(dossier.studyKpi?.grossSavingsEur) > 0)) {
        applyStudyKpiFromStudyDraft(dossier);
      }
      if (hasStudyBeenSent(dossier) && !["MAIL_ENVOYÉ", "MAIL_ENVOYE", "TRAITÉ", "TRAITE", "CLOS"].includes(String(dossier.status))) {
        dossier.status = "MAIL_ENVOYÉ";
      }
    } catch (kpiErr: any) {
      console.warn(`[KPI] Extraction étude à l'envoi admin: ${kpiErr?.message || kpiErr}`);
    }
    try {
      await writeDB(db, dossier);
    } catch (err: any) {
      console.error("[send-email] Persistance Firestore:", err?.message || err);
      return res.json({
        success: true,
        providerId,
        channel,
        simulated: false,
        warning:
          "Email envoyé via Gmail, mais l'historique n'a pas pu être enregistré (Firestore saturé). Réessayez dans 1 minute.",
      });
    }
    return res.json({
      success: true,
      providerId,
      channel,
      simulated: false,
    });
  });

  // Calcule les économies + génère un brouillon HTML (sans envoi). Notifie Remi si fiabilité HIGH.
  app.post("/api/admin/dossiers/:id/compute-economy", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const { id } = req.params;
    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });

    const { computeEconomyFromDossierDocs } = await import("./economyFromDocs");
    const { buildEconomyHtmlDraft } = await import("./economyMailDraft");
    const comp = await computeEconomyFromDossierDocs(dossier);

    const draft = comp.ok ? buildEconomyHtmlDraft(dossier, comp) : null;
    const now = new Date().toISOString();

    dossier.studyDraft = {
      kind: "ECONOMY",
      computedAt: now,
      reliability: comp.reliability,
      reasons: comp.reasons,
      extracted: comp.extracted,
      subject: draft?.subject || null,
      html: draft?.html || null,
      economySummary: comp.ok
        ? {
            grossSavingsEur: Math.round(comp.result?.grossSavings || 0),
            feesCourtageEur: Math.round(comp.extracted?.feesCourtierTotal || 0),
            feesAssureurEur: Math.round(comp.extracted?.feesAssureurTotal || 0),
          }
        : undefined,
    };
    addEvent(dossier, {
      type: "NOTE_ADDED",
      actor: { kind: "SYSTEM" },
      message: `Calcul économies: ${comp.reliability}`,
      meta: { reliability: comp.reliability, ok: comp.ok, reasons: comp.reasons.slice(0, 5) },
    });
    await writeDB(db, dossier);

    // Notification Remi si HIGH
    try {
      if (comp.ok && comp.reliability === "HIGH" && draft?.html) {
        const notifyTo = process.env.AI_ESCALATION_EMAIL || "remi@leclubimmobilier.fr";
        const { sendEmailReplyWithGmailAPI } = await import("./mailAutomation");
        const subj = `Économie prête — ${dossier.id}`;
        const body = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#0f172a">
          <p><strong>Dossier :</strong> ${dossier.id}</p>
          <p>Le calcul auto est prêt (fiabilité <strong>${comp.reliability}</strong>). Vous pouvez vérifier et envoyer depuis l’admin.</p>
        </div>`;
        await sendEmailReplyWithGmailAPI(null, notifyTo, subj, body);
      }
    } catch (e) {
      // ignore notification failure
    }

    res.json({ success: true, computation: comp, draft });
  });

  // Upload/replace a single active quote ("devis") PDF for the dossier (admin only workflow)
  app.post("/api/admin/dossiers/:id/quote", quoteUpload.single("quote"), async (req, res) => {
    await ensureBackgroundServicesStarted();
    const { id } = req.params;
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ error: "Missing quote file" });

    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });

    if (!dossier.formData) dossier.formData = {};
    if (!Array.isArray(dossier.formData.documents)) dossier.formData.documents = [];

    // Remove existing active quote docs (single active)
    dossier.formData.documents = dossier.formData.documents.filter((d: any) => d?.category !== "devis");

    const doc = {
      id: `devis-${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      category: "devis",
      name: file.originalname,
      size: file.size,
      type: file.mimetype,
      localPath: file.path,
      source: "admin",
      uploadedAt: new Date().toISOString(),
    };

    // Move under dossier folder
    try {
      const dossierDir = path.join(UPLOADS_DIR, dossier.id);
      if (!fs.existsSync(dossierDir)) fs.mkdirSync(dossierDir, { recursive: true });
      const base = path.basename(doc.localPath);
      const nextPath = path.join(dossierDir, base);
      if (doc.localPath !== nextPath && fs.existsSync(doc.localPath)) {
        fs.renameSync(doc.localPath, nextPath);
        doc.localPath = nextPath;
      }
    } catch (e) {
      // ignore
    }

    dossier.formData.documents.push(doc);

    // Upload to Drive if folder exists (best effort) using OAuth server token
    try {
      if (dossier.workspaceFolderId) {
        const { getServerAccessToken } = await import("./googleOAuthServer");
        const { uploadBufferToDriveFolder } = await import("./gmailDriveUpload");
        const buf = fs.readFileSync(doc.localPath);
        const uploaded = await uploadBufferToDriveFolder(
          dossier.workspaceFolderId,
          doc.name,
          doc.type || "application/pdf",
          buf,
          await getServerAccessToken(),
        );
        if (uploaded) {
          (doc as any).driveFileId = uploaded.fileId;
          (doc as any).driveLink = uploaded.webViewLink || undefined;
        }
      }
    } catch {
      // ignore
    }

    await writeDB(db, dossier);
    res.json({ success: true, dossier });
  });

  // Ajouter un document au dossier (admin) — copié sur Drive si le dossier existe
  app.post("/api/admin/dossiers/:id/documents", adminDocUpload.single("document"), async (req, res) => {
    await ensureBackgroundServicesStarted();
    const { id } = req.params;
    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ error: "Fichier manquant" });

    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });

    let driveToken: string | null = null;
    try {
      const { getServerAccessToken } = await import("./googleOAuthServer");
      driveToken = await getServerAccessToken();
    } catch {
      driveToken = null;
    }

    const { addFileToDossier } = await import("./dossierDocuments");
    const category = String((req.body as any)?.category || "auto");
    const doc = await addFileToDossier(dossier, file, {
      uploadsDir: UPLOADS_DIR,
      category,
      source: "admin",
      driveAccessToken: driveToken,
    });

    let driveWarning: string | undefined;
    if (!dossier.workspaceFolderId) {
      driveWarning =
        "Document enregistré localement. Créez le dossier Drive (bouton « Créer dossier Drive ») puis réimportez ou relancez l'export pour archiver sur Drive.";
    } else if (!doc.driveLink) {
      driveWarning = "Document enregistré ; upload Drive non confirmé (vérifiez la connexion Google).";
    }

    dossier.updatedAt = new Date().toISOString();
    await writeDB(db, dossier);

    res.json({
      success: true,
      document: doc,
      driveWarning,
      dossier,
    });
  });

  // Delete active quote ("devis")
  app.delete("/api/admin/dossiers/:id/quote", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const { id } = req.params;
    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });
    if (!dossier.formData) dossier.formData = {};
    if (!Array.isArray(dossier.formData.documents)) dossier.formData.documents = [];
    dossier.formData.documents = dossier.formData.documents.filter((d: any) => d?.category !== "devis");
    await writeDB(db, dossier);
    res.json({ success: true, dossier });
  });

  app.post("/api/admin/run-scheduler", async (_req, res) => {
    await ensureBackgroundServicesStarted();
    const r = await runSchedulerOnce();
    res.json({ success: true, ...r });
  });

  app.get("/api/admin/dossiers/:id/next-actions", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const { id } = req.params;
    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });
    const actions = proposeNextActions(dossier);
    auditAiDecision(dossier, actions);
    await writeDB(db, dossier);
    res.json({ success: true, actions });
  });

  app.delete("/api/dossiers/:id", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const { id } = req.params;
    try {
      const db = await readDBAsync();
      const dossier = db.dossiers.find((d: any) => d.id === id);
      if (!dossier) {
        return res.status(404).json({ success: false, error: "Dossier introuvable." });
      }

      if (dossier.workspaceFolderId) {
        try {
          const authHeader = req.headers.authorization;
          let driveToken: string | null =
            authHeader && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
          if (!driveToken && hasServerOAuthRefreshToken()) {
            driveToken = await getServerAccessToken();
          }
          if (driveToken) {
            await deleteDossierFromGoogleWorkspace(dossier.workspaceFolderId, driveToken);
          }
        } catch (gErr: any) {
          appendLog(
            `[Delete] Dossier Drive non supprimé pour ${id}: ${gErr?.message || gErr} (dossier retiré de la base).`,
          );
        }
      }

      await deleteDossierFromStore(id);

      try {
        fs.rmSync(path.join(UPLOADS_DIR, id), { recursive: true, force: true });
      } catch (err) {
        console.error("Failed to remove uploads dir", err);
      }

      appendLog(`Dossier ${id} supprimé.`);
      res.json({ success: true });
    } catch (err: any) {
      appendLog(`[Delete] Échec suppression ${id}: ${err?.message || err}`);
      res.status(500).json({
        success: false,
        error: err?.message || "Échec de la suppression du dossier.",
      });
    }
  });

  app.get("/api/admin/google-status", (_req, res) => {
    res.json({ email: "oauth-client", folderId: "oauth-drive", configured: true });
  });

  /** Teste le compte de service (export auto formulaire client, sans admin connecté). */
  app.get("/api/admin/drive-auto-check", async (_req, res) => {
    const { hasServiceAccountConfigured, loadServiceAccountDetails } = await import(
      "./serviceAccount",
    );
    const sa = loadServiceAccountDetails();
    if (!hasServiceAccountConfigured()) {
      return res.status(400).json({
        ok: false,
        error:
          "Compte de service absent. Ajoutez GOOGLE_SERVICE_ACCOUNT_JSON ou GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 sur Railway.",
      });
    }
    if (!sa.credentials) {
      return res.status(400).json({
        ok: false,
        error: sa.parseError || "JSON compte de service invalide sur Railway.",
        hint:
          "Collez le fichier .json en une ligne dans GOOGLE_SERVICE_ACCOUNT_JSON, " +
          "ou utilisez GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 (base64 -i fichier.json | tr -d '\\n'). " +
          "Ne collez pas le résultat de curl dans une variable.",
      });
    }
    try {
      const { getDriveDiagnostics } = await import("./googleAutomation");
      const { resolveDriveParentFolderId } = await import("./driveConfig");
      const resolved = resolveDriveParentFolderId();
      const diag = await getDriveDiagnostics("", resolved.parentId);
      res.json({
        ok: Boolean(diag.parentOk),
        mode: "service_account",
        serviceAccountEmail: sa.clientEmail,
        serviceAccountSource: sa.source,
        shareHint: sa.clientEmail
          ? `Partagez « Dossiers Clients Assurance » avec ${sa.clientEmail} (Éditeur) dans Google Drive.`
          : "client_email introuvable dans le JSON du compte de service.",
        ...diag,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  /** Crée ou retrouve le dossier Drive « Documentation Camille » + ligne variable Railway. */
  const camilleKnowledgeSetupHandler = async (_req: express.Request, res: express.Response) => {
    try {
      const { ensureCamilleKnowledgeFolder } = await import("./camilleKnowledgeDrive");
      const result = await ensureCamilleKnowledgeFolder(null);
      if (!result.ok) {
        return res.status(400).json(result);
      }
      res.json({
        success: true,
        ...result,
        hint:
          "Copiez envLine dans Railway (Variables), redéployez, puis déposez vos PDF dans ce dossier Drive.",
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  };
  app.post("/api/admin/camille-knowledge/setup", camilleKnowledgeSetupHandler);
  app.get("/api/admin/camille-knowledge/setup", camilleKnowledgeSetupHandler);
  app.get("/api/admin/camille-knowledge/setup-auto", async (_req, res) => {
    try {
      const { ensureCamilleKnowledgeFolder } = await import("./camilleKnowledgeDrive");
      const result = await ensureCamilleKnowledgeFolder(null);
      if (!result.ok) return res.status(400).json(result);
      res.json({ success: true, mode: "service_account", ...result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.post("/api/admin/camille-knowledge/sync", async (_req, res) => {
    try {
      const { syncCamilleKnowledgeFromDrive } = await import("./camilleKnowledgeDrive");
      const cache = await syncCamilleKnowledgeFromDrive(null, DATA_DIR);
      res.json({ success: true, ...cache });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.get("/api/admin/camille-knowledge/status", async (_req, res) => {
    try {
      const { getCamilleKnowledgeCache, resolveCamilleKnowledgeFolderIdFromEnv } = await import(
        "./camilleKnowledgeDrive"
      );
      const { getKnowledgeIndexStatus } = await import("./camilleKnowledgeRag");
      const cache = getCamilleKnowledgeCache(DATA_DIR);
      res.json({
        success: true,
        configuredFolderId: resolveCamilleKnowledgeFolderIdFromEnv(),
        cache: cache || null,
        rag: getKnowledgeIndexStatus(DATA_DIR),
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.post("/api/admin/camille-knowledge/retrieve-test", async (req, res) => {
    try {
      const query = String((req.body as any)?.query || "").trim();
      if (!query) return res.status(400).json({ error: "query requis" });
      const { retrieveKnowledgeChunks } = await import("./camilleKnowledgeRag");
      const chunks = await retrieveKnowledgeChunks(DATA_DIR, { clientMessage: query });
      res.json({
        success: true,
        query,
        count: chunks.length,
        chunks: chunks.map((c) => ({
          fileName: c.fileName,
          score: c.score,
          tags: c.tags,
          preview: c.text.slice(0, 500),
        })),
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.post("/api/admin/camille/reasoning-test", async (req, res) => {
    try {
      const dossierId = String((req.body as any)?.dossierId || "").trim();
      const emailText = String((req.body as any)?.emailText || "").trim();
      if (!dossierId || !emailText) {
        return res.status(400).json({ error: "dossierId et emailText requis" });
      }
      const db = await readDBAsync();
      const dossier = db.dossiers.find((d: any) => d.id === dossierId);
      if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });

      const { processIncomingClientEmail } = await import("./aiAssistant");
      const dryRun = String((req.body as any)?.dryRun ?? "true").toLowerCase() !== "false";
      if (dryRun) {
        const {
          buildCamilleContextBlock,
        } = await import("./camilleMail");
        const { buildCamilleKnowledgePromptBlock } = await import("./camilleKnowledgeDrive");
        const { buildPlaybooksPromptBlock } = await import("./camillePlaybooks");
        const { getConversationTailForAi, hasUnansweredClientInbound } = await import("./gmailConversation");
        const { getRecentStaffOutboundSummary, isStaffActivelyHandling } = await import("./camilleStaffHandoff");
        const { hasStudyBeenSent } = await import("./dossierLifecycle");
        const { clientHasAcceptedInsuranceChange } = await import("./insuranceAcceptance");
        const { getPreStudyLoanReminderLabels } = await import("../shared/documentChecklist");
        const { runCamilleReasoningPipeline } = await import("./camilleReasoningPipeline");

        const ctx = buildCamilleContextBlock(dossier, [], db.dossiers);
        const studySent = hasStudyBeenSent(dossier);
        const clientAccepted = clientHasAcceptedInsuranceChange(dossier);
        const missingLoanLabels = studySent
          ? clientAccepted
            ? ctx.missingBlocking.map((c) => c.label)
            : []
          : getPreStudyLoanReminderLabels(dossier.formData?.documents || []);
        const knowledgeBlock = await buildCamilleKnowledgePromptBlock(null, DATA_DIR, {
          clientMessage: emailText,
          subscriptionPhase: ctx.subscriptionPhase,
          studySent: ctx.studySent,
        });
        const playbooksBlock = await buildPlaybooksPromptBlock(emailText, dossier);
        const operational = {
          dossierId: dossier.id,
          clientEmail: dossier.formData?.assures?.[0]?.email || "",
          prenom: dossier.formData?.assures?.[0]?.prenom || "",
          nom: dossier.formData?.assures?.[0]?.nom || "",
          emailText,
          attachmentNames: [],
          ctx,
          staffHandling: isStaffActivelyHandling(dossier),
          staffOutbound: getRecentStaffOutboundSummary(dossier),
          conversationTail: getConversationTailForAi(dossier),
          needsReply: hasUnansweredClientInbound(dossier),
          studySent,
          clientAccepted,
          missingLoanLabels,
        };
        const decision = await runCamilleReasoningPipeline({
          knowledgeBlock,
          playbooksBlock: playbooksBlock || "",
          operational,
        });
        return res.json({ success: true, dryRun: true, decision });
      }

      const result = await processIncomingClientEmail(
        dossier,
        emailText,
        dossier.formData?.assures?.[0]?.email || "",
        { allDossiers: db.dossiers },
      );
      res.json({ success: true, dryRun: false, result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.get("/api/admin/rgpd/status", async (_req, res) => {
    const { getRgpdSpreadsheetId, normalizeSpreadsheetId } = await import("./rgpdGoogleSheets");
    const configuredRaw = process.env.RGPD_GOOGLE_SPREADSHEET_ID?.trim() || null;
    const spreadsheetId = getRgpdSpreadsheetId() || null;
    res.json({
      success: true,
      spreadsheetId,
      spreadsheetUrl: spreadsheetId
        ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
        : null,
      spreadsheetIdNormalized:
        configuredRaw && spreadsheetId ? configuredRaw !== spreadsheetId : false,
      registerTab: process.env.RGPD_SHEET_REGISTER || "Registre traitements",
      consentTab: process.env.RGPD_SHEET_CONSENTS || "Journal consentements",
      policyVersion: (await import("../shared/privacyConsent")).PRIVACY_POLICY_VERSION,
      serviceAccountEmail: (await import("./serviceAccount")).getServiceAccountClientEmail(),
    });
  });

  app.get("/api/admin/rgpd/diagnose", async (_req, res) => {
    const { diagnoseRgpdSpreadsheet } = await import("./rgpdGoogleSheets");
    const diag = await diagnoseRgpdSpreadsheet();
    res.json({ success: true, ...diag });
  });

  const rgpdSyncRegisterHandler = async (_req: express.Request, res: express.Response) => {
    try {
      const { syncRgpdRegisterToSheet, getRgpdSpreadsheetId } = await import("./rgpdGoogleSheets");
      const result = await syncRgpdRegisterToSheet();
      if (!result.ok) {
        return res.status(result.error?.includes("non configuré") ? 400 : 502).json(result);
      }
      const spreadsheetId = getRgpdSpreadsheetId();
      res.json({
        success: true,
        spreadsheetId,
        url: spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}` : undefined,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  };
  app.get("/api/admin/rgpd/sync-register", rgpdSyncRegisterHandler);
  app.post("/api/admin/rgpd/sync-register", rgpdSyncRegisterHandler);

  app.get("/api/admin/drive-check", async (req, res) => {
    const authHeader = req.headers.authorization;
    const token =
      authHeader && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : latestAccessToken;
    if (!token) {
      return res.status(401).json({ error: "Connexion Google requise (reconnectez-vous dans l'admin)." });
    }
    try {
      const { getDriveDiagnostics } = await import("./googleAutomation");
      const { resolveDriveParentFolderId } = await import("./driveConfig");
      const resolved = resolveDriveParentFolderId();
      const diag = await getDriveDiagnostics(token, resolved.parentId);
      res.json({ success: true, ...diag });
    } catch (err: any) {
      res.status(500).json({
        error: err?.message || String(err),
        hint: "Reconnectez Google dans l'admin pour autoriser Drive (scope complet).",
      });
    }
  });

  app.post("/api/dossiers/:id/retry-workspace", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const { id } = req.params;
    try {
      const db = await readDBAsync();
      const dossier = db.dossiers.find((d: any) => d.id === id);
      if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });

      const force = Boolean((req.body as any)?.force);
      if (
        dossier.workspaceFolderId &&
        dossier.workspaceStatus !== "FAILED" &&
        !force
      ) {
        return res.json({
          success: true,
          folderId: dossier.workspaceFolderId,
          spreadsheetId: dossier.workspaceSheetId,
          warning:
            "Un dossier Drive existe déjà pour ce client. Utilisez « Ouvrir Drive » ou force: true pour réexporter.",
        });
      }

      dossier.workspaceStatus = "PENDING";
      dossier.workspaceError = undefined;
      dossier.workspaceWarning = undefined;
      await writeDB(db, dossier);

      const authHeader = req.headers.authorization;
      let token =
        authHeader && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : latestAccessToken;
      if (!token && hasServerOAuthRefreshToken()) {
        token = await getServerAccessToken();
      }

      const result = await exportDossierToGoogleWorkspace(dossier, token || null);

      const currentDb = await readDBAsync();
      const updated = currentDb.dossiers.find((d: any) => d.id === id);
      if (updated) {
        if (result.success) {
          updated.status = "EN_COURS";
          updated.workspaceStatus = result.status;
          updated.workspaceWarning = result.warning;
          updated.workspaceFolderId = result.folderId;
          updated.workspaceSheetId = result.spreadsheetId;
          updated.workspaceError = undefined;
          if (dossier.formData?.documents?.length) {
            updated.formData = updated.formData || {};
            updated.formData.documents = dossier.formData.documents;
          }
        } else {
          updated.workspaceStatus = "FAILED";
          updated.workspaceError = result.error;
        }
        updated.updatedAt = new Date().toISOString();
        await writeDB(currentDb);
      }

      res.json(result);
    } catch (err: any) {
      console.error("Manual retry workspace error:", err);
      res.status(500).json({ error: err.message || err });
    }
  });

  // Téléchargement sécurisé: doc par id (redirige vers Drive si dispo)
  app.get("/api/dossiers/:id/documents/:docId/download", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const { id, docId } = req.params;
    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === id);
    if (!dossier) return res.status(404).send("Dossier introuvable");
    const doc = (dossier.formData?.documents || []).find((d: any) => d?.id === docId);
    if (!doc) return res.status(404).send("Document introuvable");

    if (doc.driveLink) {
      return res.redirect(doc.driveLink);
    }

    const p = doc.localPath as string | undefined;
    if (!p || typeof p !== "string" || !fs.existsSync(p)) {
      return res.status(404).send("File not found");
    }
    res.download(p, doc.name || path.basename(p));
  });

  app.post("/api/admin/sync-emails", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing Google Token" });
    }
    const accessToken = authHeader.split(" ")[1];

    try {
      const { syncGmailInbox } = await import("./mailAutomation");
      const db = await readDBAsync();
      const result = await syncGmailInbox(accessToken, db, processIncomingClientEmail);
      const { writeDirtyDossiers } = await import("./db");
      const persist = await writeDirtyDossiers(result.db, result.dirtyDossierIds || []);
      res.json({
        success: true,
        inbound: result.inboundCount,
        processed: result.processed,
        aiReplies: result.aiReplies,
        dossiersPersisted: persist.written,
        dossiersPersistFailed: persist.failed,
        attachmentsSaved: result.attachmentsSaved ?? 0,
        driveAttachmentsUploaded: result.driveAttachmentsUploaded ?? 0,
        attachmentDebug: result.attachmentDebug ?? [],
      });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/dossiers/:id/seed-gmail-imports", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Connexion Google requise." });
    }
    const accessToken = authHeader.split(" ")[1];
    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === req.params.id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });

    const { seedDossierGmailImportRegistry } = await import("./mailAutomation");
    const result = await seedDossierGmailImportRegistry(accessToken, dossier);
    await writeDB(db, dossier);
    res.json({ ok: true, ...result });
  });

  app.post("/api/admin/dossiers/:id/dedupe-documents", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === req.params.id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });
    const { dedupeDossierDocuments } = await import("./gmailAttachments");
    const { removed, remaining } = dedupeDossierDocuments(dossier);
    await writeDB(db, dossier);
    res.json({ ok: true, removed, remaining });
  });

  app.post("/api/admin/dossiers/:id/resync-attachments", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Connexion Google requise." });
    }
    const accessToken = authHeader.split(" ")[1];
    const { id } = req.params;

    try {
      const db = await readDBAsync();
      const dossier = db.dossiers.find((d: any) => d.id === id);
      if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });

      const { dedupeDossierDocuments } = await import("./gmailAttachments");
      const dedupeBefore = dedupeDossierDocuments(dossier);

      const { resyncDossierGmailAttachments } = await import("./mailAutomation");
      const result = await resyncDossierGmailAttachments(accessToken, dossier);
      const dedupeAfter = dedupeDossierDocuments(dossier);
      await writeDB(db, dossier);

      res.json({
        success: true,
        dossierId: id,
        documentsCount: dossier.formData?.documents?.length ?? 0,
        dedupeRemoved: dedupeBefore.removed + dedupeAfter.removed,
        added: result.added,
        scanned: result.scanned,
        attachmentPartsFound: result.attachmentPartsFound,
        driveUploaded: result.driveUploaded ?? 0,
        hasDriveFolder: Boolean(dossier.workspaceFolderId),
        errors: result.errors,
      });
    } catch (err: any) {
      console.error("resync-attachments", err);
      res.status(500).json({ error: err?.message || String(err) });
    }
  });

  app.post("/api/dossiers/:id/process", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const { id } = req.params;
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing Google Token" });
    }
    const token = authHeader.split(" ")[1];

    try {
      const db = await readDBAsync();
      const dossier = db.dossiers.find((d: any) => d.id === id);
      if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });

      dossier.status = "TRAITÉ";
      await writeDB(db, dossier);

      if (dossier.formData?.documents?.length > 0) {
        const docData = dossier.formData.documents[0];
        const localFilePath = docData.localPath;
        if (fs.existsSync(localFilePath)) {
          const fileContent = fs.readFileSync(localFilePath);

          const metadata = { name: docData.name || `Upload_${id}` };
          const form = new FormData();
          form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
          form.append("file", new Blob([fileContent]));

          await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: form as any,
          });
        }
      }

      res.json({ success: true, message: "Exported to Google Workspace" });
    } catch (error: any) {
      console.error("Workspace API error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/dossiers/:id/email", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const { id } = req.params;
    const { subject, text, html } = (req.body || {}) as any;
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing Google Token" });
    }
    const accessToken = authHeader.split(" ")[1];
    const db = await readDBAsync();

    const dossier = db.dossiers.find((d: any) => d.id === id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });

    const toEmail = dossier.formData?.assures?.[0]?.email || "assurance@leclubimmobilier.fr";
    const mailContent = html || text;

    const sendResult = await sendEmailReplyWithGmailAPI(accessToken, toEmail, subject, mailContent);
    if (sendResult?.ok) {
      if (!dossier.communications) dossier.communications = [];
      dossier.communications.push({
        id: "msg_" + Date.now(),
        direction: "outbound",
        to: toEmail,
        subject,
        text: text || "Mail HTML envoyé",
        date: new Date().toISOString(),
      });
      dossier.status = "MAIL_ENVOYÉ";
      await writeDB(db, dossier);
      res.json({ success: true, message: "Email envoyé avec Gmail !" });
    } else {
      res.status(500).json({ error: "Echec de l'envoi de l'email via Gmail API" });
    }
  });

  app.get("/api/portail/demo", async (_req, res) => {
    res.json({
      dossierId: "LCIF-930840",
      clientPrenom: "Marie",
      status: {
        label: "Étude en cours",
        description: "Nous analysons votre dossier. Vous serez contactée par email si besoin.",
      },
      steps: [
        { key: "received", label: "Demande reçue", done: true },
        { key: "docs", label: "Documents prêt reçus", done: true },
        { key: "study", label: "Étude des économies", done: false },
        { key: "done", label: "Proposition envoyée", done: false },
      ],
      documents: [
        { key: "offre", label: "Offre de prêt", received: true, requiredNow: false },
        { key: "amort", label: "Tableau d'amortissement", received: true, requiredNow: false },
        { key: "cni", label: "Pièce d'identité", received: false, requiredNow: false },
        { key: "rib", label: "RIB", received: false, requiredNow: false },
      ],
      tips: [
        "Pour toute question, répondez aux emails envoyés par Le Club Immobilier Français.",
      ],
      lastUpdateLabel: new Date().toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    });
  });

  app.get("/api/portail/:token", async (req, res) => {
    await ensureBackgroundServicesStarted();
    try {
      const db = await readDBAsync();
      const { findDossierByPortalToken, buildClientPortalView } = await import("./clientPortal");
      const dossier = findDossierByPortalToken(db.dossiers, req.params.token);
      if (!dossier) return res.status(404).json({ error: "Lien de suivi invalide." });
      if (!dossier.clientPortal) {
        dossier.clientPortal = { token: String(req.params.token), createdAt: new Date().toISOString() };
      }
      dossier.clientPortal.lastAccessAt = new Date().toISOString();

      const loanDocs = (dossier.formData?.documents || []).filter((d: any) => {
        const c = String(d?.category || "");
        return c === "offre" || c === "fiche" || c === "tableau";
      });
      const missingLoanAnalysis = loanDocs.some(
        (d: any) => !d?.loanSignal && /\.pdf$/i.test(String(d?.name || "")),
      );
      if (missingLoanAnalysis && loanDocs.length >= 2) {
        try {
          const { reanalyzeDossierLoanDocuments } = await import("./reanalyzeLoanDocuments");
          await reanalyzeDossierLoanDocuments(dossier, UPLOADS_DIR);
        } catch (reErr: any) {
          appendLog(`[Portail] Réanalyse docs prêt ${dossier.id}: ${reErr?.message || reErr}`);
        }
      }

      const { ensureSubscriptionProgressOnAcceptance } = await import("./subscriptionProgress");
      ensureSubscriptionProgressOnAcceptance(dossier);

      await writeDB(db, dossier);
      res.json(buildClientPortalView(dossier));
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  app.get("/api/admin/work-queue", async (_req, res) => {
    await ensureBackgroundServicesStarted();
    const db = await readDBAsync();
    const { buildRemiWorkQueue } = await import("./remiWorkQueue");
    res.json({ items: buildRemiWorkQueue(db.dossiers) });
  });

  app.get("/api/admin/activity-metrics", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const db = await readDBAsync();
    const periodDays = Number(req.query.days || 7);
    const { computeActivityMetrics } = await import("./activityMetrics");
    let kpiBackfilled = 0;
    const { refreshStudyKpiFromCommunications, getLoanCapitalFromDossier } = await import(
      "./studyEmailKpi",
    );
    for (const d of db.dossiers) {
      const kpi = d.studyKpi;
      const loan = getLoanCapitalFromDossier(d);
      const gross = Number(kpi?.grossSavingsEur) || 0;
      const { hasStudyBeenSent } = await import("./dossierLifecycle");
      const suspectKpi =
        kpi?.confidence === "low" ||
        gross <= 0 ||
        (gross > 0 && loan > 0 && gross > loan * 1.2);
      if (!kpi?.extractedAt || suspectKpi) {
        if (hasStudyBeenSent(d) && refreshStudyKpiFromCommunications(d)) kpiBackfilled += 1;
      }
    }
    if (kpiBackfilled > 0) {
      await writeDB(db);
    }
    res.json(computeActivityMetrics(db.dossiers, periodDays));
  });

  app.get("/api/admin/ops-daily-report", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const db = await readDBAsync();
    const {
      buildOpsDailyReport,
      loadPersistedOpsReport,
      parisYesterdayYmd,
      shiftParisYmd,
    } = await import("./opsDailyReport");
    const reportYmd = String(req.query.date || parisYesterdayYmd());
    const persisted = loadPersistedOpsReport(reportYmd);
    let report = persisted || buildOpsDailyReport(db.dossiers, reportYmd);
    const withAi = String(req.query.ai || "") === "1";
    if (withAi && !persisted?.ai) {
      const { enrichOpsDailyReportWithAi } = await import("./opsDailyReportAi");
      report = await enrichOpsDailyReportWithAi(report, db.dossiers);
    }
    res.json({
      report,
      availableDates: {
        requested: reportYmd,
        yesterday: parisYesterdayYmd(),
        dayBefore: shiftParisYmd(parisYesterdayYmd(), -1),
      },
      persisted: Boolean(persisted),
    });
  });

  app.post("/api/admin/ops-daily-report/run", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const body = (req.body || {}) as {
      date?: string;
      deliver?: boolean;
      sendEmail?: boolean;
      sendTelegram?: boolean;
    };
    const { runOpsDailyReport } = await import("./opsDailyReport");
    const result = await runOpsDailyReport({
      reportYmd: body.date,
      deliver: Boolean(body.deliver),
      sendEmail: body.sendEmail !== false,
      sendTelegram: body.sendTelegram !== false,
    });
    res.json({
      ok: true,
      reportYmd: result.reportYmd,
      metrics: result.metrics,
      incidentCount: result.incidents.length,
      delivery: result.delivery,
      markdownPreview: result.markdown.slice(0, 4000),
    });
  });

  app.get("/api/admin/dossiers/:id/camille-context", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === req.params.id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });
    const { buildCamilleAdminContext } = await import("./camilleAdminContext");
    res.json(buildCamilleAdminContext(dossier));
  });

  app.post("/api/admin/dossiers/:id/camille-resume", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const { id } = req.params;
    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });

    const { resumeCamilleForDossier } = await import("./camilleStaffHandoff");
    resumeCamilleForDossier(dossier, "admin_resume");

    const reprocess = (req.body as any)?.reprocessLastInbound !== false;
    if (reprocess) {
      const lastIn = [...(dossier.communications || [])]
        .filter((c: any) => c.direction === "inbound")
        .sort(
          (a: any, b: any) =>
            new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime(),
        )[0];
      if (lastIn?.gmailId && Array.isArray(dossier.processedGmailIds)) {
        dossier.processedGmailIds = dossier.processedGmailIds.filter(
          (gid: string) => gid !== lastIn.gmailId,
        );
      }
    }

    await writeDB(db, dossier);

    let aiReplies = 0;
    const authHeader = req.headers.authorization;
    const token =
      authHeader && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : latestAccessToken;
    if (reprocess && token) {
      try {
        const { syncGmailInbox } = await import("./mailAutomation");
        const { processIncomingClientEmail } = await import("./aiAssistant");
        const result = await syncGmailInbox(token, db, processIncomingClientEmail);
        aiReplies = result.aiReplies || 0;
        const { writeDirtyDossiers } = await import("./db");
        await writeDirtyDossiers(result.db, result.dirtyDossierIds || []);
      } catch (err: any) {
        return res.status(500).json({
          success: false,
          error: err?.message || String(err),
          camilleStaffUntil: dossier.camilleStaffHandledUntil || null,
        });
      }
    }

    res.json({
      success: true,
      camilleStaffUntil: dossier.camilleStaffHandledUntil || null,
      reprocessed: reprocess,
      aiReplies,
    });
  });

  app.post("/api/admin/dossiers/:id/refresh-study-kpi", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === req.params.id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });
    delete dossier.studyKpi;
    const { refreshStudyKpiFromCommunications } = await import("./studyEmailKpi");
    const ok = refreshStudyKpiFromCommunications(dossier);
    if (ok) await writeDB(db, dossier);
    res.json({ ok, studyKpi: dossier.studyKpi || null });
  });

  app.get("/api/admin/dossiers/:id/ai-audit", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === req.params.id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });
    const { getAiAuditTrail } = await import("./aiAuditLog");
    res.json({ entries: getAiAuditTrail(dossier) });
  });

  app.get("/api/admin/dossiers/:id/portal-preview", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === req.params.id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });
    const { buildClientPortalView } = await import("./clientPortal");
    res.json(buildClientPortalView(dossier));
  });

  app.get("/api/admin/dossiers/:id/subscription-progress", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === req.params.id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });
    const { buildSubscriptionProgressAdminView } = await import("./subscriptionProgress");
    res.json(buildSubscriptionProgressAdminView(dossier));
  });

  app.patch("/api/admin/dossiers/:id/subscription-progress", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === req.params.id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });

    const {
      coerceSubscriptionPhase,
      applySubscriptionPhaseUpdate,
      buildSubscriptionProgressAdminView,
    } = await import("./subscriptionProgress");
    const { addEvent } = await import("./dossierModel");

    const phase = coerceSubscriptionPhase((req.body as any)?.phase);
    if (!phase) {
      return res.status(400).json({ error: "Phase invalide" });
    }

    const note = typeof (req.body as any)?.note === "string" ? (req.body as any).note.trim() : "";
    const { previousPhase, label } = applySubscriptionPhaseUpdate(dossier, phase, {
      updatedBy: String((req.body as any)?.updatedBy || "admin"),
      note: note || undefined,
    });

    dossier.updatedAt = new Date().toISOString();
    addEvent(dossier, {
      type: "STATUS_CHANGE",
      actor: { kind: "ADMIN", label: "Admin" },
      message: `Phase souscription : ${label}${note ? ` — ${note.slice(0, 120)}` : ""}`,
      meta: {
        subscriptionPhase: phase,
        previousPhase,
        dossierStatus: dossier.status,
      },
    });

    await writeDB(db, dossier);

    const { buildClientPortalView } = await import("./clientPortal");
    res.json({
      ok: true,
      portal: buildClientPortalView(dossier),
      subscription: buildSubscriptionProgressAdminView(dossier),
      dossierStatus: dossier.status,
    });
  });

  app.get("/api/admin/dossiers/:id/portal-link", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === req.params.id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });
    const { ensureClientPortalToken, getClientPortalAbsoluteUrl } = await import("./clientPortal");
    const token = ensureClientPortalToken(dossier);
    await writeDB(db, dossier);
    const origin = String(req.headers.origin || "").replace(/\/$/, "");
    res.json({
      token,
      path: `/suivi/${token}`,
      url: getClientPortalAbsoluteUrl(
        token,
        origin || process.env.PUBLIC_APP_URL || process.env.RAILWAY_PUBLIC_DOMAIN,
      ),
    });
  });

  app.post("/api/admin/work-queue/:id/snooze", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === req.params.id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });
    const hours = Number((req.body as any)?.hours || 24);
    if (!dossier.remiQueue) dossier.remiQueue = {};
    dossier.remiQueue.snoozedUntil = new Date(Date.now() + hours * 3600 * 1000).toISOString();
    dossier.remiQueue.dismissedAt = undefined;
    await writeDB(db, dossier);
    res.json({ success: true, snoozedUntil: dossier.remiQueue.snoozedUntil });
  });

  app.post("/api/admin/work-queue/:id/dismiss", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === req.params.id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });
    if (!dossier.remiQueue) dossier.remiQueue = {};
    const kind = String((req.body as any)?.kind || "").trim();
    if (kind) {
      const kinds = dossier.remiQueue.dismissedKinds || [];
      if (!kinds.includes(kind)) kinds.push(kind);
      dossier.remiQueue.dismissedKinds = kinds;
    } else {
      dossier.remiQueue.dismissedAt = new Date().toISOString();
    }
    await writeDB(db, dossier);
    res.json({ success: true });
  });

  app.post("/api/dossiers/:id/generate-study-email", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const { id } = req.params;
    const { calculationData } = (req.body || {}) as any;
    const db = await readDBAsync();

    const dossier = db.dossiers.find((d: any) => d.id === id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });

    try {
      const html = await generateInsuranceStudyMail(dossier, calculationData);
      const clientName = dossier.formData?.assures?.[0]?.prenom || "Client";
      const bruteVal = calculationData.totalSavingsBrute || 0;
      const subject = `${clientName}, votre assurance emprunteur peut vous faire économiser ~${bruteVal} €`;

      res.json({ success: true, subject, body: html });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: "Erreur lors de la génération du mail" });
    }
  });

  // Ancien endpoint non sécurisé (chemin arbitraire) — gardé pour compat mais désactivé
  app.get("/api/files", async (_req, res) => {
    res.status(410).send("Deprecated. Use /api/dossiers/:id/documents/:docId/download");
  });

  app.post("/api/admin/dossiers/:id/compact-firestore", async (req, res) => {
    try {
      const db = await readDBAsync();
      const dossier = db.dossiers.find((d: any) => d.id === req.params.id);
      if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });
      const { compactDossierForPersistence } = await import("./dossierFirestoreCompact");
      const before = JSON.stringify(dossier).length;
      const compacted = compactDossierForPersistence(dossier);
      const after = JSON.stringify(compacted).length;
      Object.assign(dossier, compacted);
      dossier.updatedAt = new Date().toISOString();
      await writeDB(db, dossier);
      res.json({ success: true, dossierId: dossier.id, bytesBefore: before, bytesAfter: after });
    } catch (err: any) {
      console.error("compact-firestore", err);
      res.status(500).json({ error: err?.message || String(err) });
    }
  });

  app.post("/api/admin/dossiers/:id/checklist/:key/validate", async (req, res) => {
    await ensureBackgroundServicesStarted();
    try {
      const { id, key } = req.params;
      const db = await readDBAsync();
      const dossier = db.dossiers.find((d: any) => d.id === id);
      if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });

      const { setAdminChecklistOverride } = await import("./adminChecklistValidation");
      const body = (req.body || {}) as { note?: string; author?: string };
      setAdminChecklistOverride(
        dossier,
        key,
        {
          status: "ok",
          validatedAt: new Date().toISOString(),
          validatedBy: body.author || "admin",
          note: body.note,
        },
        { author: body.author },
      );
      await writeDB(db, dossier);

      const { computeDocumentChecklistForDossier } = await import("../shared/documentChecklist");
      res.json({ success: true, checklist: computeDocumentChecklistForDossier(dossier) });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || String(err) });
    }
  });

  app.delete("/api/admin/dossiers/:id/checklist/:key/validate", async (req, res) => {
    await ensureBackgroundServicesStarted();
    try {
      const { id, key } = req.params;
      const db = await readDBAsync();
      const dossier = db.dossiers.find((d: any) => d.id === id);
      if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });

      const { setAdminChecklistOverride } = await import("./adminChecklistValidation");
      setAdminChecklistOverride(dossier, key, null, { author: "admin" });
      await writeDB(db, dossier);

      const { computeDocumentChecklistForDossier } = await import("../shared/documentChecklist");
      res.json({ success: true, checklist: computeDocumentChecklistForDossier(dossier) });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || String(err) });
    }
  });

  app.patch("/api/admin/dossiers/:id/documents/:docId", async (req, res) => {
    await ensureBackgroundServicesStarted();
    try {
      const { id, docId } = req.params;
      const category = String((req.body as any)?.category || "").trim().toLowerCase();
      if (!category) return res.status(400).json({ error: "category requis" });

      const db = await readDBAsync();
      const dossier = db.dossiers.find((d: any) => d.id === id);
      if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });

      const doc = (dossier.formData?.documents || []).find(
        (d: any) => String(d.id) === docId || String(d.name) === docId,
      );
      if (!doc) return res.status(404).json({ error: "Document introuvable" });

      doc.category = category;
      const { reanalyzeDossierLoanDocuments } = await import("./reanalyzeLoanDocuments");
      await reanalyzeDossierLoanDocuments(dossier, UPLOADS_DIR);

      dossier.updatedAt = new Date().toISOString();
      addEvent(dossier, {
        type: "NOTE_ADDED",
        actor: { kind: "ADMIN", label: "Rémi" },
        message: `Type du document « ${doc.name} » défini sur : ${category}`,
      });
      await writeDB(db, dossier);

      const { computeDocumentChecklistForDossier } = await import("../shared/documentChecklist");
      res.json({
        success: true,
        document: doc,
        checklist: computeDocumentChecklistForDossier(dossier),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || String(err) });
    }
  });

  app.post("/api/admin/dossiers/:id/reanalyze-documents", async (req, res) => {
    await ensureBackgroundServicesStarted();
    try {
      const db = await readDBAsync();
      const dossier = db.dossiers.find((d: any) => d.id === req.params.id);
      if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });
      const { reanalyzeDossierLoanDocuments } = await import("./reanalyzeLoanDocuments");
      const result = await reanalyzeDossierLoanDocuments(dossier, UPLOADS_DIR);
      await writeDB(db, dossier);
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error("reanalyze-documents", err);
      res.status(500).json({ error: err?.message || String(err) });
    }
  });

  app.post("/api/admin/reanalyze-documents", async (req, res) => {
    await ensureBackgroundServicesStarted();
    try {
      const db = await readDBAsync();
      const body = (req.body || {}) as { dossierIds?: string[]; limit?: number };
      const { reanalyzeAllDossiersLoanDocuments } = await import("./reanalyzeLoanDocuments");
      const summary = await reanalyzeAllDossiersLoanDocuments(db.dossiers || [], UPLOADS_DIR, {
        dossierIds: body.dossierIds,
        limit: body.limit,
      });
      await writeDB(db);
      res.json({ success: true, ...summary });
    } catch (err: any) {
      console.error("reanalyze-documents-all", err);
      res.status(500).json({ error: err?.message || String(err) });
    }
  });

  let ocrBackfillStarted = false;
  const scheduleOcrHybridBackfill = () => {
    if (ocrBackfillStarted) return;
    ocrBackfillStarted = true;
    void (async () => {
      try {
        await ensureBackgroundServicesStarted();
        const db = await readDBAsync();
        const { runOcrHybridBackfillIfNeeded } = await import("./reanalyzeLoanDocuments");
        const { ran, summary } = await runOcrHybridBackfillIfNeeded(db, UPLOADS_DIR, DATA_DIR);
        if (ran && (summary?.totalAnalyzed || 0) > 0) {
          await writeDB(db);
        }
      } catch (err: any) {
        console.error("[OCR hybride] Backfill au démarrage:", err?.message || err);
      }
    })();
  };
  scheduleOcrHybridBackfill();

  return app;
}

