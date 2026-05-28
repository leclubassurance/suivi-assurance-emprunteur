import fs from "fs";
import path from "path";
import { buildStaticCamilleKnowledgeBlock } from "../shared/lcifKnowledge";
import { extractPdfTextFromBuffer } from "./pdfTextExtract";
import { resolveDriveParentFolderId } from "./driveConfig";
import { createDriveClient } from "./googleAutomation";
import { downloadDriveFileToBuffer, uploadBufferToDriveFolder } from "./gmailDriveUpload";

export const CAMILLE_KNOWLEDGE_FOLDER_NAME = "Documentation Camille";

const README_FILENAME = "LISEZ-MOI — déposer vos PDF ici.txt";
const README_BODY = `Documentation Camille — Le Club Immobilier Français

Déposez ici vos fiches produits, guides et argumentaires (PDF de préférence).
Vous pouvez créer des sous-dossiers (ex. « Fiches produits »).

Le serveur relit ce dossier automatiquement (sync toutes les 6 h + au redémarrage).
Variable Railway : CAMILLE_KNOWLEDGE_DRIVE_FOLDER_ID = l'ID de CE dossier
(copier depuis l'URL Google Drive : .../folders/XXXXXXXX)

Ne pas mélanger avec les dossiers clients LCIF-XXXXXX.
`;

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const MAX_FILES = 30;
const MAX_FILE_BYTES = 8_000_000;
const MAX_EXCERPT_PER_FILE = 12_000;
const MAX_DRIVE_PROMPT_CHARS = 14_000;

export type CamilleKnowledgeCache = {
  syncedAt: string;
  folderId: string;
  fileCount: number;
  files: Array<{ name: string; chars: number }>;
  driveExcerpt: string;
  error?: string;
};

let memoryCache: CamilleKnowledgeCache | null = null;
let syncInProgress = false;

function normalizeEnvId(value: string | undefined | null): string | null {
  if (!value) return null;
  let v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  return v || null;
}

export function resolveCamilleKnowledgeFolderIdFromEnv(): string | null {
  return normalizeEnvId(process.env.CAMILLE_KNOWLEDGE_DRIVE_FOLDER_ID);
}

function getCachePath(dataDir: string) {
  return path.join(dataDir, "camille-knowledge-cache.json");
}

function loadCacheFromDisk(dataDir: string): CamilleKnowledgeCache | null {
  try {
    const p = getCachePath(dataDir);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8")) as CamilleKnowledgeCache;
  } catch {
    return null;
  }
}

function saveCacheToDisk(dataDir: string, cache: CamilleKnowledgeCache) {
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(getCachePath(dataDir), JSON.stringify(cache, null, 2), "utf-8");
  } catch (e: any) {
    console.warn("[Camille knowledge] Cache disque non écrit:", e?.message || e);
  }
}

function isDriveAuthError(err: unknown): boolean {
  const e = err as { message?: string; code?: number; response?: { status?: number } };
  const msg = String(e?.message || err || "").toLowerCase();
  const status = e?.response?.status ?? e?.code;
  return (
    status === 401 ||
    status === 403 ||
    msg.includes("invalid authentication") ||
    msg.includes("invalid credentials") ||
    msg.includes("login cookie")
  );
}

/**
 * Documentation Camille = opération serveur 24/7 → compte de service en priorité.
 * Un token OAuth admin expiré ne doit pas bloquer setup/sync.
 */
async function getDriveClient(_accessToken?: string | null) {
  const serviceClient = await createDriveClient(null);
  if (serviceClient?.authMode === "service_account") {
    return serviceClient;
  }

  const token = _accessToken;
  if (token && !token.startsWith("mock-gdrive")) {
    try {
      const oauthClient = await createDriveClient(token);
      if (oauthClient) {
        await oauthClient.drive.about.get({ fields: "user(emailAddress)" });
        return oauthClient;
      }
    } catch (err) {
      if (!isDriveAuthError(err)) throw err;
      console.warn("[Camille knowledge] Token OAuth admin invalide — repli compte de service.");
    }
  }

  return serviceClient || null;
}

async function findFolderByName(
  drive: any,
  parentId: string,
  name: string,
): Promise<{ id: string; webViewLink?: string } | null> {
  const safe = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q = [
    `'${parentId}' in parents`,
    `name='${safe}'`,
    "mimeType='application/vnd.google-apps.folder'",
    "trashed=false",
  ].join(" and ");
  const list = await drive.files.list({
    q,
    fields: "files(id,name,webViewLink)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 3,
  });
  const f = list.data.files?.[0];
  return f?.id ? { id: f.id, webViewLink: f.webViewLink || undefined } : null;
}

async function createFolder(drive: any, name: string, parentId: string) {
  return drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id,webViewLink",
    supportsAllDrives: true,
  });
}

export type EnsureKnowledgeFolderResult = {
  ok: boolean;
  folderId?: string;
  webViewLink?: string;
  created?: boolean;
  parentFolderId?: string;
  parentFolderName?: string;
  envLine?: string;
  error?: string;
  readmeUploaded?: boolean;
};

/** Crée ou retrouve « Documentation Camille » sous le dossier clients assurance. */
export async function ensureCamilleKnowledgeFolder(
  accessToken?: string | null,
): Promise<EnsureKnowledgeFolderResult> {
  const envId = resolveCamilleKnowledgeFolderIdFromEnv();
  if (envId) {
    const client = await getDriveClient(accessToken);
    if (!client) {
      return { ok: false, error: "Drive non configuré (compte de service ou OAuth)." };
    }
    try {
      const meta = await client.drive.files.get({
        fileId: envId,
        fields: "id,name,webViewLink",
        supportsAllDrives: true,
      });
      return {
        ok: true,
        folderId: meta.data.id!,
        webViewLink: meta.data.webViewLink || `https://drive.google.com/drive/folders/${envId}`,
        created: false,
        envLine: `CAMILLE_KNOWLEDGE_DRIVE_FOLDER_ID="${envId}"`,
      };
    } catch (e: any) {
      const hint =
        client.authMode === "service_account"
          ? " Vérifiez que le dossier est partagé avec l'email du compte de service (Éditeur)."
          : " Reconnectez Google dans l'admin ou configurez GOOGLE_SERVICE_ACCOUNT_JSON sur Railway.";
      return { ok: false, error: `ID dossier invalide ou inaccessible : ${e?.message || e}.${hint}` };
    }
  }

  const client = await getDriveClient(accessToken);
  if (!client) {
    return { ok: false, error: "Drive non configuré (compte de service ou OAuth)." };
  }

  const { parentId } = resolveDriveParentFolderId();
  let parentName = "Dossiers Clients Assurance";
  try {
    const pMeta = await client.drive.files.get({
      fileId: parentId,
      fields: "name",
      supportsAllDrives: true,
    });
    parentName = pMeta.data.name || parentName;
  } catch {
    /* ignore */
  }

  let existing = await findFolderByName(client.drive, parentId, CAMILLE_KNOWLEDGE_FOLDER_NAME);
  let created = false;
  if (!existing) {
    const res = await createFolder(client.drive, CAMILLE_KNOWLEDGE_FOLDER_NAME, parentId);
    existing = { id: res.data.id!, webViewLink: res.data.webViewLink || undefined };
    created = true;
  }

  const folderId = existing.id;
  const up = await uploadBufferToDriveFolder(
    folderId,
    README_FILENAME,
    "text/plain",
    Buffer.from(README_BODY, "utf-8"),
    accessToken,
  );

  return {
    ok: true,
    folderId,
    webViewLink: existing.webViewLink || `https://drive.google.com/drive/folders/${folderId}`,
    created,
    parentFolderId: parentId,
    parentFolderName: parentName,
    envLine: `CAMILLE_KNOWLEDGE_DRIVE_FOLDER_ID="${folderId}"`,
    readmeUploaded: Boolean(up?.fileId),
  };
}

type DriveFileRow = { id: string; name: string; mimeType?: string };

async function listFilesRecursive(
  drive: any,
  folderId: string,
  depth: number,
  acc: DriveFileRow[],
): Promise<void> {
  if (acc.length >= MAX_FILES || depth > 3) return;

  let pageToken: string | undefined;
  do {
    const list = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "nextPageToken, files(id,name,mimeType,size)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageSize: 50,
      pageToken,
    });
    for (const f of list.data.files || []) {
      if (!f.id || !f.name) continue;
      const mime = f.mimeType || "";
      if (mime === "application/vnd.google-apps.folder") {
        await listFilesRecursive(drive, f.id, depth + 1, acc);
      } else if (
        mime.includes("pdf") ||
        mime === "text/plain" ||
        mime === "text/markdown" ||
        mime === GOOGLE_DOC_MIME ||
        mime === GOOGLE_SHEET_MIME
      ) {
        const size = Number((f as any).size || 0);
        if (size > MAX_FILE_BYTES) continue;
        acc.push({ id: f.id, name: f.name, mimeType: mime });
      }
      if (acc.length >= MAX_FILES) break;
    }
    pageToken = list.data.nextPageToken || undefined;
  } while (pageToken && acc.length < MAX_FILES);
}

async function extractTextFromBuffer(
  name: string,
  mimeType: string | undefined,
  buf: Buffer,
): Promise<string> {
  const lower = name.toLowerCase();
  if (mimeType?.includes("pdf") || lower.endsWith(".pdf")) {
    return extractPdfTextFromBuffer(buf);
  }
  if (lower.endsWith(".txt") || lower.endsWith(".md") || mimeType?.startsWith("text/")) {
    return buf.toString("utf-8").trim();
  }
  return "";
}

async function exportGoogleFile(drive: any, fileId: string, mimeType: string): Promise<string> {
  const exportMime =
    mimeType === GOOGLE_SHEET_MIME ? "text/csv" : "text/plain";
  const res = await drive.files.export(
    { fileId, mimeType: exportMime },
    { responseType: "text" },
  );
  return String(res.data || "").trim();
}

export async function syncCamilleKnowledgeFromDrive(
  accessToken?: string | null,
  dataDir?: string,
): Promise<CamilleKnowledgeCache> {
  if (syncInProgress && memoryCache) return memoryCache;
  syncInProgress = true;

  try {
    let folderId = resolveCamilleKnowledgeFolderIdFromEnv();
    if (!folderId) {
      const ensured = await ensureCamilleKnowledgeFolder(accessToken);
      folderId = ensured.folderId;
      if (!folderId) {
        const err = ensured.error || "Dossier Documentation Camille introuvable";
        const fail: CamilleKnowledgeCache = {
          syncedAt: new Date().toISOString(),
          folderId: "",
          fileCount: 0,
          files: [],
          driveExcerpt: "",
          error: err,
        };
        memoryCache = fail;
        return fail;
      }
    }

    const client = await getDriveClient(accessToken);
    if (!client) {
      const fail: CamilleKnowledgeCache = {
        syncedAt: new Date().toISOString(),
        folderId,
        fileCount: 0,
        files: [],
        driveExcerpt: "",
        error: "Drive non configuré",
      };
      memoryCache = fail;
      return fail;
    }

    const rows: DriveFileRow[] = [];
    await listFilesRecursive(client.drive, folderId, 0, rows);

    const parts: string[] = [];
    const fileMeta: Array<{ name: string; chars: number }> = [];

    for (const row of rows) {
      if (row.name === README_FILENAME) continue;
      let text = "";
      try {
        if (row.mimeType === GOOGLE_DOC_MIME || row.mimeType === GOOGLE_SHEET_MIME) {
          text = await exportGoogleFile(client.drive, row.id, row.mimeType!);
        } else {
          const buf = await downloadDriveFileToBuffer(row.id, null);
          if (buf?.length) {
            text = await extractTextFromBuffer(row.name, row.mimeType, buf);
          }
        }
      } catch (e: any) {
        console.warn(`[Camille knowledge] Lecture ${row.name}:`, e?.message || e);
      }
      if (!text) continue;
      const excerpt = text.slice(0, MAX_EXCERPT_PER_FILE);
      parts.push(`--- ${row.name} ---\n${excerpt}`);
      fileMeta.push({ name: row.name, chars: excerpt.length });
    }

    let driveExcerpt = parts.join("\n\n");
    if (driveExcerpt.length > MAX_DRIVE_PROMPT_CHARS) {
      driveExcerpt = driveExcerpt.slice(0, MAX_DRIVE_PROMPT_CHARS) + "\n\n[… tronqué …]";
    }

    const cache: CamilleKnowledgeCache = {
      syncedAt: new Date().toISOString(),
      folderId,
      fileCount: fileMeta.length,
      files: fileMeta,
      driveExcerpt,
    };
    memoryCache = cache;
    if (dataDir) saveCacheToDisk(dataDir, cache);
    console.log(
      `[Camille knowledge] Sync OK : ${fileMeta.length} fichier(s), ${driveExcerpt.length} caractères.`,
    );
    return cache;
  } finally {
    syncInProgress = false;
  }
}

export function getCamilleKnowledgeCache(dataDir?: string): CamilleKnowledgeCache | null {
  if (memoryCache) return memoryCache;
  if (dataDir) {
    const disk = loadCacheFromDisk(dataDir);
    if (disk) memoryCache = disk;
    return disk;
  }
  return null;
}

/** Texte complet pour le prompt Gemini (statique + Drive). */
export async function buildCamilleKnowledgePromptBlock(
  accessToken?: string | null,
  dataDir?: string,
): Promise<string> {
  const staticBlock = buildStaticCamilleKnowledgeBlock();
  let cache = getCamilleKnowledgeCache(dataDir);
  if (!cache?.driveExcerpt && !cache?.error) {
    try {
      cache = await syncCamilleKnowledgeFromDrive(accessToken, dataDir);
    } catch (e: any) {
      console.warn("[Camille knowledge] Sync à la volée:", e?.message || e);
    }
  }

  const drivePart =
    cache?.driveExcerpt?.trim() ?
      `\n\nDOCUMENTATION PRODUITS (Google Drive — ${cache.fileCount} fichier(s), sync ${cache.syncedAt.slice(0, 16)}):\n${cache.driveExcerpt}`
    : cache?.error
      ? `\n\n(Drive documentation : ${cache.error})`
      : "\n\n(Drive documentation : aucun PDF indexé pour l'instant — réponses basées sur la FAQ intégrée.)";

  return staticBlock + drivePart;
}

export function scheduleCamilleKnowledgeSync(dataDir: string) {
  const enabled =
    (process.env.CAMILLE_KNOWLEDGE_SYNC_ENABLED || "true").toLowerCase() !== "false";
  if (!enabled) return;

  const intervalMs = Number(process.env.CAMILLE_KNOWLEDGE_SYNC_INTERVAL_MS || 6 * 60 * 60 * 1000);

  const run = () => {
    syncCamilleKnowledgeFromDrive(null, dataDir).catch((e) =>
      console.warn("[Camille knowledge] Sync planifiée:", e?.message || e),
    );
  };

  const onStart = (process.env.CAMILLE_KNOWLEDGE_SYNC_ON_START || "true").toLowerCase() !== "false";
  if (onStart) {
    setTimeout(run, 15_000);
  }
  setInterval(run, intervalMs);
}
