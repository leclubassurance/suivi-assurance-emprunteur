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
/** Parcours Kereis + scripts ADE : budget prioritaire (fiches produits en second). */
const MAX_PROCESS_PROMPT_CHARS = 22_000;
const MAX_PRODUCT_PROMPT_CHARS = 10_000;

const PROCESS_DOC_RE =
  /kereis|parcours|espace.adherent|espace_adherent|script|scripts|ade|substitution/i;

export function isProcessKnowledgeFile(name: string): boolean {
  return PROCESS_DOC_RE.test(name);
}

function knowledgeFileSortKey(name: string): number {
  if (/kereis|parcours|espace/i.test(name)) return 0;
  if (/script|ade/i.test(name)) return 1;
  if (isProcessKnowledgeFile(name)) return 2;
  return 10;
}

export type CamilleKnowledgeCache = {
  syncedAt: string;
  folderId: string;
  fileCount: number;
  files: Array<{ name: string; chars: number; kind?: "process" | "product" }>;
  driveExcerpt: string;
  ragChunkCount?: number;
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

function resolveDataDir(dataDir?: string): string {
  if (dataDir) return dataDir;
  const { getDbFilePath } = require("./db") as typeof import("./db");
  return path.dirname(getDbFilePath());
}

export type CamilleKnowledgeRetrievalQuery = {
  clientMessage?: string;
  subscriptionPhase?: string | null;
  studySent?: boolean;
};

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

    const sortedRows = [...rows].sort(
      (a, b) => knowledgeFileSortKey(a.name) - knowledgeFileSortKey(b.name) || a.name.localeCompare(b.name),
    );

    const processParts: string[] = [];
    const productParts: string[] = [];
    const fileMeta: Array<{ name: string; chars: number; kind: "process" | "product" }> = [];
    const parsedForRag: import("./camilleKnowledgeRag").ParsedKnowledgeFile[] = [];

    for (const row of sortedRows) {
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
      const isProcess = isProcessKnowledgeFile(row.name);
      const kind = isProcess ? "process" : "product";
      parsedForRag.push({ name: row.name, text, kind });
      const maxPerFile = isProcess ? MAX_EXCERPT_PER_FILE : Math.min(MAX_EXCERPT_PER_FILE, 6_000);
      const excerpt = text.slice(0, maxPerFile);
      const block = `--- ${row.name} ---\n${excerpt}`;
      if (isProcess) processParts.push(block);
      else productParts.push(block);
      fileMeta.push({ name: row.name, chars: excerpt.length, kind });
    }

    let processBlock = processParts.join("\n\n");
    if (processBlock.length > MAX_PROCESS_PROMPT_CHARS) {
      processBlock = processBlock.slice(0, MAX_PROCESS_PROMPT_CHARS) + "\n\n[… tronqué — parcours/scripts …]";
    }
    let productBlock = productParts.join("\n\n");
    if (productBlock.length > MAX_PRODUCT_PROMPT_CHARS) {
      productBlock = productBlock.slice(0, MAX_PRODUCT_PROMPT_CHARS) + "\n\n[… tronqué — fiches produits …]";
    }

    const driveExcerpt = [
      processBlock
        ? `=== PARCOURS KEREIS & SCRIPTS RÉPONSES CLIENT (priorité — source de vérité process) ===\n${processBlock}`
        : "",
      productBlock ? `=== FICHES PRODUITS ASSURANCE ===\n${productBlock}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    let ragChunkCount = 0;
    const dir = dataDir ? resolveDataDir(dataDir) : undefined;
    if (dir && parsedForRag.length > 0) {
      try {
        const { buildKnowledgeIndexFromFiles } = await import("./camilleKnowledgeRag");
        const index = await buildKnowledgeIndexFromFiles(parsedForRag, folderId, dir);
        ragChunkCount = index.chunkCount;
      } catch (e: any) {
        console.warn("[Camille knowledge RAG] Index non construit:", e?.message || e);
      }
    }

    const cache: CamilleKnowledgeCache = {
      syncedAt: new Date().toISOString(),
      folderId,
      fileCount: fileMeta.length,
      files: fileMeta,
      driveExcerpt,
      ragChunkCount,
    };
    memoryCache = cache;
    if (dataDir) saveCacheToDisk(resolveDataDir(dataDir), cache);
    console.log(
      `[Camille knowledge] Sync OK : ${fileMeta.length} fichier(s), ${driveExcerpt.length} caractères, RAG ${ragChunkCount} chunk(s).`,
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

/** Texte complet pour le prompt Gemini (statique + RAG ou Drive brut). */
export async function buildCamilleKnowledgePromptBlock(
  accessToken?: string | null,
  dataDir?: string,
  retrievalQuery?: CamilleKnowledgeRetrievalQuery,
): Promise<string> {
  const staticBlock = buildStaticCamilleKnowledgeBlock();
  const dir = resolveDataDir(dataDir);
  let cache = getCamilleKnowledgeCache(dir);
  if (!cache?.driveExcerpt && !cache?.error) {
    try {
      cache = await syncCamilleKnowledgeFromDrive(accessToken, dir);
    } catch (e: any) {
      console.warn("[Camille knowledge] Sync à la volée:", e?.message || e);
    }
  }

  const ragQuery = retrievalQuery?.clientMessage?.trim();
  if (ragQuery) {
    try {
      const { retrieveKnowledgeChunks, formatRetrievedChunksForPrompt, getKnowledgeIndexStatus } =
        await import("./camilleKnowledgeRag");
      const status = getKnowledgeIndexStatus(dir);
      if (status.ragEnabled && status.chunkCount > 0) {
        const chunks = await retrieveKnowledgeChunks(dir, {
          clientMessage: retrievalQuery.clientMessage,
          subscriptionPhase: retrievalQuery.subscriptionPhase,
          studySent: retrievalQuery.studySent,
        });
        const ragBlock = formatRetrievedChunksForPrompt(chunks);
        if (ragBlock) {
          const filesLine = cache?.files?.length
            ? `\n(Index RAG : ${status.chunkCount} chunks, sync ${status.syncedAt?.slice(0, 16) || "?"})`
            : "";
          return `${staticBlock}\n\n${ragBlock}${filesLine}`;
        }
      }
    } catch (e: any) {
      console.warn("[Camille knowledge RAG] Retrieval:", e?.message || e);
    }
  }

  const processCount =
    cache?.files?.filter((f) => isProcessKnowledgeFile(f.name)).length ?? 0;
  const drivePart =
    cache?.driveExcerpt?.trim() ?
      `\n\nDOCUMENTATION DRIVE (fallback intégral — ${cache.fileCount} fichier(s), dont ${processCount} process/scripts, sync ${cache.syncedAt.slice(0, 16)}):\n${cache.driveExcerpt}`
    : cache?.error
      ? `\n\n(Drive documentation : ${cache.error})`
      : "\n\n(Drive documentation : aucun PDF indexé — lancer sync admin ou vérifier CAMILLE_KNOWLEDGE_DRIVE_FOLDER_ID.)";

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
