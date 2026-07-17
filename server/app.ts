import express from "express";
import path from "path";
import multer from "multer";
import fs from "fs";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { resolveCorsOrigins } from "../shared/platformUrls";

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
import { isVisibleAdminDossier } from "../shared/camilleMeta";
import { DRIVE_CONFIG_VERSION, resolveDriveParentFolderId } from "./driveConfig";
import { mergeFormDocumentsWithUploads } from "./documentMerge";
import { canUseDomainWideDelegation } from "./googleDelegatedAuth";
import { hasServerOAuthRefreshToken } from "./googleOAuthServer";
import { getServerAccessToken } from "./googleOAuthServer";
import { sendDossierConfirmationEmail } from "./dossierConfirmationEmail";
import {
  canAutonomousGoogleMailOrDrive,
  getBearerTokenFromRequest,
  resolveAutonomousGoogleAccessToken,
} from "./requestAuth";
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
    const { scheduleConfirmationEmailRecoveryOnBoot } =
      require("./confirmationEmailRecovery") as typeof import("./confirmationEmailRecovery");
    scheduleConfirmationEmailRecoveryOnBoot((msg) => console.log(msg));
  }
  return firebaseInitPromise;
}

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  const corsOrigins = resolveCorsOrigins();
  app.use(
    cors({
      origin:
        corsOrigins === true
          ? true
          : (origin, callback) => {
              if (!origin) return callback(null, true);
              const ok = corsOrigins.some(
                (allowed) => allowed.toLowerCase() === origin.replace(/\/$/, "").toLowerCase(),
              );
              // Sous-domaines Vercel preview (déploiements PR)
              const vercelPreview = /\.vercel\.app$/i.test(origin);
              callback(null, ok || vercelPreview);
            },
      credentials: true,
    }),
  );
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

  app.use(async (req, res, next) => {
    const { adminAuthMiddleware } = await import("./adminAuth");
    return adminAuthMiddleware(req, res, next);
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
    const { isTelegramEnabled } = await import("./telegramCamille");
    const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
    const prodLike =
      process.env.FIREBASE_REQUIRED === "true" || Boolean(process.env.RAILWAY_ENVIRONMENT);
    if (isTelegramEnabled() && prodLike && !secret) {
      console.error("[Telegram webhook] TELEGRAM_WEBHOOK_SECRET requis en production");
      return res.status(503).json({ error: "Webhook Telegram non configuré" });
    }
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
      (await import("./telegramCamille")).resolveTelegramWebhookBaseUrl() ||
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
      adminAuthRequired: (await import("./adminAuth")).isAdminAuthRequired(),
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
      camille: {
        productionSafeMode:
          String(process.env.CAMILLE_PRODUCTION_SAFE_MODE ?? "true").toLowerCase() !== "false",
        playbookSeedVersion: (await import("./camillePlaybooks")).getPlaybookSeedVersion(),
        playbookCount: (await (await import("./camillePlaybooks")).listPlaybooks(500)).length,
        playbookSelfCheckOk: (await (await import("./camillePlaybooks")).runPlaybookSelfCheck()).ok,
        schedule: await (await import("./camilleScheduleConfig")).loadCamilleSchedule(),
        scheduleOpenNow: await (await import("./camilleScheduleConfig")).isCamilleScheduleOpenNow(),
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
      const mergedFormData = { ...formDataWithoutConsent, documents };
      const apporteurRefToken = String(mergedFormData.apporteurRefToken || "").trim() || undefined;
      if (apporteurRefToken) mergedFormData.apporteurRefToken = apporteurRefToken;
      const clientEmail = mergedFormData.assures?.[0]?.email;

      const {
        reconcileLeadOnFormSubmit,
        adoptLeadForFormSubmission,
        applyFormToExistingDossier,
      } = await import("./leadDossierMerge");

      const leadPlan = reconcileLeadOnFormSubmit(db, clientEmail);
      let newDossier: any;
      let linkedFromProspect = false;

      if (leadPlan.action === "adopt_lead") {
        linkedFromProspect = true;
        newDossier = adoptLeadForFormSubmission(leadPlan.lead, {
          formData: mergedFormData,
          privacyConsent: privacyConsentRecord,
        });
        const idx = db.dossiers.findIndex((d: any) => d.id === newDossier.id);
        if (idx >= 0) db.dossiers[idx] = newDossier;
        else db.dossiers.push(newDossier);
        appendLog(
          `Formulaire rattaché au prospect ${newDossier.id} (${String(clientEmail || "").toLowerCase()}).`,
        );
      } else if (leadPlan.action === "merge_leads_into_existing") {
        linkedFromProspect = true;
        newDossier = applyFormToExistingDossier(leadPlan.target, {
          formData: mergedFormData,
          privacyConsent: privacyConsentRecord,
          leadsToMerge: leadPlan.leads,
        });
        db.dossiers = db.dossiers.filter((d: any) => !leadPlan.removeLeadIds.includes(d.id));
        const idx = db.dossiers.findIndex((d: any) => d.id === newDossier.id);
        if (idx >= 0) db.dossiers[idx] = newDossier;
        appendLog(
          `Formulaire fusionné dans ${newDossier.id} — prospect(s) ${leadPlan.removeLeadIds.join(", ")} rattaché(s).`,
        );
      } else {
        newDossier = ensureDossierShape({
          id:
            formData.id ||
            `LCIF-${Math.floor(Math.random() * 1000000)
              .toString()
              .padStart(6, "0")}`,
          status: "NOUVEAU",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          formData: mergedFormData,
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
        db.dossiers.push(newDossier);
      }

      addEvent(newDossier, {
        type: "PRIVACY_CONSENT_RECORDED",
        actor: { kind: "SYSTEM" },
        message: linkedFromProspect
          ? "Consentement enregistré — dossier relié au prospect (même email)."
          : "Consentement politique de confidentialité enregistré.",
        meta: {
          policyVersion: privacyConsentRecord.policyVersion,
          acceptedAt: privacyConsentRecord.acceptedAt,
          linkedFromProspect,
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
      const logConsentToSheet = async () => {
        const { logDossierPrivacyConsentToSheet } = await import("./rgpdGoogleSheets");
        return logDossierPrivacyConsentToSheet(newDossier, privacyConsentRecord, {
          referralToken: apporteurRefToken,
        });
      };

      try {
        const sheetRes = await logConsentToSheet();
        if (sheetRes.ok && sheetRes.sheetsLoggedAt) {
          newDossier.privacyConsent = {
            ...privacyConsentRecord,
            sheetsLoggedAt: sheetRes.sheetsLoggedAt,
          };
        } else {
          appendLog(`[RGPD] Journal Sheets (${newDossier.id}): ${sheetRes.error}`);
        }
      } catch (sheetErr: any) {
        appendLog(`[RGPD] Journal Sheets erreur (${newDossier.id}): ${sheetErr?.message || sheetErr}`);
      }

      try {
        const refToken = apporteurRefToken || "";
        if (refToken) {
          const { attachNetworkToNewDossier, syncNetworkReferralFromDossier } = await import("./networkStore");
          const { attachApporteurToNewDossier, syncReferralFromDossier } = await import("./apporteurStore");
          const attachedNetwork = await attachNetworkToNewDossier(newDossier, refToken);
          if (!attachedNetwork) {
            await attachApporteurToNewDossier(newDossier, refToken);
          }
          await syncNetworkReferralFromDossier(newDossier, "formulaire");
          await syncReferralFromDossier(newDossier, "formulaire");
        }
      } catch (apErr: any) {
        appendLog(`[Apporteur] Attribution (${newDossier.id}): ${apErr?.message || apErr}`);
      }

      await writeDB(db, newDossier);
      appendLog(`Succès d'écriture du dossier ${newDossier.id} dans la base de données.`);

      if (!newDossier.privacyConsent?.sheetsLoggedAt) {
        try {
          const retryRes = await logConsentToSheet();
          if (retryRes.ok && retryRes.sheetsLoggedAt) {
            newDossier.privacyConsent = {
              ...privacyConsentRecord,
              sheetsLoggedAt: retryRes.sheetsLoggedAt,
            };
            await writeDB(db, newDossier);
            appendLog(`[RGPD] Journal Sheets rattrapé (${newDossier.id}).`);
          }
        } catch (retryErr: any) {
          appendLog(`[RGPD] Retry journal Sheets (${newDossier.id}): ${retryErr?.message || retryErr}`);
        }
      }

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
      if (toEmail) {
        const requestAccessToken = getBearerTokenFromRequest(req);
        const portalBase = resolvePublicAppBaseUrl(
          String(req.headers.origin || req.headers.referer || "").replace(/\/$/, ""),
        );
        sendDossierConfirmationEmail(newDossier, {
          adminAccessToken: requestAccessToken || null,
          portalBaseUrl: portalBase,
          log: appendLog,
        })
          .then(() => writeDB(db, newDossier))
          .catch(async (err: any) => {
            appendLog(`[Email Error] Erreur confirmation : ${err?.message || String(err)}`);
            await writeDB(db, newDossier);
          });
      }

      // Export auto Drive (compte de service recommandé — formulaire sans admin connecté)
      const {
        hasServiceAccountReady,
        hasServiceAccountConfigured,
        loadServiceAccountDetails,
      } = await import("./serviceAccount");
      const saDetails = loadServiceAccountDetails();
      const requestAccessToken = getBearerTokenFromRequest(req);
      const canAutoDrive =
        hasServiceAccountReady() || canAutonomousGoogleMailOrDrive() || Boolean(requestAccessToken);

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
      if (requestAccessToken) {
        driveTokenForAutoExport = requestAccessToken;
      } else {
        driveTokenForAutoExport = await resolveAutonomousGoogleAccessToken();
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
        status: "PROSPECT",
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
        leadSource: "public_help",
      } as any);
      addEvent(leadDossier, {
        type: "DOSSIER_CREATED",
        actor: { kind: "SYSTEM" },
        message: "Pré-dossier créé via aide formulaire — traitement manuel (pas de réponse auto Camille).",
        meta: { clientMessage: message.slice(0, 500) },
      });
      db.dossiers.push(leadDossier);
      await writeDB(db, leadDossier);

      res.json({
        success: true,
        ref: leadId,
        message: "Votre demande a été enregistrée. L'équipe vous recontactera sous peu.",
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  app.get("/api/dossiers", listDossiersLimiter, async (_req, res) => {
    await ensureBackgroundServicesStarted();
    const db = await readDBAsync();
    const sorted = db.dossiers
      .filter((d: any) => isVisibleAdminDossier(d.id))
      .sort(
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
        db.dossiers[index].statusManualAt = new Date().toISOString();
        addEvent(dossier, {
          type: "STATUS_CHANGED",
          actor: { kind: "ADMIN" },
          meta: { from: before.status, to: req.body.status },
        });

        const nextStatus = String(req.body.status || "");
        if (nextStatus === "ADHESION_EN_COURS") {
          const {
            applySubscriptionPhaseUpdate,
            coerceSubscriptionPhase,
            phaseRank,
          } = await import("./subscriptionProgress");
          const { recordClientInsuranceAcceptance } = await import("./insuranceAcceptance");
          const currentPhase = coerceSubscriptionPhase(dossier.subscriptionProgress?.phase);
          if (phaseRank(currentPhase) < phaseRank("decision_received")) {
            applySubscriptionPhaseUpdate(dossier, "decision_received", {
              updatedBy: "admin",
              note: "Accord client — statut CRM ADHÉSION EN COURS",
            });
          } else {
            recordClientInsuranceAcceptance(dossier, {
              source: "admin",
              note: "Accord client — statut CRM ADHÉSION EN COURS",
            });
          }
          addEvent(dossier, {
            type: "NOTE_ADDED",
            actor: { kind: "ADMIN" },
            message: "Accord client enregistré via statut ADHÉSION EN COURS (Camille + portail synchronisés).",
          });
        }

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
      try {
        const { syncReferralFromDossier } = await import("./apporteurStore");
        const { syncNetworkReferralFromDossier } = await import("./networkStore");
        await syncNetworkReferralFromDossier(dossier, String((req as any).adminEmail || "admin"));
        await syncReferralFromDossier(dossier, String((req as any).adminEmail || "admin"));
      } catch {
        /* non bloquant */
      }
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
    const { to, subject, html, saveAsPlaybook, forceDirect, emailKind: rawEmailKind } =
      (req.body || {}) as any;
    if (!subject || !html) return res.status(400).json({ error: "Missing subject or html" });
    const emailKind = rawEmailKind === "message" ? "message" : "study";

    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });

    const { getConseillerStudySendGate } = await import("./studyConseillerValidation");
    const gate = await getConseillerStudySendGate(dossier);
    if (emailKind === "study" && !forceDirect && gate.blocked) {
      return res.status(400).json({
        error: gate.reason,
        requiresConseillerValidation: true,
      });
    }

    const htmlInput = String(html);
    let finalHtml = htmlInput;
    if (emailKind === "study") {
      const { resolveStudyEmailHtmlForSend, dossierSliceForStudySend } = await import(
        "../shared/studyEmailForSend"
      );
      finalHtml = resolveStudyEmailHtmlForSend({
        draftHtml: htmlInput,
        validation: dossier.studyConseillerValidation,
        dossier: dossierSliceForStudySend(dossier),
      });
    }

    const googleToken = getBearerTokenFromRequest(req);
    const { sendClientStudyEmail } = await import("./sendClientStudyEmail");
    const sendResult = await sendClientStudyEmail({
      dossier,
      subject,
      html: finalHtml,
      to,
      googleToken,
      actorLabel: "Admin",
      actorKind: "ADMIN",
      emailKind,
    });
    if (!sendResult.ok) {
      return res.status(sendResult.status || 500).json({ error: sendResult.error });
    }

    if (saveAsPlaybook) {
      try {
        const { saveApprovedPlaybook, htmlToPlainForPlaybook } = await import("./camillePlaybooks");
        const lastInbound = [...(dossier.communications || [])]
          .reverse()
          .find((c: any) => c.direction === "inbound");
        await saveApprovedPlaybook({
          dossier,
          clientMessage: String(
            saveAsPlaybook.clientMessage || lastInbound?.text || lastInbound?.subject || "",
          ),
          situationSummary: String(
            saveAsPlaybook.situationSummary || `Réponse admin — ${String(subject || "").slice(0, 80)}`,
          ),
          staffGuidance: String(
            saveAsPlaybook.staffGuidance ||
              "Réponse validée par l'équipe depuis l'admin — réutiliser pour cas similaires.",
          ),
          approvedReplyPlain: htmlToPlainForPlaybook(String(html || "")),
          approvedBy: "admin_send_email",
          tags: Array.isArray(saveAsPlaybook.tags) ? saveAsPlaybook.tags.map(String) : undefined,
        });
      } catch (pbErr: any) {
        console.warn(`[Playbooks] Enregistrement après envoi admin: ${pbErr?.message || pbErr}`);
      }
    }

    try {
      await writeDB(db, dossier);
    } catch (err: any) {
      console.error("[send-email] Persistance Firestore:", err?.message || err);
      return res.json({
        success: true,
        providerId: sendResult.providerId,
        channel: sendResult.channel,
        simulated: false,
        warning:
          "Email envoyé via Gmail, mais l'historique n'a pas pu être enregistré (Firestore saturé). Réessayez dans 1 minute.",
      });
    }
    return res.json({
      success: true,
      providerId: sendResult.providerId,
      channel: sendResult.channel,
      simulated: false,
    });
  });

  app.post("/api/admin/dossiers/:id/submit-study-to-conseiller", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const { id } = req.params;
    const { subject, html, debriefNote } = (req.body || {}) as any;
    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });

    const {
      submitStudyToConseiller,
      resolvePublicBaseFromRequest,
    } = await import("./studyConseillerValidation");
    const result = await submitStudyToConseiller({
      dossier,
      subject: String(subject || ""),
      html: String(html || ""),
      submittedBy: String((req as any).adminEmail || "admin"),
      publicBaseUrl: resolvePublicBaseFromRequest(req),
      debriefNote: debriefNote ? String(debriefNote) : undefined,
    });
    if (!result.ok) return res.status(400).json({ error: result.error });

    try {
      await writeDB(db, dossier);
    } catch (err: any) {
      console.error("[submit-study-to-conseiller] Persistance:", err?.message || err);
      return res.json({
        success: true,
        validation: result.validation,
        warning: "Soumission enregistrée localement — persistance Firestore incomplète.",
      });
    }
    return res.json({ success: true, validation: result.validation });
  });

  app.get("/api/admin/dossiers/:id/conseiller-study-flow", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === req.params.id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });
    const { dossierRequiresConseillerStudyValidation, getConseillerStudySendGate } = await import(
      "./studyConseillerValidation"
    );
    const { hasStudyBeenSent } = await import("./dossierLifecycle");
    const { resolveStudyEmailHtmlForSend, dossierSliceForStudySend } = await import(
      "../shared/studyEmailForSend"
    );
    const requiresConseillerValidation = await dossierRequiresConseillerStudyValidation(dossier);
    const gate = await getConseillerStudySendGate(dossier);
    const validation = dossier.studyConseillerValidation || null;
    const draftHtml = dossier.studyDraft?.html || validation?.html || "";
    const sendSlice = dossierSliceForStudySend(dossier);
    res.json({
      requiresConseillerValidation,
      canAdminSendStudy: !gate.blocked,
      studySent: hasStudyBeenSent(dossier),
      validation,
      htmlForSend: resolveStudyEmailHtmlForSend({ draftHtml, validation, dossier: sendSlice }),
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
    const y1Monthly =
      comp.extracted?.proposedMonthlyByYear?.find((r) => r.year === 1)?.monthly ??
      comp.extracted?.proposedMonthlyByYear?.[0]?.monthly ??
      comp.result?.table?.find((r) => /année\s*1/i.test(r.label))?.proposedMonthly;
    const annualPremiumEur =
      y1Monthly != null && y1Monthly > 0 ? Math.round(y1Monthly * 12) : undefined;

    const manualCourtage =
      dossier.studyKpi?.source === "manual" &&
      dossier.studyKpi.feesCourtageEur != null &&
      dossier.studyKpi.feesCourtageEur > 0
        ? Math.round(Number(dossier.studyKpi.feesCourtageEur))
        : null;
    const overrideCourtage =
      dossier.clubRevenueKpi?.feesCourtageOverrideEur != null &&
      Number(dossier.clubRevenueKpi.feesCourtageOverrideEur) > 0
        ? Math.round(Number(dossier.clubRevenueKpi.feesCourtageOverrideEur))
        : null;
    const feesCourtageEur =
      manualCourtage ??
      overrideCourtage ??
      (comp.ok ? Math.round(comp.extracted?.feesCourtierTotal || 0) : 0);

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
            feesCourtageEur,
            feesAssureurEur:
              comp.extracted?.feesAssureurTotal != null
                ? Math.round(comp.extracted.feesAssureurTotal)
                : undefined,
            annualPremiumEur,
          }
        : undefined,
    };
    const { applyStudyHtmlOverridesToDossier } = await import("../shared/studyEmailForSend");
    applyStudyHtmlOverridesToDossier(dossier);
    const { materializeStudyEconomics } = await import("./materializeStudyEconomics");
    materializeStudyEconomics(dossier);
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

      let gmailTrashed = 0;
      const clientEmail = String(dossier.formData?.assures?.[0]?.email || "").trim();
      const { isLeadDossier } = await import("./leadDossierMerge");
      const isProspectLead = isLeadDossier(dossier);
      if (clientEmail && isProspectLead) {
        try {
          const { createGmailAuth } = await import("./mailAutomation");
          const { google } = await import("googleapis");
          const { auth: assuranceAuth } = await createGmailAuth(null);
          const gmail = google.gmail({ version: "v1", auth: assuranceAuth as any });
          const { trashGmailMessagesFromSender } = await import("./gmailInboxCleanup");
          const trashResult = await trashGmailMessagesFromSender(gmail, clientEmail);
          gmailTrashed = trashResult.trashed;
        } catch (gmailErr: any) {
          appendLog(
            `[Delete] Gmail corbeille non vidée pour ${clientEmail}: ${gmailErr?.message || gmailErr}`,
          );
        }
      }

      await deleteDossierFromStore(id);

      try {
        const { syncReferralsAfterDossierDeleted } = await import("./apporteurStore");
        const { syncNetworkReferralsAfterDossierDeleted } = await import("./networkStore");
        await syncNetworkReferralsAfterDossierDeleted(id);
        await syncReferralsAfterDossierDeleted(id);
      } catch (apErr: any) {
        appendLog(`[Delete] Sync partenaires ${id}: ${apErr?.message || apErr}`);
      }

      try {
        fs.rmSync(path.join(UPLOADS_DIR, id), { recursive: true, force: true });
      } catch (err) {
        console.error("Failed to remove uploads dir", err);
      }

      appendLog(`Dossier ${id} supprimé.${gmailTrashed ? ` Gmail: ${gmailTrashed} mail(s) en corbeille.` : ""}`);
      res.json({ success: true, gmailTrashed });
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

  app.get("/api/admin/camille-playbooks", async (req, res) => {
    try {
      const { listPlaybooks, loadPlaybookStore } = await import("./camillePlaybooks");
      const limit = Math.min(100, Number(req.query.limit || 50) || 50);
      const store = await loadPlaybookStore();
      res.json({
        success: true,
        playbooks: await listPlaybooks(limit),
        total: store.playbooks.length,
        updatedAt: store.updatedAt,
        seededAt: store.seededAt,
        seedVersion: store.seedVersion,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.post("/api/admin/camille-playbooks", async (req, res) => {
    try {
      const body = (req.body || {}) as any;
      const { saveApprovedPlaybook } = await import("./camillePlaybooks");
      const db = await readDBAsync();
      const dossier =
        db.dossiers.find((d: any) => d.id === String(body.dossierId || "")) ||
        db.dossiers.find((d: any) => d.id === "LCIF-999999") || {
          id: "manual",
          formData: { assures: [{ prenom: "Manuel", nom: "Playbook" }] },
        };
      const playbook = await saveApprovedPlaybook({
        dossier,
        clientMessage: String(body.clientMessagePattern || body.clientMessage || ""),
        situationSummary: String(body.situationSummary || "Cas ajouté manuellement"),
        staffGuidance: String(body.staffGuidance || "Consigne équipe"),
        approvedReplyPlain: String(body.approvedReplyPlain || ""),
        approvedBy: String(body.approvedBy || "admin"),
        tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
      });
      res.json({ success: true, playbook });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.patch("/api/admin/camille-playbooks/:id", async (req, res) => {
    try {
      const { updatePlaybook } = await import("./camillePlaybooks");
      const playbook = await updatePlaybook(req.params.id, (req.body || {}) as any);
      if (!playbook) return res.status(404).json({ error: "Playbook introuvable" });
      res.json({ success: true, playbook });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.delete("/api/admin/camille-playbooks/:id", async (req, res) => {
    try {
      const { deletePlaybook } = await import("./camillePlaybooks");
      const ok = await deletePlaybook(req.params.id);
      if (!ok) return res.status(404).json({ error: "Playbook introuvable" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.get("/api/admin/camille-playbooks/audit", async (_req, res) => {
    try {
      const { auditPlaybookStore } = await import("./camillePlaybooks");
      const audit = await auditPlaybookStore();
      res.json({ success: true, ...audit });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.post("/api/admin/camille-playbooks/seed-defaults", async (req, res) => {
    try {
      const { seedDefaultPlaybooksIfEmpty } = await import("./camillePlaybooks");
      const force = String((req.body as any)?.force || "").toLowerCase() === "true";
      const result = await seedDefaultPlaybooksIfEmpty(force);
      const audit = await (await import("./camillePlaybooks")).auditPlaybookStore();
      res.json({ success: true, ...result, seedVersion: audit.seedVersion, audit });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.get("/api/admin/apporteurs", async (req, res) => {
    try {
      const {
        listApporteurs,
        listReferrals,
        getApporteurSummary,
        listPartnerRecruits,
      } = await import("./apporteurStore");
      const { resolvePublicAppBaseUrl } = await import("./clientPortal");
      const { parseAdminPartnersSegment } = await import("../shared/conseillerImmoClub");
      const apporteurId = String(req.query.apporteurId || "").trim() || undefined;
      const segment = parseAdminPartnersSegment(req.query.segment);
      const { pruneReferralsWithMissingDossiers, syncAllReferralsFromDossiers } = await import("./apporteurStore");
      await pruneReferralsWithMissingDossiers();
      await syncAllReferralsFromDossiers("admin_apporteurs_load");
      const [apporteurs, referrals, summary, partnerRecruits] = await Promise.all([
        listApporteurs(segment ? { segment } : undefined),
        listReferrals(apporteurId ? { apporteurId } : undefined),
        getApporteurSummary(segment ? { segment } : undefined),
        segment === "conseiller_club" ? Promise.resolve([]) : listPartnerRecruits(),
      ]);
      const { readDB } = await import("./db");
      const { buildApporteurLeaderboard } = await import("../shared/apporteurLeaderboard");
      const db = await readDB();
      const dossierById = new Map(db.dossiers.map((d: any) => [d.id, d]));
      const store = await (await import("./apporteurStore")).loadApporteurStore();
      const apporteurIds = new Set(apporteurs.map((a) => a.id));
      const segmentReferrals = store.referrals.filter((r) => apporteurIds.has(r.apporteurId));
      const leaderboard = buildApporteurLeaderboard({
        apporteurs,
        referrals: segmentReferrals,
        dossierById,
      });
      const publicBaseUrl = resolvePublicAppBaseUrl(
        String(req.headers.origin || req.headers.referer || "").replace(/\/$/, ""),
      );
      res.json({ success: true, apporteurs, referrals: segmentReferrals, partnerRecruits, summary, publicBaseUrl, leaderboard, segment: segment || "all" });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.post("/api/admin/apporteurs", async (req, res) => {
    try {
      const { createApporteur } = await import("./apporteurStore");
      const { parseAdminPartnersSegment, isLcifStaffEmail } = await import("../shared/conseillerImmoClub");
      const body = (req.body || {}) as any;
      const segment = parseAdminPartnersSegment(body.segment || req.query.segment);
      let type = String(body.type || "").trim() || "apporteur_affaires";
      if (segment === "conseiller_club") {
        type = "conseiller_immo_club";
      } else if (segment === "business" && type === "conseiller_immo_club") {
        return res.status(400).json({
          success: false,
          error: "Créez les conseillers du club depuis la section Conseillers du club.",
        });
      }
      const email = String(body.email || "").trim().toLowerCase();
      if (type === "conseiller_immo_club" && !isLcifStaffEmail(email)) {
        return res.status(400).json({
          success: false,
          error: "Les conseillers du club doivent utiliser une adresse @leclubimmobilier.fr.",
        });
      }
      const apporteur = await createApporteur({
        companyName: body.companyName,
        contactPrenom: body.contactPrenom,
        contactNom: body.contactNom,
        contactName: body.contactName,
        email: body.email,
        phone: body.phone,
        addressLine: body.addressLine,
        postalCode: body.postalCode,
        city: body.city,
        siret: body.siret,
        siren: body.siren,
        companyLegalName: body.companyLegalName,
        legalForm: body.legalForm,
        legalFormOther: body.legalFormOther,
        type,
        typeCustomLabel: body.typeCustomLabel,
        notes: body.notes,
        referralToken: body.referralToken,
        sponsorId: segment === "conseiller_club" ? undefined : body.sponsorId,
      });
      res.json({ success: true, apporteur });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.patch("/api/admin/apporteurs/:id", async (req, res) => {
    try {
      const { updateApporteur } = await import("./apporteurStore");
      const body = { ...(req.body || {}) } as any;
      if (body.publicProfile != null) {
        const {
          normalizeApporteurPublicProfile,
          validateApporteurPublicProfile,
        } = await import("../shared/apporteurPublicProfile");
        const profile = normalizeApporteurPublicProfile(body.publicProfile, { updatedBy: "admin" });
        const check = validateApporteurPublicProfile(profile);
        if (!check.ok) return res.status(400).json({ success: false, error: check.error });
        body.publicProfile = profile;
      }
      const apporteur = await updateApporteur(req.params.id, body);
      res.json({ success: true, apporteur });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.delete("/api/admin/apporteurs/:id", async (req, res) => {
    try {
      const { deleteApporteurPermanently } = await import("./apporteurStore");
      await deleteApporteurPermanently(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.post("/api/admin/apporteurs/:id/send-portal-invite", async (req, res) => {
    try {
      const { findApporteurById } = await import("./apporteurStore");
      const { sendApporteurPortalInvite } = await import("./apporteurNotify");
      const { resolvePublicAppBaseUrl } = await import("./clientPortal");
      const apporteur = await findApporteurById(req.params.id);
      if (!apporteur) return res.status(404).json({ success: false, error: "Apporteur introuvable" });
      const baseUrl = resolvePublicAppBaseUrl(
        String(req.headers.origin || req.headers.referer || "").replace(/\/$/, ""),
      );
      const sent = await sendApporteurPortalInvite(apporteur, baseUrl);
      if (!sent) {
        return res.status(502).json({ success: false, error: "Envoi email impossible (vérifiez la config Gmail/SMTP)." });
      }
      res.json({
        success: true,
        contractPending: (apporteur.contractStatus || "none") !== "signed",
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.post("/api/admin/apporteurs/:id/send-contract-signing-invite", async (req, res) => {
    try {
      const { findApporteurById } = await import("./apporteurStore");
      const { sendApporteurContractSigningInvite } = await import("./apporteurNotify");
      const { resolvePublicAppBaseUrl } = await import("./clientPortal");
      const apporteur = await findApporteurById(req.params.id);
      if (!apporteur) return res.status(404).json({ success: false, error: "Apporteur introuvable" });
      const baseUrl = resolvePublicAppBaseUrl(
        String(req.headers.origin || req.headers.referer || "").replace(/\/$/, ""),
      );
      const sent = await sendApporteurContractSigningInvite(apporteur, baseUrl);
      if (!sent) {
        return res.status(502).json({ success: false, error: "Envoi email impossible (vérifiez la config Gmail/SMTP)." });
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.post("/api/admin/apporteurs/:id/send-updated-links-email", async (req, res) => {
    try {
      const { findApporteurById } = await import("./apporteurStore");
      const { sendApporteurUpdatedLinksEmail } = await import("./apporteurNotify");
      const { resolvePublicAppBaseUrl } = await import("./clientPortal");
      const apporteur = await findApporteurById(req.params.id);
      if (!apporteur) return res.status(404).json({ success: false, error: "Apporteur introuvable" });
      const baseUrl = resolvePublicAppBaseUrl(
        String(req.headers.origin || req.headers.referer || "").replace(/\/$/, ""),
      );
      const sent = await sendApporteurUpdatedLinksEmail(apporteur, baseUrl);
      if (!sent) {
        return res.status(502).json({
          success: false,
          error: "Envoi email impossible (email, tokens ou config Gmail/SMTP manquants).",
        });
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.post("/api/admin/apporteurs/:id/portal-preview", async (req, res) => {
    try {
      const { findApporteurById } = await import("./apporteurStore");
      const { resolvePublicAppBaseUrl } = await import("./clientPortal");
      const { isConseillerImmoClubType } = await import("../shared/conseillerImmoClub");
      const apporteur = await findApporteurById(req.params.id);
      if (!apporteur) return res.status(404).json({ success: false, error: "Partenaire introuvable" });
      if (!apporteur.portalToken) {
        return res.status(400).json({ success: false, error: "Aucun portail configuré pour ce partenaire." });
      }
      const baseUrl = resolvePublicAppBaseUrl(
        String(req.headers.origin || req.headers.referer || "").replace(/\/$/, ""),
      );
      const isConseiller = isConseillerImmoClubType(apporteur.type);

      if (!isConseiller) {
        const url = `${baseUrl.replace(/\/$/, "")}/apporteur/${apporteur.portalToken}`;
        return res.json({
          success: true,
          emailed: false,
          url,
          isConseiller: false,
          note: "Ouverture directe de l'espace apporteur.",
        });
      }

      const { createAdminPortalPreview } = await import("./conseillerPortalSession");
      const { sendAdminPortalPreviewEmail } = await import("./apporteurNotify");
      const { getPrimaryAdminEmail } = await import("./adminAuth");
      const adminEmail =
        (req as unknown as { adminEmail?: string }).adminEmail || getPrimaryAdminEmail();
      const preview = await createAdminPortalPreview(apporteur.id);
      const url = `${baseUrl.replace(/\/$/, "")}/apporteur/${apporteur.portalToken}?lcif_preview=${encodeURIComponent(
        preview.previewToken,
      )}`;
      const emailed = await sendAdminPortalPreviewEmail({
        adminEmail,
        apporteur,
        previewUrl: url,
        expiresAt: preview.expiresAt,
      });
      res.json({
        success: true,
        emailed,
        url,
        isConseiller: true,
        adminEmail,
        expiresAt: preview.expiresAt,
        note: emailed
          ? `Lien de consultation envoyé à ${adminEmail} (valable 30 min).`
          : "Lien de consultation généré (envoi email indisponible — utilisez le lien retourné).",
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.get("/api/admin/camille-schedule", async (_req, res) => {
    try {
      const { loadCamilleSchedule } = await import("./camilleScheduleConfig");
      const { isWithinCamilleSchedule } = await import("../shared/camilleSchedule");
      const { parisDayHour } = await import("./businessHours");
      const schedule = await loadCamilleSchedule();
      res.json({ ok: true, schedule, openNow: isWithinCamilleSchedule(schedule, parisDayHour()) });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.put("/api/admin/camille-schedule", express.json(), async (req, res) => {
    try {
      const raw = (req.body || {}).schedule ?? req.body;
      if (!raw || typeof raw !== "object") {
        return res.status(400).json({ ok: false, error: "schedule requis." });
      }
      const { saveCamilleSchedule } = await import("./camilleScheduleConfig");
      const { isWithinCamilleSchedule } = await import("../shared/camilleSchedule");
      const { parisDayHour } = await import("./businessHours");
      const schedule = await saveCamilleSchedule(raw);
      res.json({ ok: true, schedule, openNow: isWithinCamilleSchedule(schedule, parisDayHour()) });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.get("/api/admin/kereis-mia-settings", async (_req, res) => {
    try {
      const { loadKereisMiaSettings } = await import("./kereisMiaConfig");
      const settings = await loadKereisMiaSettings();
      res.json({ ok: true, settings });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.put("/api/admin/kereis-mia-settings", express.json(), async (req, res) => {
    try {
      const raw = (req.body || {}).settings ?? req.body;
      if (!raw || typeof raw !== "object") {
        return res.status(400).json({ ok: false, error: "settings requis." });
      }
      const { saveKereisMiaSettings } = await import("./kereisMiaConfig");
      const settings = await saveKereisMiaSettings(raw);
      res.json({ ok: true, settings });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.get("/api/admin/conseiller-formations", async (_req, res) => {
    try {
      const { loadConseillerFormationParcours } = await import("./conseillerFormationsConfig");
      const parcours = await loadConseillerFormationParcours();
      res.json({ ok: true, parcours });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.put("/api/admin/conseiller-formations", express.json(), async (req, res) => {
    try {
      const body = req.body || {};
      const raw = body.parcours || (Array.isArray(body.modules) ? body.modules[0] : null);
      if (!raw || typeof raw !== "object") {
        return res.status(400).json({ ok: false, error: "parcours requis." });
      }
      const { saveConseillerFormationParcours } = await import("./conseillerFormationsConfig");
      const parcours = await saveConseillerFormationParcours(raw);
      res.json({ ok: true, parcours });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.post("/api/admin/referrals", async (req, res) => {
    try {
      const { createReferral, syncReferralFromDossier } = await import("./apporteurStore");
      const body = (req.body || {}) as any;
      const referral = await createReferral({
        apporteurId: String(body.apporteurId || ""),
        contact: body.contact || {},
        source: "admin",
        dossierId: body.dossierId,
        actor: String((req as any).adminEmail || "admin"),
      });
      if (body.dossierId) {
        const db = await readDBAsync();
        const dossier = db.dossiers.find((d: any) => d.id === String(body.dossierId));
        if (dossier) {
          const apporteur = await (await import("./apporteurStore")).findApporteurById(referral.apporteurId);
          dossier.apporteur = {
            apporteurId: referral.apporteurId,
            referralId: referral.id,
            apporteurLabel: apporteur?.companyName,
            referralToken: apporteur?.referralToken,
          };
          await syncReferralFromDossier(dossier);
          await writeDB(db, dossier);
        }
      }
      res.json({ success: true, referral });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.patch("/api/admin/referrals/:id", async (req, res) => {
    try {
      const { updateReferral } = await import("./apporteurStore");
      const body = (req.body || {}) as any;
      const referral = await updateReferral(req.params.id, {
        status: body.status,
        contact: body.contact,
        dossierId: body.dossierId,
        actor: String((req as any).adminEmail || "admin"),
        note: body.note,
      });
      res.json({ success: true, referral });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.post("/api/admin/referrals/:id/link-dossier", async (req, res) => {
    try {
      const { linkReferralToDossier, findApporteurById, syncReferralFromDossier } = await import(
        "./apporteurStore"
      );
      const dossierId = String((req.body as any)?.dossierId || "").trim().toUpperCase();
      if (!dossierId) return res.status(400).json({ error: "dossierId requis" });
      const referral = await linkReferralToDossier(
        req.params.id,
        dossierId,
        String((req as any).adminEmail || "admin"),
      );
      const db = await readDBAsync();
      const dossier = db.dossiers.find((d: any) => d.id === dossierId);
      if (dossier) {
        const apporteur = await findApporteurById(referral.apporteurId);
        dossier.apporteur = {
          apporteurId: referral.apporteurId,
          referralId: referral.id,
          apporteurLabel: apporteur?.companyName,
          referralToken: apporteur?.referralToken,
        };
        await syncReferralFromDossier(dossier);
        await writeDB(db, dossier);
      }
      res.json({ success: true, referral });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.patch("/api/admin/partner-recruits/:id", async (req, res) => {
    try {
      const { updatePartnerRecruit } = await import("./apporteurStore");
      const body = (req.body || {}) as any;
      const recruit = await updatePartnerRecruit(req.params.id, {
        status: body.status,
        note: body.note,
        actor: String((req as any).adminEmail || "admin"),
      });
      res.json({ success: true, recruit });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.get("/api/public/entreprise-lookup", async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      if (!q) return res.status(400).json({ ok: false, error: "SIREN ou SIRET requis." });
      const { lookupFrenchCompany } = await import("./sireneLookup");
      const match = await lookupFrenchCompany(q);
      res.json({ ok: true, match });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.get("/api/public/apporteur-ref/:token", async (req, res) => {
    try {
      const { findApporteurByToken } = await import("./apporteurStore");
      const { buildApporteurPublicRefPayload } = await import("../shared/apporteurPublicProfile");
      const apporteur = await findApporteurByToken(req.params.token);
      if (!apporteur || !apporteur.active) {
        return res.status(404).json({ ok: false, error: "ref_invalid" });
      }
      const publicPayload = buildApporteurPublicRefPayload(apporteur);
      res.json({
        ok: true,
        companyName: apporteur.companyName,
        contactName: apporteur.contactName,
        contactPrenom: apporteur.contactPrenom || null,
        contactNom: apporteur.contactNom || null,
        publicProfile: publicPayload?.profile || null,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  const apporteurPortalPostLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20 });
  const refClickLimiter = rateLimit({ windowMs: 60 * 1000, max: 40 });
  const conseillerLoginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8 });

  app.post(
    "/api/public/conseiller-portal/login/request",
    conseillerLoginLimiter,
    express.json(),
    async (req, res) => {
      try {
        const email = String((req.body || {}).email || "").trim();
        const { requestConseillerPortalLogin } = await import("./conseillerPortalLogin");
        const { resolvePublicAppBaseUrl } = await import("./clientPortal");
        const result = await requestConseillerPortalLogin({
          email,
          publicBaseUrl: resolvePublicAppBaseUrl(
            String(req.headers.origin || req.headers.referer || "").replace(/\/$/, ""),
          ),
        });
        if (!result.ok) {
          if (result.error === "cooldown") {
            return res.status(429).json({
              ok: false,
              error: "cooldown",
              cooldownSeconds: result.cooldownSeconds,
            });
          }
          return res.status(500).json({ ok: false, error: result.error });
        }
        res.json({ ok: true, maskedEmail: result.maskedEmail });
      } catch (err: any) {
        res.status(500).json({ ok: false, error: err?.message || String(err) });
      }
    },
  );

  app.get("/api/public/conseiller-portal/login/verify", async (req, res) => {
    try {
      const token = String(req.query.token || "").trim();
      const { verifyConseillerPortalLogin } = await import("./conseillerPortalLogin");
      const result = await verifyConseillerPortalLogin(token, res);
      if (!result.ok) {
        return res.status(400).json({ ok: false, error: result.error });
      }
      res.json({ ok: true, sessionToken: result.sessionToken });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.get("/api/conseiller-portal/me", async (req, res) => {
    try {
      const { resolveConseillerPortalSession, touchConseillerPortalSession } = await import(
        "./conseillerPortalSession"
      );
      const apporteur = await resolveConseillerPortalSession(req);
      if (!apporteur?.portalToken) {
        return res.status(401).json({ ok: false, error: "session_required" });
      }
      void touchConseillerPortalSession(apporteur.id);
      res.json({ ok: true, portalToken: apporteur.portalToken });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.get("/api/conseiller-portal/ranking", async (req, res) => {
    try {
      const { resolveConseillerPortalSession, touchConseillerPortalSession } = await import(
        "./conseillerPortalSession"
      );
      const me = await resolveConseillerPortalSession(req);
      if (!me) {
        return res.status(401).json({ ok: false, error: "session_required" });
      }
      void touchConseillerPortalSession(me.id);

      const { loadApporteurStore } = await import("./apporteurStore");
      const { isConseillerImmoClubType } = await import("../shared/conseillerImmoClub");
      const store = await loadApporteurStore();
      const conseillers = (store.apporteurs || [])
        .filter((a) => a.active && isConseillerImmoClubType(a.type))
        .map((a) => ({ id: a.id, contactName: a.contactName, companyName: a.companyName }));

      const counts = new Map<string, number>();
      for (const r of store.referrals || []) {
        counts.set(r.apporteurId, (counts.get(r.apporteurId) || 0) + 1);
      }

      const rows = conseillers
        .map((c) => ({
          apporteurId: c.id,
          contactName: c.contactName,
          companyName: c.companyName,
          recommandations: counts.get(c.id) || 0,
        }))
        .sort((a, b) => b.recommandations - a.recommandations || a.contactName.localeCompare(b.contactName, "fr"));

      const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 }));
      const meRow = ranked.find((r) => r.apporteurId === me.id) || null;
      res.json({ ok: true, me: meRow, leaderboard: ranked.slice(0, 30) });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.post("/api/conseiller-portal/logout", async (req, res) => {
    try {
      const { destroyConseillerPortalSession } = await import("./conseillerPortalSession");
      await destroyConseillerPortalSession(req, res);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.use("/api/apporteur-portal/:token", async (req, res, next) => {
    try {
      const { findApporteurByPortalToken } = await import("./apporteurStore");
      const { gateApporteurPortalForConseiller } = await import("./conseillerPortalSession");
      const apporteur = await findApporteurByPortalToken(req.params.token);
      const gated = await gateApporteurPortalForConseiller(req, res, apporteur);
      if (!gated) return;
      next();
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.post("/api/ref-click", refClickLimiter, express.json(), async (req, res) => {
    try {
      const ref = String((req.body || {}).ref || "").trim();
      const sessionId = String((req.body || {}).sessionId || "").trim();
      const { resolveReferralClickGeo } = await import("./referralClickGeo");
      const bodyGeo = (req.body || {}).geo;
      const geo = resolveReferralClickGeo(req, bodyGeo);
      const { recordReferralLinkClick } = await import("./apporteurStore");
      const result = await recordReferralLinkClick(ref, sessionId, geo);
      res.json({ ok: result.ok });
    } catch {
      res.json({ ok: false });
    }
  });

  app.get("/api/apporteur-portal/:token/formations", async (req, res) => {
    try {
      const { findApporteurByPortalToken } = await import("./apporteurStore");
      const { isConseillerImmoClubType } = await import("../shared/conseillerImmoClub");
      const { loadConseillerFormationParcours } = await import("./conseillerFormationsConfig");
      const apporteur = await findApporteurByPortalToken(req.params.token);
      if (!apporteur) return res.status(404).json({ ok: false, error: "portal_invalid" });
      if (!isConseillerImmoClubType(apporteur.type)) {
        return res.status(403).json({ ok: false, error: "not_conseiller" });
      }
      if ((apporteur.contractStatus || "none") !== "signed") {
        return res.status(403).json({ ok: false, error: "contract_required" });
      }
      const parcoursRaw = await loadConseillerFormationParcours();
      const parcours = {
        ...parcoursRaw,
        available: parcoursRaw.embedUrl.startsWith("http"),
      };
      res.json({ ok: true, parcours });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.get("/api/apporteur-portal/:token", async (req, res) => {
    try {
      const { findApporteurByPortalToken, listReferrals, buildApporteurReferralUrl, getRemunerationForApporteur, loadApporteurStore, listDirectDownlineApporteurs, getTeamReferralsForApporteur, listPartnerRecruits, enrichDownlineForPortal } = await import(
        "./apporteurStore"
      );
      const { computeApporteurPayoutEur, computeSponsorOverridePayoutEur } = await import("../shared/apporteurRemuneration");
      const { computePortalEarningsFromReferrals } = await import("../shared/apporteurCommissionFromDossier");
      const { readDB } = await import("./db");
      const { computeApporteurTeamKpis } = await import("../shared/apporteurKpis");
      const { resolvePublicAppBaseUrl } = await import("./clientPortal");
      const {
        isConseillerImmoClubType,
        countSignedClientReferrals,
        resolveConseillerOperatingPhase,
        CONSEILLER_AUTONOMY_SIGNED_THRESHOLD,
      } = await import("../shared/conseillerImmoClub");
      const apporteur = await findApporteurByPortalToken(req.params.token);
      if (!apporteur) return res.status(404).json({ ok: false, error: "portal_invalid" });
      const isConseillerClub = isConseillerImmoClubType(apporteur.type);
      const { pruneReferralsWithMissingDossiers } = await import("./apporteurStore");
      await pruneReferralsWithMissingDossiers();
      const store = await loadApporteurStore();
      const referrals = await listReferrals({ apporteurId: apporteur.id });
      const signedCount = countSignedClientReferrals(referrals);
      const operatingPhase = isConseillerClub
        ? resolveConseillerOperatingPhase(signedCount)
        : null;
      const downline = isConseillerClub ? [] : listDirectDownlineApporteurs(store, apporteur.id);
      const teamReferrals = isConseillerClub ? [] : getTeamReferralsForApporteur(store, apporteur.id);
      const partnerRecruits = isConseillerClub
        ? []
        : (await listPartnerRecruits({ sponsorApporteurId: apporteur.id })).filter(
            (r) => r.status !== "REFUSE" && r.status !== "CONTRAT_SIGNE",
          );
      const sponsor = apporteur.sponsorId
        ? store.apporteurs.find((a) => a.id === apporteur.sponsorId) || null
        : null;
      const publicBaseUrl = resolvePublicAppBaseUrl(
        String(req.headers.origin || req.headers.referer || "").replace(/\/$/, ""),
      );
      const referralLink = buildApporteurReferralUrl(publicBaseUrl, apporteur.referralToken);
      const kpis = computeApporteurTeamKpis(referrals, teamReferrals, downline.length);
      const remuneration = getRemunerationForApporteur(apporteur);
      const conversionForEarn =
        kpis.conversionRate ?? remuneration.defaultConversionRate;
      const mainDb = await readDB();
      const dossierById = new Map(mainDb.dossiers.map((d: any) => [d.id, d]));
      const defaultPayoutDirect = computeApporteurPayoutEur({
        annualSavingsEur: remuneration.defaultAnnualSavingsEur,
        assuredCount: remuneration.defaultAssuredPerDossier,
        config: remuneration,
      });
      const defaultPayoutOverride = computeSponsorOverridePayoutEur({
        annualSavingsEur: remuneration.defaultAnnualSavingsEur,
        assuredCount: remuneration.defaultAssuredPerDossier,
        config: remuneration,
      });
      const earnings = computePortalEarningsFromReferrals({
        personalReferrals: referrals,
        teamReferrals,
        dossierById,
        config: remuneration,
        conversionRate: conversionForEarn,
        defaultPayoutDirect,
        defaultPayoutOverride,
      });
      const contractStatus = apporteur.contractStatus || "none";
      const contractSigned = contractStatus === "signed";
      const { enrichReferralsForApporteurPortal } = await import("./apporteurPortalEnrich");
      const enrichedReferrals = isConseillerClub
        ? await (async () => {
            const { readDB, writeDB } = await import("./db");
            const db = await readDB();
            const dossierById = new Map(db.dossiers.map((d: any) => [d.id, d]));
            const { enrichReferralForConseillerPortal } = await import("./conseillerPortalEnrich");
            const { syncReferralFromDossier, inferReferralStatusFromDossier } = await import(
              "./apporteurStore"
            );
            const payoutSharePercent = remuneration.apporteurShareOfBrokerage;
            const out: any[] = [];
            for (const r of referrals) {
              const base = {
                id: r.id,
                status: r.status,
                contact: r.contact,
                createdAt: r.createdAt,
                updatedAt: r.updatedAt,
                events: (r.events || []).slice(-5),
                tracking: null as any,
              };
              const dossier = r.dossierId ? dossierById.get(r.dossierId) : undefined;
              if (!dossier) {
                out.push(base);
                continue;
              }
              await syncReferralFromDossier(dossier, "portal_refresh");
              const liveStatus = inferReferralStatusFromDossier(dossier);
              if (liveStatus) base.status = liveStatus;
              base.tracking = enrichReferralForConseillerPortal({
                referral: r,
                dossier,
                publicBaseUrl,
                remuneration,
                operatingPhase: operatingPhase!,
                payoutSharePercent,
              });
              try {
                await writeDB(db, dossier);
              } catch {
                /* token persist best-effort */
              }
              out.push(base);
            }
            return out;
          })()
        : await enrichReferralsForApporteurPortal(referrals, publicBaseUrl, remuneration);

      const conseillerRanking = isConseillerClub
        ? (() => {
            const conseillers = (store.apporteurs || [])
              .filter((a) => a.active && isConseillerImmoClubType(a.type))
              .map((a) => ({ id: a.id, contactName: a.contactName, companyName: a.companyName }));
            const counts = new Map<string, number>();
            for (const r of store.referrals || []) {
              counts.set(r.apporteurId, (counts.get(r.apporteurId) || 0) + 1);
            }
            const rows = conseillers
              .map((c) => ({
                apporteurId: c.id,
                contactName: c.contactName,
                companyName: c.companyName,
                recommandations: counts.get(c.id) || 0,
              }))
              .sort(
                (a, b) =>
                  b.recommandations - a.recommandations ||
                  a.contactName.localeCompare(b.contactName, "fr"),
              )
              .map((r, i) => ({ ...r, rank: i + 1 }));
            return {
              me: rows.find((r) => r.apporteurId === apporteur.id) || null,
              leaderboard: rows.slice(0, 30),
            };
          })()
        : null;
      res.json({
        ok: true,
        apporteur: {
          companyName: apporteur.companyName,
          contactName: apporteur.contactName,
          type: apporteur.type,
          sponsorName: sponsor?.contactName || null,
        },
        downline: enrichDownlineForPortal(store, downline),
        teamSummary: {
          filleuls: downline.length,
          clientReferrals: kpis.teamReferrals,
          openReferrals: kpis.teamOpen,
          signedReferrals: kpis.teamSigned,
        },
        partnerRecruits: partnerRecruits.map((r) => ({
          id: r.id,
          contactName: r.contactName,
          email: r.email,
          status: r.status,
          createdAt: r.createdAt,
          createdApporteurId: r.createdApporteurId,
        })),
        referrals: enrichedReferrals,
        referralLink,
        referralStats: {
          linkClicks: apporteur.referralStats?.linkClicks || 0,
          uniqueSessions: apporteur.referralStats?.uniqueSessions || 0,
          lastClickAt: apporteur.referralStats?.lastClickAt || null,
        },
        stats: { total: kpis.total, open: kpis.open, signed: kpis.signed },
        kpis,
        remuneration,
        earnings: {
          ...earnings,
          payoutPerDirect: earnings.payoutPerDirect,
          payoutPerOverride: earnings.payoutPerOverride,
        },
        payoutPerSignature: defaultPayoutDirect,
        portalUnlocked: contractSigned,
        contract: {
          status: contractStatus,
          signed: contractSigned,
          signedAt: apporteur.contractSignedAt || null,
          needsSignature: !contractSigned,
        },
        conseillerClub: isConseillerClub
          ? {
              operatingPhase,
              signedCount,
              autonomyThreshold: CONSEILLER_AUTONOMY_SIGNED_THRESHOLD,
              payoutSharePercent: remuneration.apporteurShareOfBrokerage,
            }
          : null,
        conseillerRanking,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.get("/api/apporteur-portal/:token/contract", async (req, res) => {
    try {
      const { findApporteurByPortalToken, loadApporteurStore } = await import("./apporteurStore");
      const {
        getApporteurContractPayload,
        getApporteurProfilePayload,
        isApporteurContractSigned,
        isApporteurProfileComplete,
      } = await import("./apporteurContractSign");
      const apporteur = await findApporteurByPortalToken(req.params.token);
      if (!apporteur) return res.status(404).json({ ok: false, error: "portal_invalid" });
      const store = await loadApporteurStore();
      const sponsor = apporteur.sponsorId
        ? store.apporteurs.find((a) => a.id === apporteur.sponsorId) || null
        : null;
      res.json({
        ok: true,
        signed: isApporteurContractSigned(apporteur),
        signedAt: apporteur.contractSignedAt || null,
        signature: apporteur.contractSignature || null,
        profile: getApporteurProfilePayload(apporteur),
        profileComplete: isApporteurProfileComplete(apporteur),
        document: getApporteurContractPayload(apporteur, sponsor?.contactName || null),
        signerHint: apporteur.contactName,
        pdfAvailable: isApporteurContractSigned(apporteur),
        driveLink: apporteur.contractSignature?.driveLink || null,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.patch(
    "/api/apporteur-portal/:token/profile",
    apporteurPortalPostLimiter,
    express.json(),
    async (req, res) => {
      try {
        const { updateApporteurProfileFromPortal } = await import("./apporteurStore");
        const apporteur = await updateApporteurProfileFromPortal(req.params.token, (req.body || {}) as any);
        const { getApporteurProfilePayload, isApporteurProfileComplete } = await import(
          "./apporteurContractSign"
        );
        res.json({
          ok: true,
          profile: getApporteurProfilePayload(apporteur),
          profileComplete: isApporteurProfileComplete(apporteur),
        });
      } catch (err: any) {
        res.status(400).json({ ok: false, error: err?.message || String(err) });
      }
    },
  );

  app.post(
    "/api/apporteur-portal/:token/contract/otp",
    apporteurPortalPostLimiter,
    async (req, res) => {
      try {
        const { findApporteurByPortalToken } = await import("./apporteurStore");
        const { isApporteurContractSigned } = await import("./apporteurContractSign");
        const { issueApporteurContractOtp } = await import("./apporteurContractOtp");
        const { sendApporteurContractOtpEmail } = await import("./apporteurNotify");
        const apporteur = await findApporteurByPortalToken(req.params.token);
        if (!apporteur) return res.status(404).json({ ok: false, error: "portal_invalid" });
        if (isApporteurContractSigned(apporteur)) {
          return res.json({ ok: true, alreadySigned: true });
        }
        if (!apporteur.email?.includes("@")) {
          return res.status(400).json({ ok: false, error: "Email partenaire manquant." });
        }
        const issued = await issueApporteurContractOtp(apporteur.id);
        if (!issued.code) {
          return res.status(429).json({
            ok: false,
            error: `Réessayez dans ${issued.cooldownSeconds || 60} secondes.`,
            cooldownSeconds: issued.cooldownSeconds,
          });
        }
        const sent = await sendApporteurContractOtpEmail(apporteur.email, issued.code);
        if (!sent) {
          return res.status(500).json({ ok: false, error: "Envoi du code impossible." });
        }
        const [local, domain] = apporteur.email.split("@");
        const maskedEmail = `${local.slice(0, 2)}***@${domain}`;
        res.json({ ok: true, maskedEmail });
      } catch (err: any) {
        res.status(500).json({ ok: false, error: err?.message || String(err) });
      }
    },
  );

  app.post(
    "/api/apporteur-portal/:token/contract/sign",
    apporteurPortalPostLimiter,
    express.json(),
    async (req, res) => {
      try {
        const { findApporteurByPortalToken, loadApporteurStore } = await import("./apporteurStore");
        const { signApporteurContractOnline, isApporteurContractSigned } = await import(
          "./apporteurContractSign"
        );
        const { resolvePublicAppBaseUrl } = await import("./clientPortal");
        const apporteur = await findApporteurByPortalToken(req.params.token);
        if (!apporteur) return res.status(404).json({ ok: false, error: "portal_invalid" });
        if (isApporteurContractSigned(apporteur)) {
          return res.json({
            ok: true,
            alreadySigned: true,
            contractSignedAt: apporteur.contractSignedAt || null,
            driveLink: apporteur.contractSignature?.driveLink || null,
          });
        }
        const store = await loadApporteurStore();
        const sponsor = apporteur.sponsorId
          ? store.apporteurs.find((a) => a.id === apporteur.sponsorId) || null
          : null;
        const publicBaseUrl = resolvePublicAppBaseUrl(
          String(req.headers.origin || req.headers.referer || "").replace(/\/$/, ""),
        );
        const body = (req.body || {}) as { signerName?: string; acceptTerms?: boolean; emailOtp?: string };
        const updated = await signApporteurContractOnline({
          apporteur,
          signerName: String(body.signerName || "").trim(),
          acceptTerms: Boolean(body.acceptTerms),
          emailOtp: String(body.emailOtp || "").trim(),
          ipAddress: String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim() || undefined,
          userAgent: String(req.headers["user-agent"] || "").slice(0, 500) || undefined,
          portalBaseUrl: publicBaseUrl,
          sponsorName: sponsor?.contactName || null,
        });
        res.json({
          ok: true,
          contractSignedAt: updated.contractSignedAt || null,
          signature: updated.contractSignature || null,
          driveLink: updated.contractSignature?.driveLink || null,
          pdfUrl: `/api/apporteur-portal/${encodeURIComponent(req.params.token)}/contract/pdf`,
        });
      } catch (err: any) {
        res.status(400).json({ ok: false, error: err?.message || String(err) });
      }
    },
  );

  app.get("/api/apporteur-portal/:token/contract/pdf", async (req, res) => {
    try {
      const { findApporteurByPortalToken, loadApporteurStore } = await import("./apporteurStore");
      const { buildSignedApporteurContractPdf, isApporteurContractSigned } = await import(
        "./apporteurContractSign"
      );
      const apporteur = await findApporteurByPortalToken(req.params.token);
      if (!apporteur) return res.status(404).json({ ok: false, error: "portal_invalid" });
      if (!isApporteurContractSigned(apporteur)) {
        return res.status(403).json({ ok: false, error: "contract_not_signed" });
      }
      const store = await loadApporteurStore();
      const sponsor = apporteur.sponsorId
        ? store.apporteurs.find((a) => a.id === apporteur.sponsorId) || null
        : null;
      const pdf = await buildSignedApporteurContractPdf(apporteur, sponsor?.contactName || null);
      if (!pdf) return res.status(404).json({ ok: false, error: "pdf_unavailable" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${pdf.filename}"`);
      res.send(pdf.buffer);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.post(
    "/api/apporteur-portal/:token/referrals",
    apporteurPortalPostLimiter,
    express.json(),
    async (req, res) => {
      try {
        const { findApporteurByPortalToken, createReferral } = await import("./apporteurStore");
        const apporteur = await findApporteurByPortalToken(req.params.token);
        if (!apporteur) return res.status(404).json({ ok: false, error: "portal_invalid" });
        if ((apporteur.contractStatus || "none") !== "signed") {
          return res.status(403).json({
            ok: false,
            error: "contract_required",
            message: "Le contrat partenaire doit être signé avant d'enregistrer une recommandation.",
          });
        }
        const body = (req.body || {}) as any;
        const contact = body.contact || {};
        const email = String(contact.email || "").trim().toLowerCase();
        const phone = String(contact.phone || "").trim();
        const prenom = String(contact.prenom || "").trim();
        const nom = String(contact.nom || "").trim();
        if (!email && !phone) {
          return res.status(400).json({ ok: false, error: "Email ou téléphone requis" });
        }
        if (!prenom && !nom) {
          return res.status(400).json({ ok: false, error: "Nom du contact requis" });
        }
        const referral = await createReferral({
          apporteurId: apporteur.id,
          contact: {
            prenom,
            nom,
            email: email || undefined,
            phone: phone || undefined,
            notes: String(contact.notes || "").trim() || undefined,
          },
          source: "apporteur_portal",
          actor: "apporteur_portal",
        });
        res.json({
          ok: true,
          referral: {
            id: referral.id,
            status: referral.status,
            contact: referral.contact,
            createdAt: referral.createdAt,
          },
        });
      } catch (err: any) {
        res.status(400).json({ ok: false, error: err?.message || String(err) });
      }
    },
  );

  app.post(
    "/api/apporteur-portal/:token/referrals/:referralId/conseiller-subscription",
    apporteurPortalPostLimiter,
    express.json(),
    async (req, res) => {
      try {
        const { findApporteurByPortalToken, findReferralById, listReferrals } = await import("./apporteurStore");
        const {
          isConseillerImmoClubType,
          countSignedClientReferrals,
          resolveConseillerOperatingPhase,
        } = await import("../shared/conseillerImmoClub");
        const { hasStudyBeenSent } = await import("./dossierLifecycle");
        const { clientHasAcceptedInsuranceChange } = await import("./insuranceAcceptance");
        const { addEvent } = await import("./dossierModel");

        const apporteur = await findApporteurByPortalToken(req.params.token);
        if (!apporteur) return res.status(404).json({ ok: false, error: "portal_invalid" });
        if (!isConseillerImmoClubType(apporteur.type)) {
          return res.status(403).json({ ok: false, error: "not_conseiller" });
        }
        if ((apporteur.contractStatus || "none") !== "signed") {
          return res.status(403).json({ ok: false, error: "contract_required" });
        }

        const referral = await findReferralById(req.params.referralId);
        if (!referral || referral.apporteurId !== apporteur.id) {
          return res.status(404).json({ ok: false, error: "referral_not_found" });
        }
        if (!referral.dossierId) {
          return res.status(400).json({ ok: false, error: "no_dossier" });
        }

        const allReferrals = await listReferrals({ apporteurId: apporteur.id });
        const phase = resolveConseillerOperatingPhase(countSignedClientReferrals(allReferrals));
        if (phase !== "autonomous") {
          return res.status(403).json({
            ok: false,
            error: "phase_a",
            message: "Le formulaire souscription est disponible en phase B uniquement.",
          });
        }

        const db = await readDBAsync();
        const dossier = db.dossiers.find((d: any) => d.id === referral.dossierId);
        if (!dossier) return res.status(404).json({ ok: false, error: "dossier_not_found" });

        if (!hasStudyBeenSent(dossier) || !clientHasAcceptedInsuranceChange(dossier)) {
          return res.status(400).json({
            ok: false,
            error: "not_ready",
            message: "Le client doit avoir reçu l'étude et accepté le changement.",
          });
        }

        const body = (req.body || {}) as any;
        const creditOfferRef = String(body.creditOfferRef || "").trim();
        const addressLine = String(body.addressLine || "").trim();
        const postalCode = String(body.postalCode || "").trim();
        const city = String(body.city || "").trim();
        const borrowers = Array.isArray(body.borrowers) ? body.borrowers : [];
        if (!creditOfferRef || !addressLine || !postalCode || !city) {
          return res.status(400).json({ ok: false, error: "Champs adresse et référence crédit requis" });
        }
        const normalizedBorrowers = borrowers
          .map((b: any) => ({
            prenom: String(b?.prenom || "").trim(),
            nom: String(b?.nom || "").trim(),
            rib: String(b?.rib || "").trim() || undefined,
            identityRef: String(b?.identityRef || "").trim() || undefined,
          }))
          .filter((b) => b.prenom || b.nom);
        if (!normalizedBorrowers.length) {
          return res.status(400).json({ ok: false, error: "Au moins un emprunteur requis" });
        }

        const now = new Date().toISOString();
        const existing = (dossier as any).conseillerSubscription;
        if (existing?.submittedAt && existing.status !== "pending") {
          return res.status(409).json({ ok: false, error: "already_submitted" });
        }

        (dossier as any).conseillerSubscription = {
          status: "pending",
          submittedAt: now,
          submittedByApporteurId: apporteur.id,
          creditOfferRef,
          addressLine,
          postalCode,
          city,
          borrowers: normalizedBorrowers,
          updatedAt: now,
        };
        dossier.updatedAt = now;
        addEvent(dossier, {
          type: "NOTE_ADDED",
          actor: { kind: "APPORTEUR", label: apporteur.companyName || "Conseiller" },
          message: "Formulaire souscription conseiller transmis à LCIF.",
          meta: { conseillerSubscription: true, referralId: referral.id },
        });
        await writeDB(db, dossier);
        res.json({ ok: true, subscription: (dossier as any).conseillerSubscription });
      } catch (err: any) {
        res.status(400).json({ ok: false, error: err?.message || String(err) });
      }
    },
  );

  app.post(
    "/api/apporteur-portal/:token/study-validation/:dossierId/approve",
    apporteurPortalPostLimiter,
    express.json(),
    async (req, res) => {
      try {
        const { findApporteurByPortalToken, listReferrals, getRemunerationForApporteur } =
          await import("./apporteurStore");
        const { isConseillerImmoClubType } = await import("../shared/conseillerImmoClub");
        const { approveConseillerStudyCourtage } = await import("./studyConseillerValidation");
        const { hasStudyBeenSent } = await import("./dossierLifecycle");

        const apporteur = await findApporteurByPortalToken(req.params.token);
        if (!apporteur) return res.status(404).json({ ok: false, error: "portal_invalid" });
        if (!isConseillerImmoClubType(apporteur.type)) {
          return res.status(403).json({ ok: false, error: "not_conseiller" });
        }
        if ((apporteur.contractStatus || "none") !== "signed") {
          return res.status(403).json({ ok: false, error: "contract_required" });
        }

        const dossierId = String(req.params.dossierId || "").trim().toUpperCase();
        const referrals = await listReferrals({ apporteurId: apporteur.id });
        const ownsDossier = referrals.some((r) => r.dossierId === dossierId);
        if (!ownsDossier) return res.status(403).json({ ok: false, error: "forbidden" });

        const db = await readDBAsync();
        const dossier = db.dossiers.find((d: any) => d.id === dossierId);
        if (!dossier) return res.status(404).json({ ok: false, error: "dossier_not_found" });

        if (hasStudyBeenSent(dossier)) {
          return res.status(409).json({
            ok: false,
            error: "study_already_sent",
            message: "L'étude a déjà été envoyée au client.",
          });
        }

        const feesPerAssuredEur = Number((req.body as any)?.feesPerAssuredEur);
        const remuneration = getRemunerationForApporteur(apporteur);
        const result = await approveConseillerStudyCourtage({
          dossier,
          apporteur,
          feesPerAssuredEur,
          config: remuneration,
        });
        if (!result.ok) {
          return res.status(400).json({ ok: false, error: result.error });
        }

        await writeDB(db, dossier);

        res.json({
          ok: true,
          feesCourtageTotalEur: result.total,
          conseillerRetroEur: result.validation.conseillerRetroEur,
        });
      } catch (err: any) {
        res.status(400).json({ ok: false, error: err?.message || String(err) });
      }
    },
  );

  app.post(
    "/api/apporteur-portal/:token/partner-recruits",
    apporteurPortalPostLimiter,
    express.json(),
    async (req, res) => {
      try {
        const { findApporteurByPortalToken, createPartnerRecruit } = await import("./apporteurStore");
        const { isConseillerImmoClubType } = await import("../shared/conseillerImmoClub");
        const apporteur = await findApporteurByPortalToken(req.params.token);
        if (!apporteur) return res.status(404).json({ ok: false, error: "portal_invalid" });
        if (isConseillerImmoClubType(apporteur.type)) {
          return res.status(403).json({
            ok: false,
            error: "not_available",
            message: "Le recrutement de partenaires n'est pas disponible pour les conseillers du club.",
          });
        }
        if ((apporteur.contractStatus || "none") !== "signed") {
          return res.status(403).json({
            ok: false,
            error: "contract_required",
            message: "Le contrat partenaire doit être signé avant de recommander un futur partenaire.",
          });
        }
        const body = (req.body || {}) as any;
        const recruit = await createPartnerRecruit({
          sponsorApporteurId: apporteur.id,
          contactPrenom: body.contactPrenom,
          contactNom: body.contactNom,
          contactName: body.contactName,
          email: body.email,
          phone: body.phone,
          companyName: body.companyName,
          siret: body.siret,
          siren: body.siren,
          companyLegalName: body.companyLegalName,
          notes: body.notes,
          actor: "apporteur_portal",
        });
        res.json({
          ok: true,
          recruit: {
            id: recruit.id,
            status: recruit.status,
            contactName: recruit.contactName,
            createdAt: recruit.createdAt,
          },
        });
      } catch (err: any) {
        res.status(400).json({ ok: false, error: err?.message || String(err) });
      }
    },
  );

  app.get("/api/public/partner-ref/:token", async (req, res) => {
    try {
      const { resolvePartnerRef } = await import("./networkStore");
      const resolved = await resolvePartnerRef(req.params.token);
      if (!resolved) return res.status(404).json({ ok: false, error: "ref_invalid" });
      res.json({ ok: true, ...resolved });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.get("/api/admin/reseau", async (req, res) => {
    try {
      const {
        listNetworkMembers,
        listNetworkReferrals,
        getNetworkSummary,
        pruneNetworkReferralsWithMissingDossiers,
      } = await import("./networkStore");
      const { resolvePublicAppBaseUrl } = await import("./clientPortal");
      const memberId = String(req.query.memberId || "").trim() || undefined;
      await pruneNetworkReferralsWithMissingDossiers();
      const [members, referrals, summary] = await Promise.all([
        listNetworkMembers(),
        listNetworkReferrals(memberId ? { memberId } : undefined),
        getNetworkSummary(),
      ]);
      const publicBaseUrl = resolvePublicAppBaseUrl(
        String(req.headers.origin || req.headers.referer || "").replace(/\/$/, ""),
      );
      res.json({ success: true, members, referrals, summary, publicBaseUrl });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.post("/api/admin/reseau", async (req, res) => {
    try {
      const { createNetworkMember } = await import("./networkStore");
      const body = (req.body || {}) as any;
      const member = await createNetworkMember({
        contactName: body.contactName,
        email: body.email,
        phone: body.phone,
        sponsorId: body.sponsorId,
        notes: body.notes,
        referralToken: body.referralToken,
        contractStatus: body.contractStatus,
      });
      res.json({ success: true, member });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.patch("/api/admin/reseau/:id", async (req, res) => {
    try {
      const { updateNetworkMember } = await import("./networkStore");
      const member = await updateNetworkMember(req.params.id, (req.body || {}) as any);
      res.json({ success: true, member });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.post("/api/admin/network-referrals", async (req, res) => {
    try {
      const { createNetworkReferral, syncNetworkReferralFromDossier } = await import("./networkStore");
      const body = (req.body || {}) as any;
      const referral = await createNetworkReferral({
        memberId: String(body.memberId || ""),
        contact: body.contact || {},
        source: "admin",
        dossierId: body.dossierId,
        actor: String((req as any).adminEmail || "admin"),
      });
      if (body.dossierId) {
        const db = await readDBAsync();
        const dossier = db.dossiers.find((d: any) => d.id === String(body.dossierId));
        if (dossier) {
          const member = await (await import("./networkStore")).findNetworkMemberById(referral.memberId);
          dossier.network = {
            memberId: referral.memberId,
            referralId: referral.id,
            memberLabel: member?.contactName,
            referralToken: member?.referralToken,
            sponsorId: member?.sponsorId,
          };
          await syncNetworkReferralFromDossier(dossier);
          await writeDB(db, dossier);
        }
      }
      res.json({ success: true, referral });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message || String(err) });
    }
  });

  app.patch("/api/admin/network-referrals/:id", async (req, res) => {
    try {
      const { updateNetworkReferral } = await import("./networkStore");
      const body = (req.body || {}) as any;
      const referral = await updateNetworkReferral(req.params.id, {
        status: body.status,
        contact: body.contact,
        dossierId: body.dossierId,
        actor: String((req as any).adminEmail || "admin"),
        note: body.note,
      });
      res.json({ success: true, referral });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message || String(err) });
    }
  });

  const networkPortalPostLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20 });
  app.get("/api/network-portal/:token", async (req, res) => {
    try {
      const {
        findNetworkMemberByPortalToken,
        listNetworkReferrals,
        loadNetworkStore,
        listDirectDownline,
        buildNetworkReferralUrl,
        buildNetworkJoinUrl,
        getNetworkKpisForReferrals,
        getRemunerationForNetworkMember,
      } = await import("./networkStore");
      const {
        computeMemberDirectPayoutEur,
        computeSponsorOverridePayoutEur,
        computeNetworkMemberEarnings,
      } = await import("../shared/networkRemuneration");
      const { computeNetworkMemberKpis } = await import("../shared/networkKpis");
      const { resolvePublicAppBaseUrl } = await import("./clientPortal");
      const { pruneNetworkReferralsWithMissingDossiers } = await import("./networkStore");
      const member = await findNetworkMemberByPortalToken(req.params.token);
      if (!member) return res.status(404).json({ ok: false, error: "portal_invalid" });
      await pruneNetworkReferralsWithMissingDossiers();
      const store = await loadNetworkStore();
      const referrals = await listNetworkReferrals({ memberId: member.id });
      const downline = listDirectDownline(store, member.id);
      const downlineIds = new Set(downline.map((m) => m.id));
      const teamReferrals = store.referrals.filter((r) => downlineIds.has(r.memberId));
      const publicBaseUrl = resolvePublicAppBaseUrl(
        String(req.headers.origin || req.headers.referer || "").replace(/\/$/, ""),
      );
      const referralLink = buildNetworkReferralUrl(publicBaseUrl, member.referralToken);
      const joinLink = buildNetworkJoinUrl(publicBaseUrl, member.joinToken);
      const kpis = computeNetworkMemberKpis(referrals, teamReferrals, downline.length);
      const remuneration = getRemunerationForNetworkMember();
      const payoutPerDirect = computeMemberDirectPayoutEur({
        annualSavingsEur: remuneration.defaultAnnualSavingsEur,
        assuredCount: remuneration.defaultAssuredPerDossier,
        config: remuneration,
      });
      const payoutPerOverride = computeSponsorOverridePayoutEur({
        annualSavingsEur: remuneration.defaultAnnualSavingsEur,
        assuredCount: remuneration.defaultAssuredPerDossier,
        config: remuneration,
      });
      const conversionForEarn = kpis.conversionRate ?? remuneration.defaultConversionRate;
      const earnings = computeNetworkMemberEarnings({
        personalSigned: kpis.signed,
        teamSigned: kpis.teamSigned,
        payoutPerDirectEur: payoutPerDirect,
        payoutPerOverrideEur: payoutPerOverride,
        openPersonal: kpis.open,
        openTeam: kpis.teamOpen,
        conversionRate: conversionForEarn,
      });
      const contractSigned = (member.contractStatus || "none") === "signed";
      const { enrichReferralsForNetworkPortal } = await import("./networkPortalEnrich");
      const enrichedReferrals = await enrichReferralsForNetworkPortal(referrals, publicBaseUrl);
      const sponsor = member.sponsorId
        ? store.members.find((m) => m.id === member.sponsorId) || null
        : null;
      res.json({
        ok: true,
        member: {
          contactName: member.contactName,
          email: member.email,
          sponsorName: sponsor?.contactName || null,
        },
        downline: downline.map((m) => ({
          id: m.id,
          contactName: m.contactName,
          createdAt: m.createdAt,
          active: m.active,
        })),
        referrals: enrichedReferrals,
        referralLink,
        joinLink,
        stats: { total: kpis.total, open: kpis.open, signed: kpis.signed },
        kpis,
        remuneration,
        earnings: {
          personalEarnedEur: earnings.personalEarnedEur,
          teamEarnedEur: earnings.teamEarnedEur,
          earnedEur: earnings.totalEarnedEur,
          pipelineEur: earnings.totalPipelineEur,
          totalIndicatifEur: earnings.totalEarnedEur + earnings.totalPipelineEur,
        },
        payoutPerDirect,
        payoutPerOverride,
        portalUnlocked: contractSigned,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.post(
    "/api/network-portal/:token/referrals",
    networkPortalPostLimiter,
    express.json(),
    async (req, res) => {
      try {
        const { findNetworkMemberByPortalToken, createNetworkReferral } = await import("./networkStore");
        const member = await findNetworkMemberByPortalToken(req.params.token);
        if (!member) return res.status(404).json({ ok: false, error: "portal_invalid" });
        if ((member.contractStatus || "none") !== "signed") {
          return res.status(403).json({
            ok: false,
            error: "contract_required",
            message: "Le contrat réseau doit être signé avant d'enregistrer une recommandation.",
          });
        }
        const body = (req.body || {}) as any;
        const contact = body.contact || {};
        const email = String(contact.email || "").trim().toLowerCase();
        const phone = String(contact.phone || "").trim();
        const prenom = String(contact.prenom || "").trim();
        const nom = String(contact.nom || "").trim();
        if (!email && !phone) {
          return res.status(400).json({ ok: false, error: "Email ou téléphone requis" });
        }
        if (!prenom && !nom) {
          return res.status(400).json({ ok: false, error: "Nom du contact requis" });
        }
        const referral = await createNetworkReferral({
          memberId: member.id,
          contact: {
            prenom,
            nom,
            email: email || undefined,
            phone: phone || undefined,
            notes: String(contact.notes || "").trim() || undefined,
          },
          source: "network_portal",
          actor: "network_portal",
        });
        res.json({
          ok: true,
          referral: {
            id: referral.id,
            status: referral.status,
            contact: referral.contact,
            createdAt: referral.createdAt,
          },
        });
      } catch (err: any) {
        res.status(400).json({ ok: false, error: err?.message || String(err) });
      }
    },
  );

  app.get("/api/public/network-join/:token", async (req, res) => {
    try {
      const { findNetworkMemberByJoinToken } = await import("./networkStore");
      const sponsor = await findNetworkMemberByJoinToken(req.params.token);
      if (!sponsor) return res.status(404).json({ ok: false, error: "join_invalid" });
      res.json({ ok: true, sponsorName: sponsor.contactName });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.post("/api/public/network-join/:token", express.json(), async (req, res) => {
    try {
      const { enrollNetworkMemberViaJoin } = await import("./networkStore");
      const body = (req.body || {}) as any;
      const member = await enrollNetworkMemberViaJoin({
        joinToken: req.params.token,
        contactName: body.contactName,
        email: body.email,
        phone: body.phone,
      });
      res.json({ ok: true, memberId: member.id, contactName: member.contactName });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.post("/api/admin/dossiers/:id/save-playbook-from-last-reply", async (req, res) => {
    try {
      const db = await readDBAsync();
      const dossier = db.dossiers.find((d: any) => d.id === req.params.id);
      if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });
      const body = (req.body || {}) as any;
      const { savePlaybookFromDossierLastReply } = await import("./camillePlaybooks");
      const playbook = await savePlaybookFromDossierLastReply({
        dossier,
        situationSummary: body.situationSummary,
        staffGuidance: body.staffGuidance,
        approvedBy: "admin",
      });
      if (!playbook) {
        return res.status(400).json({ error: "Aucune réponse sortante trouvée sur ce dossier." });
      }
      res.json({ success: true, playbook });
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
          conversationTail: getConversationTailForAi(dossier, 15, 800, {
            clientPhaseOnly: Boolean(dossier.leadPromotedAt),
          }),
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

  const rgpdSyncConsentsHandler = async (req: express.Request, res: express.Response) => {
    try {
      const { syncRgpdConsentsToSheet, getRgpdSpreadsheetId } = await import("./rgpdGoogleSheets");
      const db = await readDBAsync();
      const force = String((req.body as any)?.force || req.query.force || "").toLowerCase() === "true";
      const result = await syncRgpdConsentsToSheet(db.dossiers as any[], { force });
      for (const dossierId of result.syncedIds) {
        const dossier = db.dossiers.find((d: any) => d.id === dossierId);
        if (dossier) await writeDB(db, dossier);
      }
      if (!result.ok && !result.synced) {
        return res.status(result.error?.includes("non configuré") ? 400 : 502).json({ success: false, ...result });
      }
      const spreadsheetId = getRgpdSpreadsheetId();
      res.json({
        success: true,
        spreadsheetId,
        url: spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}` : undefined,
        ...result,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  };
  app.get("/api/admin/rgpd/sync-consents", rgpdSyncConsentsHandler);
  app.post("/api/admin/rgpd/sync-consents", express.json(), rgpdSyncConsentsHandler);

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
    const token = getBearerTokenFromRequest(req);
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

  app.post("/api/dossiers/:id/resend-confirmation", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const { id } = req.params;
    try {
      const db = await readDBAsync();
      const dossier = db.dossiers.find((d: any) => d.id === id);
      if (!dossier) return res.status(404).json({ error: "Dossier non trouvé" });

      const adminToken = getBearerTokenFromRequest(req) || null;
      const result = await sendDossierConfirmationEmail(dossier, {
        adminAccessToken: adminToken,
        log: appendLog,
      });
      await writeDB(db, dossier);

      if (!result.ok) {
        return res.status(500).json({
          success: false,
          error: result.error || "Échec d'envoi du mail de confirmation",
          channel: result.channel,
        });
      }

      res.json({ success: true, channel: result.channel });
    } catch (err: any) {
      console.error("Resend confirmation error:", err);
      res.status(500).json({ error: err.message || err });
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
      const syncFiles = Boolean((req.body as any)?.syncFiles);
      const canReuseFolder =
        dossier.workspaceFolderId &&
        dossier.workspaceStatus !== "FAILED" &&
        dossier.workspaceStatus !== "WARNING" &&
        !force &&
        !syncFiles;
      if (canReuseFolder) {
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

      let token = getBearerTokenFromRequest(req);
      if (!token) {
        token = (await resolveAutonomousGoogleAccessToken()) || "";
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

  const resetProspectTestHandler = async (
    req: express.Request,
    res: express.Response,
    input: { dossierId?: string; email?: string },
  ) => {
    await ensureBackgroundServicesStarted();
    const dossierId = String(input.dossierId || "").trim();
    const email = String(input.email || "").trim().toLowerCase();
    if (!dossierId && !email) {
      return res.status(400).json({ error: "dossierId ou email requis" });
    }
    try {
      const db = await readDBAsync();
      const dossier =
        (dossierId ? db.dossiers.find((d: any) => d.id === dossierId) : null) ||
        (email
          ? db.dossiers.find((d: any) =>
              String(d.formData?.assures?.[0]?.email || "")
                .toLowerCase()
                .includes(email),
            )
          : null);
      const clientEmail =
        email || String(dossier?.formData?.assures?.[0]?.email || "").trim().toLowerCase();
      let gmailTrashed = 0;
      if (clientEmail) {
        const { createGmailAuth } = await import("./mailAutomation");
        const { google } = await import("googleapis");
        const { auth: assuranceAuth } = await createGmailAuth(null);
        const gmail = google.gmail({ version: "v1", auth: assuranceAuth as any });
        const { trashGmailMessagesFromSender } = await import("./gmailInboxCleanup");
        const trashResult = await trashGmailMessagesFromSender(gmail, clientEmail);
        gmailTrashed = trashResult.trashed;
      }
      let dossierDeleted = false;
      if (dossier?.id) {
        await deleteDossierFromStore(dossier.id);
        try {
          const { syncReferralsAfterDossierDeleted } = await import("./apporteurStore");
          const { syncNetworkReferralsAfterDossierDeleted } = await import("./networkStore");
          await syncNetworkReferralsAfterDossierDeleted(dossier.id);
          await syncReferralsAfterDossierDeleted(dossier.id);
        } catch (apErr: any) {
          appendLog(`[Reset prospect] Sync partenaires ${dossier.id}: ${apErr?.message || apErr}`);
        }
        try {
          fs.rmSync(path.join(UPLOADS_DIR, dossier.id), { recursive: true, force: true });
        } catch {
          /* ignore */
        }
        dossierDeleted = true;
      }
      appendLog(
        `[Reset prospect] ${dossier?.id || dossierId || email} — dossier supprimé=${dossierDeleted}, gmail corbeille=${gmailTrashed}`,
      );
      res.json({
        success: true,
        dossierId: dossier?.id || dossierId || null,
        clientEmail,
        dossierDeleted,
        gmailTrashed,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || String(err) });
    }
  };

  app.post("/api/admin/prospects/reset-test", async (req, res) => {
    await resetProspectTestHandler(req, res, {
      dossierId: (req.body as any)?.dossierId,
      email: (req.body as any)?.email,
    });
  });

  app.get("/api/admin/prospects/reset-test", async (req, res) => {
    await resetProspectTestHandler(req, res, {
      dossierId: typeof req.query.dossierId === "string" ? req.query.dossierId : undefined,
      email: typeof req.query.email === "string" ? req.query.email : undefined,
    });
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

    const sendResult = await sendEmailReplyWithGmailAPI(accessToken, toEmail, subject, mailContent, { dossier });
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
    const visible = db.dossiers.filter((d: any) => isVisibleAdminDossier(d.id));
    res.json({ items: buildRemiWorkQueue(visible) });
  });

  app.get("/api/admin/activity-metrics", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const db = await readDBAsync();
    const rawDays = Number(req.query.days || 7);
    const periodDays = rawDays >= 3650 ? 3650 : Math.min(365, Math.max(1, rawDays));
    const { computeActivityMetrics, filterMetricsDossiers } = await import("./activityMetrics");
    const { loadApporteurStore } = await import("./apporteurStore");
    const { resolveRemunerationTier } = await import("../shared/apporteurRemuneration");
    const { getKereisMiaSettingsFromStore } = await import("./kereisMiaConfig");
    const apporteurStore = await loadApporteurStore();
    const kereisSettings = getKereisMiaSettingsFromStore(apporteurStore);
    const apporteurById = new Map(apporteurStore.apporteurs.map((a) => [a.id, a]));
    const scoped = filterMetricsDossiers(db.dossiers);
    let kpiBackfilled = 0;
    const dirtyKpiIds: string[] = [];
    const { refreshStudyKpiFromCommunications, getLoanCapitalFromDossier, isGrossSavingsPlausible } =
      await import("./studyEmailKpi");
    const { hasStudyBeenSent } = await import("./dossierLifecycle");
    for (const d of scoped) {
      const kpi = d.studyKpi;
      const loan = getLoanCapitalFromDossier(d);
      const gross = Number(kpi?.grossSavingsEur) || 0;
      const studySent = hasStudyBeenSent(d);
      const suspectKpi =
        kpi?.source !== "manual" &&
        studySent &&
        (!kpi?.extractedAt ||
          kpi?.confidence === "low" ||
          (gross > 0 && loan > 0 && !isGrossSavingsPlausible(gross, loan)) ||
          (gross <= 0 && kpi?.grossSource !== "draft" && kpi?.grossSource !== "manual"));
      if (suspectKpi) {
        const preservedManualPlan =
          d.insuranceChangePlan?.source === "manual" ? { ...d.insuranceChangePlan } : null;
        if (refreshStudyKpiFromCommunications(d)) {
          kpiBackfilled += 1;
          dirtyKpiIds.push(d.id);
        }
        if (preservedManualPlan) d.insuranceChangePlan = preservedManualPlan;
      }
    }
    if (dirtyKpiIds.length > 0) {
      const { writeDirtyDossiers } = await import("./db");
      await writeDirtyDossiers(db, dirtyKpiIds);
    }
    res.json({
      ...computeActivityMetrics(db.dossiers, periodDays, {
        resolveApporteurTier: (apporteurId) =>
          resolveRemunerationTier(apporteurById.get(apporteurId)?.type),
        kereisSettings,
      }),
      kpiBackfilled,
    });
  });

  app.get("/api/admin/club-revenue-forecast", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const db = await readDBAsync();
    const rawPast = Number(req.query.monthsPast ?? 6);
    const rawFuture = Number(req.query.monthsFuture ?? 6);
    const monthsPast = Number.isFinite(rawPast) ? Math.min(24, Math.max(0, Math.round(rawPast))) : 6;
    const monthsFuture = Number.isFinite(rawFuture) ? Math.min(24, Math.max(1, Math.round(rawFuture))) : 6;
    const { loadApporteurStore } = await import("./apporteurStore");
    const { getKereisMiaSettingsFromStore } = await import("./kereisMiaConfig");
    const { buildClubRevenueForecast } = await import("./clubRevenueForecast");
    const { resolveRemunerationTier } = await import("../shared/apporteurRemuneration");
    const store = await loadApporteurStore();
    const apporteurById = new Map(store.apporteurs.map((a) => [a.id, a]));
    const { backfillClubEconomicsForDossiers } = await import("./clubRevenueAutoSync");
    const dirtyIds = backfillClubEconomicsForDossiers(db.dossiers);
    if (dirtyIds.length > 0) {
      const { writeDirtyDossiers } = await import("./db");
      await writeDirtyDossiers(db, dirtyIds);
    }
    const forecast = buildClubRevenueForecast({
      dossiers: db.dossiers,
      referrals: store.referrals,
      kereisSettings: getKereisMiaSettingsFromStore(store),
      monthsPast,
      monthsFuture,
      resolveApporteurTier: (apporteurId) =>
        resolveRemunerationTier(apporteurById.get(apporteurId)?.type),
    });
    res.json({ ok: true, forecast });
  });

  app.get("/api/admin/gemini-usage", async (req, res) => {
    await ensureBackgroundServicesStarted();
    try {
      const rawDays = Number(req.query.days || 14);
      const days = Number.isFinite(rawDays) ? Math.min(90, Math.max(1, Math.round(rawDays))) : 14;
      const { buildGeminiUsageSummary } = await import("./geminiUsage");
      res.json(buildGeminiUsageSummary(getRuntimeDataDir(), days));
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
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

  app.post("/api/admin/dossiers/:id/camille-confirm-draft", async (req, res) => {
    await ensureBackgroundServicesStarted();
    try {
      const { id } = req.params;
      const action = String((req.body as any)?.action || "send").toLowerCase();
      const db = await readDBAsync();
      const dossier = db.dossiers.find((d: any) => d.id === id);
      if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });

      const {
        getPendingReview,
        confirmAndSendReviewReply,
        cancelPendingReview,
      } = await import("./camilleReviewQueue");
      const review = getPendingReview(dossier);
      if (!review || review.status !== "awaiting_confirm") {
        return res.status(400).json({
          error: "no_pending_draft",
          message: "Aucun brouillon Camille en attente de validation sur ce dossier.",
        });
      }

      if (action === "cancel") {
        await cancelPendingReview(dossier, "Brouillon annulé depuis l'admin.");
        dossier.updatedAt = new Date().toISOString();
        await writeDB(db, dossier);
        return res.json({ success: true, action: "cancelled" });
      }

      const result = await confirmAndSendReviewReply(dossier, "admin");
      dossier.updatedAt = new Date().toISOString();
      await writeDB(db, dossier);
      if (!result.ok) {
        return res.status(500).json({ success: false, error: result.summary });
      }
      return res.json({ success: true, action: "sent", summary: result.summary });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || String(err) });
    }
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
    const token = getBearerTokenFromRequest(req);
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
    const preservedManualKpi =
      dossier.studyKpi?.source === "manual" ? { ...dossier.studyKpi } : null;
    const preservedManualPlan =
      dossier.insuranceChangePlan?.source === "manual"
        ? { ...dossier.insuranceChangePlan }
        : null;
    if (!preservedManualKpi) delete dossier.studyKpi;
    const { refreshStudyKpiFromCommunications } = await import("./studyEmailKpi");
    const ok = refreshStudyKpiFromCommunications(dossier);
    if (preservedManualKpi) dossier.studyKpi = preservedManualKpi;
    if (preservedManualPlan) dossier.insuranceChangePlan = preservedManualPlan;
    const { materializeStudyEconomics } = await import("./materializeStudyEconomics");
    materializeStudyEconomics(dossier);
    await writeDB(db, dossier);
    res.json({
      ok,
      studyKpi: dossier.studyKpi || null,
      clubRevenueKpi: dossier.clubRevenueKpi || null,
      insuranceChangePlan: dossier.insuranceChangePlan || null,
    });
  });

  app.post("/api/admin/dossiers/:id/sync-club-revenue", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === req.params.id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });
    const { enrichDossierClubEconomics } = await import("./clubRevenueAutoSync");
    const changed = enrichDossierClubEconomics(dossier);
    if (changed) await writeDB(db, dossier);
    res.json({
      ok: true,
      changed,
      studyKpi: dossier.studyKpi || null,
      clubRevenueKpi: dossier.clubRevenueKpi || null,
    });
  });

  app.patch("/api/admin/dossiers/:id/insurance-change-plan", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === req.params.id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });
    const body = (req.body || {}) as { plannedDate?: string | null };
    if (!("plannedDate" in body)) {
      return res.status(400).json({ error: "plannedDate requis (AAAA-MM-JJ, ou null pour effacer)." });
    }
    try {
      const { patchInsuranceChangePlan } = await import("./insuranceChangePlan");
      const plan = patchInsuranceChangePlan(
        dossier,
        body.plannedDate,
        String((req as any).adminEmail || "admin"),
      );
      const { applyStudyHtmlOverridesToDossier } = await import("../shared/studyEmailForSend");
      applyStudyHtmlOverridesToDossier(dossier);
      await writeDB(db, dossier);
      res.json({ ok: true, insuranceChangePlan: plan });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || String(err) });
    }
  });

  app.patch("/api/admin/dossiers/:id/study-kpi", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === req.params.id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });
    const body = (req.body || {}) as {
      grossSavingsEur?: number;
      feesCourtageEur?: number;
      loanCapitalEur?: number;
    };
    if (
      body.grossSavingsEur == null &&
      body.feesCourtageEur == null &&
      body.loanCapitalEur == null
    ) {
      return res.status(400).json({
        error: "Au moins un champ requis : grossSavingsEur, feesCourtageEur ou loanCapitalEur.",
      });
    }
    const { patchStudyKpi } = await import("./studyEmailKpi");
    const studyKpi = patchStudyKpi(dossier, {
      grossSavingsEur:
        body.grossSavingsEur != null ? Number(body.grossSavingsEur) : undefined,
      feesCourtageEur:
        body.feesCourtageEur != null ? Number(body.feesCourtageEur) : undefined,
      loanCapitalEur:
        body.loanCapitalEur != null ? Number(body.loanCapitalEur) : undefined,
    });
    const { applyStudyHtmlOverridesToDossier } = await import("../shared/studyEmailForSend");
    applyStudyHtmlOverridesToDossier(dossier);
    const { materializeStudyEconomics } = await import("./materializeStudyEconomics");
    materializeStudyEconomics(dossier);
    await writeDB(db, dossier);
    res.json({ ok: true, studyKpi });
  });

  app.get("/api/admin/dossiers/:id/club-revenue", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === req.params.id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });
    const { loadApporteurStore } = await import("./apporteurStore");
    const { computeClubRevenueBreakdown } = await import("../shared/kereisMiaRemuneration");
    const { resolveRemunerationTier } = await import("../shared/apporteurRemuneration");
    const { getKereisMiaSettingsFromStore } = await import("./kereisMiaConfig");
    const store = await loadApporteurStore();
    const kereisSettings = getKereisMiaSettingsFromStore(store);
    const apporteurId = dossier.apporteur?.apporteurId;
    const apporteur = apporteurId ? store.apporteurs.find((a) => a.id === apporteurId) : undefined;
    const breakdown = computeClubRevenueBreakdown(dossier, {
      apporteurTier: apporteur ? resolveRemunerationTier(apporteur.type) : undefined,
      kereisSettings,
    });
    res.json({
      clubRevenueKpi: dossier.clubRevenueKpi ?? null,
      breakdown,
      kereisSettings,
      apporteurLabel: apporteur
        ? `${apporteur.contactPrenom || ""} ${apporteur.contactNom || apporteur.companyName || ""}`.trim()
        : null,
    });
  });

  app.patch("/api/admin/dossiers/:id/club-revenue-kpi", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === req.params.id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });
    const body = (req.body || {}) as {
      productLine?: string;
      insurer?: string;
      annualPremiumEur?: number;
      linearCommissionPercent?: number | null;
      kereisCommissionOverrideEur?: number | null;
      feesCourtageOverrideEur?: number | null;
      paymentStatus?: string;
      signedAt?: string | null;
      notes?: string;
      source?: string;
    };
    const hasField =
      body.productLine != null ||
      body.insurer != null ||
      body.annualPremiumEur != null ||
      body.linearCommissionPercent != null ||
      body.linearCommissionPercent === null ||
      body.kereisCommissionOverrideEur !== undefined ||
      body.feesCourtageOverrideEur !== undefined ||
      body.paymentStatus != null ||
      body.signedAt !== undefined ||
      body.notes != null ||
      body.source != null;
    if (!hasField) {
      return res.status(400).json({
        error:
          "Au moins un champ requis : annualPremiumEur, linearCommissionPercent, insurer, paymentStatus, etc.",
      });
    }
    const { patchClubRevenueKpi } = await import("./clubRevenueKpi");
    const { computeClubRevenueBreakdown } = await import("../shared/kereisMiaRemuneration");
    const { loadApporteurStore } = await import("./apporteurStore");
    const { resolveRemunerationTier } = await import("../shared/apporteurRemuneration");
    const { getKereisMiaSettingsFromStore } = await import("./kereisMiaConfig");
    const clubRevenueKpi = patchClubRevenueKpi(dossier, {
      productLine: body.productLine as any,
      insurer: body.insurer,
      annualPremiumEur:
        body.annualPremiumEur != null ? Number(body.annualPremiumEur) : undefined,
      linearCommissionPercent:
        body.linearCommissionPercent != null ? Number(body.linearCommissionPercent) : undefined,
      kereisCommissionOverrideEur: body.kereisCommissionOverrideEur,
      feesCourtageOverrideEur: body.feesCourtageOverrideEur,
      paymentStatus: body.paymentStatus as any,
      signedAt: body.signedAt,
      notes: body.notes,
      source: body.source as any,
    });
    await writeDB(db, dossier);
    const store = await loadApporteurStore();
    const kereisSettings = getKereisMiaSettingsFromStore(store);
    const apporteurId = dossier.apporteur?.apporteurId;
    const apporteur = apporteurId ? store.apporteurs.find((a) => a.id === apporteurId) : undefined;
    const breakdown = computeClubRevenueBreakdown(dossier, {
      apporteurTier: apporteur ? resolveRemunerationTier(apporteur.type) : undefined,
      kereisSettings,
    });
    res.json({ ok: true, clubRevenueKpi, breakdown, kereisSettings });
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
    dossier.statusManualAt = new Date().toISOString();

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

  app.patch("/api/admin/dossiers/:id/conseiller-subscription", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === req.params.id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });

    const { findApporteurById } = await import("./apporteurStore");
    const { isConseillerImmoClubType } = await import("../shared/conseillerImmoClub");
    const { isConseillerSubscriptionStatus, CONSEILLER_SUBSCRIPTION_STATUS_LABELS } = await import(
      "../shared/conseillerSubscription"
    );
    const { addEvent } = await import("./dossierModel");

    const apporteurId = String((dossier as any).apporteur?.apporteurId || "").trim();
    if (apporteurId) {
      const apporteur = await findApporteurById(apporteurId);
      if (!apporteur || !isConseillerImmoClubType(apporteur.type)) {
        return res.status(400).json({ error: "Dossier non rattaché à un conseiller LCIF" });
      }
    } else if (!(dossier as any).conseillerSubscription) {
      return res.status(400).json({ error: "Pas de souscription conseiller sur ce dossier" });
    }

    const status = (req.body as any)?.status;
    if (!isConseillerSubscriptionStatus(status)) {
      return res.status(400).json({ error: "Statut invalide" });
    }

    const note = typeof (req.body as any)?.adminNote === "string" ? (req.body as any).adminNote.trim() : "";
    const now = new Date().toISOString();
    const prev = (dossier as any).conseillerSubscription || { status: "pending", updatedAt: now };
    (dossier as any).conseillerSubscription = {
      ...prev,
      status,
      adminNote: note || prev.adminNote,
      updatedAt: now,
      updatedBy: String((req.body as any)?.updatedBy || "admin"),
    };
    dossier.updatedAt = now;
    addEvent(dossier, {
      type: "STATUS_CHANGE",
      actor: { kind: "ADMIN", label: "Admin" },
      message: `Souscription conseiller : ${CONSEILLER_SUBSCRIPTION_STATUS_LABELS[status]}${note ? ` — ${note.slice(0, 120)}` : ""}`,
      meta: { conseillerSubscriptionStatus: status },
    });
    await writeDB(db, dossier);
    res.json({ ok: true, subscription: (dossier as any).conseillerSubscription });
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

  app.delete("/api/admin/dossiers/:id/documents/:docId", async (req, res) => {
    await ensureBackgroundServicesStarted();
    try {
      const { id, docId } = req.params;
      const db = await readDBAsync();
      const dossier = db.dossiers.find((d: any) => d.id === id);
      if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });

      if (!Array.isArray(dossier.formData?.documents)) dossier.formData.documents = [];
      const docs = dossier.formData.documents;
      const docIndex = docs.findIndex(
        (d: any) => String(d.id) === docId || String(d.name) === docId,
      );
      if (docIndex < 0) return res.status(404).json({ error: "Document introuvable" });

      const doc = docs[docIndex];
      const removedCategory = String(doc.category || "").toLowerCase();
      docs.splice(docIndex, 1);

      const localPath = String(doc.localPath || "").trim();
      if (localPath && fs.existsSync(localPath)) {
        try {
          fs.unlinkSync(localPath);
        } catch {
          // best-effort
        }
      }

      const { setAdminChecklistOverride } = await import("./adminChecklistValidation");
      if (removedCategory === "rib" || removedCategory === "cni") {
        setAdminChecklistOverride(dossier, removedCategory, null, { author: "admin" });
      }

      const { reanalyzeDossierLoanDocuments } = await import("./reanalyzeLoanDocuments");
      await reanalyzeDossierLoanDocuments(dossier, UPLOADS_DIR);

      dossier.updatedAt = new Date().toISOString();
      addEvent(dossier, {
        type: "NOTE_ADDED",
        actor: { kind: "ADMIN", label: "Rémi" },
        message: `Document supprimé du dossier : « ${doc.name} »`,
      });
      await writeDB(db, dossier);

      const { computeDocumentChecklistForDossier } = await import("../shared/documentChecklist");
      res.json({
        success: true,
        removed: { id: doc.id, name: doc.name, category: doc.category },
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
      const dirtyIds = summary.results.filter((r) => r.analyzedCount > 0).map((r) => r.dossierId);
      if (dirtyIds.length > 0) {
        const { writeDirtyDossiers } = await import("./db");
        await writeDirtyDossiers(db, dirtyIds);
      }
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
        if (ran && summary) {
          const dirtyIds = summary.results.filter((r) => r.analyzedCount > 0).map((r) => r.dossierId);
          if (dirtyIds.length > 0) {
            const { writeDirtyDossiers } = await import("./db");
            await writeDirtyDossiers(db, dirtyIds);
          }
        }
      } catch (err: any) {
        console.error("[OCR hybride] Backfill au démarrage:", err?.message || err);
      }
    })();
  };
  scheduleOcrHybridBackfill();

  return app;
}

