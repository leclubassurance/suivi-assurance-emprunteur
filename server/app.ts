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
  deleteDossierFromFirebase,
} from "./firebaseSync";
import { readDB, writeDB } from "./db";
import { addEvent, ensureDossierShape, newId, scheduleTask } from "./dossierModel";
import { runSchedulerOnce, startScheduler } from "./scheduler";
import { sendEmail } from "./emailProvider";
import { auditAiDecision, proposeNextActions } from "./nextActionEngine";
import { DRIVE_CONFIG_VERSION, resolveDriveParentFolderId } from "./driveConfig";
import { hasServiceAccountConfigured, getServiceAccountClientEmail } from "./serviceAccount";

function getRuntimeDataDir() {
  // Vercel serverless has a writable /tmp only.
  return process.env.VERCEL ? "/tmp/data" : path.join(process.cwd(), "data");
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
      const dossierId = (req.params as any).dossierId || "unknown";
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

  // --- API ROUTES ---

  app.get("/api/health", async (_req, res) => {
    await ensureBackgroundServicesStarted();
    const resolved = resolveDriveParentFolderId();
    res.json({
      status: "ok",
      build: "railway-express-2026-05-27",
      driveConfigVersion: DRIVE_CONFIG_VERSION,
      effectiveDriveParentId: resolved.parentId,
      rawDriveParentEnv: resolved.rawEnv,
      driveParentAutoCorrected: resolved.autoCorrected,
      hasServiceAccount: hasServiceAccountConfigured(),
      serviceAccountEmail: getServiceAccountClientEmail(),
    });
  });

  app.post("/api/dossiers", createDossierLimiter, upload.array("documents"), async (req, res) => {
    await ensureBackgroundServicesStarted();
    try {
      const formData = JSON.parse((req.body as any).formData);
      const db = await readDBAsync();

      const documents = ((req.files as Express.Multer.File[]) || []).map((f) => ({
        id: "doc_" + Date.now() + Math.random().toString(36).substr(2, 9),
        name: f.originalname,
        size: f.size,
        type: f.mimetype,
        localPath: f.path,
      }));

      const newDossier = ensureDossierShape({
        id:
          formData.id ||
          `LCIF-${Math.floor(Math.random() * 1000000)
            .toString()
            .padStart(6, "0")}`,
        status: "NOUVEAU",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        formData: { ...formData, documents },
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
      writeDB(db, newDossier);
      appendLog(`Succès d'écriture du dossier ${newDossier.id} dans la base de données.`);

      const toEmail = formData.assures?.[0]?.email;
      const clientName = formData.assures?.[0]?.prenom || "Cher client";
      if (toEmail) {
        const confirmationSubject = `Confirmation de réception - Dossier N° ${newDossier.id}`;
        const confirmationHtml = `
<div style="font-family: Arial, sans-serif; color: #1E3A8A; max-width: 600px; margin: 0 auto; border: 1px solid #EFF6FF; padding: 20px; border-radius: 8px;">
  <img src="https://res.cloudinary.com/dji8akleo/image/upload/v1772999309/5_yn8wfm.png" alt="Le Club Immobilier Français" style="max-width: 150px; margin-bottom: 20px;" />
  <h2 style="color: #1E3A8A; font-size: 18px; margin-top: 0;">Bonjour ${clientName},</h2>
  <p style="font-size: 14px; color: #334155; line-height: 1.5; margin-bottom: 15px;">
    Nous avons bien reçu votre dossier d'assurance emprunteur sous le numéro <strong>${newDossier.id}</strong>.
  </p>
  <p style="font-size: 14px; color: #334155; line-height: 1.5; margin-bottom: 20px;">
    Notre équipe vous revient sous 48h ouvrées.
  </p>
  <div style="margin-top: 25px; padding-top: 15px; border-top: 1px solid #EFF6FF;">
    <p style="font-size: 14px; color: #1E3A8A; font-weight: bold; margin: 0;">Charles Victor</p>
    <p style="font-size: 12px; color: #64748B; margin: 2px 0 0 0;">Le Club Immobilier Français</p>
  </div>
</div>
        `;
        if (latestAccessToken) {
          sendEmailReplyWithGmailAPI(
            latestAccessToken,
            toEmail,
            confirmationSubject,
            confirmationHtml,
          )
            .then((success) => {
              if (success) {
                appendLog(
                  `[Email] Mail de confirmation automatique envoyé de Charles Victor à ${toEmail} pour le dossier ${newDossier.id}`,
                );
                addEvent(newDossier, {
                  type: "EMAIL_SENT",
                  actor: { kind: "SYSTEM" },
                  meta: { template: "CONFIRMATION", to: toEmail, subject: confirmationSubject },
                });
                writeDB(db, newDossier);
              } else {
                appendLog(`[Email Warning] Échec d'envoi automatique du mail de confirmation à ${toEmail}`);
                addEvent(newDossier, {
                  type: "EMAIL_FAILED",
                  actor: { kind: "SYSTEM" },
                  meta: {
                    template: "CONFIRMATION",
                    to: toEmail,
                    subject: confirmationSubject,
                  },
                });
                writeDB(db, newDossier);
              }
            })
            .catch((err: any) => {
              appendLog(`[Email Error] Erreur d'envoi automatique du mail : ${err.message}`);
              addEvent(newDossier, {
                type: "EMAIL_FAILED",
                actor: { kind: "SYSTEM" },
                meta: {
                  template: "CONFIRMATION",
                  to: toEmail,
                  subject: confirmationSubject,
                  error: err.message,
                },
              });
              writeDB(db, newDossier);
            });
        } else {
          appendLog(
            `[Email Simulation] Envoi simulé de l'email de confirmation à ${toEmail} pour le dossier ${newDossier.id}.`,
          );
          addEvent(newDossier, {
            type: "EMAIL_SENT",
            actor: { kind: "SYSTEM" },
            meta: { template: "CONFIRMATION_SIMULATED", to: toEmail, subject: confirmationSubject },
          });
          writeDB(db, newDossier);
        }
      }

      // Export auto : compte de service si configuré (formulaire client sans admin connecté)
      const { hasServiceAccountConfigured } = await import("./serviceAccount");
      const driveTokenForAutoExport = hasServiceAccountConfigured() ? null : latestAccessToken;

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
              writeDB(currentDb, existing);
              appendLog(
                `Dossier ${newDossier.id} mis à jour au statut EN_COURS après export Google Workspace. (Statut: ${result.status})`,
              );
            } else {
              existing.workspaceStatus = "FAILED";
              existing.workspaceError = result.error;
              existing.updatedAt = new Date().toISOString();
              writeDB(currentDb, existing);
              appendLog(`Échec de l'export Google Workspace pour le dossier ${newDossier.id}: ${result.error}`);
            }
          }
        })
        .catch((err) => {
          appendLog(
            `Erreur de tâche en arrière plan Google Workspace pour ${newDossier.id}: ${err.message || err}`,
          );
        });

      res.json({ success: true, dossierId: newDossier.id });
    } catch (error: any) {
      appendLog(`Erreur de création de dossier : ${error.stack || error.message || error}`);
      console.error("Erreur de création de dossier :", error);
      res.status(500).json({ error: "Erreur serveur lors de la création du dossier." });
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
      writeDB(db, dossier);
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
    writeDB(db, dossier);
    res.json({ success: true, note, dossier });
  });

  app.post("/api/admin/dossiers/:id/send-email", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const { id } = req.params;
    const { to, subject, html } = (req.body || {}) as any;
    if (!subject || !html) return res.status(400).json({ error: "Missing subject or html" });

    const db = await readDBAsync();
    const dossier = db.dossiers.find((d: any) => d.id === id);
    if (!dossier) return res.status(404).json({ error: "Dossier introuvable" });

    const toEmail = to || dossier.formData?.assures?.[0]?.email;
    if (!toEmail) return res.status(400).json({ error: "Missing recipient email" });

    const authHeader = req.headers.authorization;
    const googleToken =
      authHeader && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : latestAccessToken;

    let providerId: string | null = null;
    let channel: "gmail" | "smtp" | "simulated" = "simulated";

    if (googleToken) {
      const { sendEmailReplyWithGmailAPI } = await import("./mailAutomation");
      const gmailResult = await sendEmailReplyWithGmailAPI(googleToken, toEmail, subject, html);
      if (gmailResult.ok) {
        providerId = gmailResult.messageId || null;
        channel = "gmail";
      } else {
        addEvent(dossier, {
          type: "EMAIL_FAILED",
          actor: { kind: "ADMIN", label: "Admin" },
          meta: { to: toEmail, subject, error: gmailResult.error, channel: "gmail" },
        });
        writeDB(db, dossier);
        return res.status(500).json({
          error: `Échec Gmail : ${gmailResult.error}. Reconnectez-vous à Google (Déconnexion puis connexion).`,
        });
      }
    } else {
      const result = await sendEmail({ to: toEmail, subject, html });
      if ("error" in result) {
        const error = (result as any).error;
        addEvent(dossier, {
          type: "EMAIL_FAILED",
          actor: { kind: "ADMIN", label: "Admin" },
          meta: { to: toEmail, subject, error },
        });
        writeDB(db, dossier);
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

    if (!dossier.communications) dossier.communications = [];
    dossier.communications.push({
      id: `msg_out_${Date.now()}`,
      direction: "outbound",
      to: toEmail,
      subject,
      text: html,
      date: new Date().toISOString(),
    });

    addEvent(dossier, {
      type: "EMAIL_SENT",
      actor: { kind: "ADMIN", label: "Admin" },
      meta: { to: toEmail, subject, providerId, channel },
      message: `Email envoyé au client (${channel}).`,
    });
    writeDB(db, dossier);
    return res.json({
      success: true,
      providerId,
      channel,
      simulated: false,
    });
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
    writeDB(db, dossier);
    res.json({ success: true, actions });
  });

  app.delete("/api/dossiers/:id", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const { id } = req.params;
    const db = await readDBAsync();

    const dossier = db.dossiers.find((d: any) => d.id === id);
    if (dossier) {
      try {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ") && dossier.workspaceFolderId) {
          const accessToken = authHeader.split(" ")[1];
          await deleteDossierFromGoogleWorkspace(dossier.workspaceFolderId, accessToken);
        }
      } catch (gErr: any) {
        appendLog(`Warning: Failed to delete Google Workspace folder for dossier ${id}: ${gErr.message || gErr}`);
      }
    }

    db.dossiers = db.dossiers.filter((d: any) => d.id !== id);
    writeDB(db);
    try {
      fs.rmSync(path.join(UPLOADS_DIR, id), { recursive: true, force: true });
    } catch (err) {
      console.error("Failed to remove uploads dir", err);
    }
    deleteDossierFromFirebase(id).catch(console.error);
    res.json({ success: true });
  });

  app.get("/api/admin/google-status", (_req, res) => {
    res.json({ email: "oauth-client", folderId: "oauth-drive", configured: true });
  });

  /** Teste le compte de service (export auto formulaire client, sans admin connecté). */
  app.get("/api/admin/drive-auto-check", async (_req, res) => {
    const { hasServiceAccountConfigured, getServiceAccountClientEmail } = await import(
      "./serviceAccount",
    );
    if (!hasServiceAccountConfigured()) {
      return res.status(400).json({
        ok: false,
        error:
          "Compte de service absent. Ajoutez GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 sur Railway (voir docs/CONFIGURATION_DRIVE_AUTO.md).",
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
        serviceAccountEmail: getServiceAccountClientEmail(),
        shareHint:
          "Partagez le dossier « Dossiers Clients Assurance » avec cet email (rôle Éditeur) dans Google Drive.",
        ...diag,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

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

      dossier.workspaceStatus = "PENDING";
      dossier.workspaceError = undefined;
      dossier.workspaceWarning = undefined;
      writeDB(db, dossier);

      const authHeader = req.headers.authorization;
      const token =
        authHeader && authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : latestAccessToken;

      const result = await exportDossierToGoogleWorkspace(dossier, token);

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
        } else {
          updated.workspaceStatus = "FAILED";
          updated.workspaceError = result.error;
        }
        updated.updatedAt = new Date().toISOString();
        writeDB(currentDb);
      }

      res.json(result);
    } catch (err: any) {
      console.error("Manual retry workspace error:", err);
      res.status(500).json({ error: err.message || err });
    }
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
      writeDB(result.db);
      res.json({
        success: true,
        inbound: result.inboundCount,
        processed: result.processed,
        aiReplies: result.aiReplies,
      });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
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
      writeDB(db, dossier);

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

    const success = await sendEmailReplyWithGmailAPI(accessToken, toEmail, subject, mailContent);
    if (success) {
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
      writeDB(db, dossier);
      res.json({ success: true, message: "Email envoyé avec Gmail !" });
    } else {
      res.status(500).json({ error: "Echec de l'envoi de l'email via Gmail API" });
    }
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

  app.get("/api/files", async (req, res) => {
    await ensureBackgroundServicesStarted();
    const filePath = req.query.path as string;
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).send("File not found");
    }
    res.download(filePath);
  });

  return app;
}

