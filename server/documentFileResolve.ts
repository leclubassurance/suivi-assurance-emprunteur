import fs from "fs";
import path from "path";
import type { Dossier } from "./dossierModel";
import {
  downloadDriveFileToBuffer,
  findDriveFileIdInFolder,
} from "./gmailDriveUpload";
import { getServerAccessToken } from "./googleOAuthServer";
import { createDriveClient, resolveDriveAccessToken } from "./googleAutomation";

export type ResolveDocFileResult = {
  localPath: string | null;
  source?: "disk" | "drive_id" | "drive_folder";
  skipReason?: string;
};

async function serverDriveAccessToken(): Promise<string | null> {
  const oauth = await getServerAccessToken();
  if (oauth) return oauth;
  const resolved = await resolveDriveAccessToken(null);
  if (resolved.mode === "oauth" && resolved.token) return resolved.token;
  return null;
}

function sanitizeFilename(name: string) {
  return String(name || "document").replace(/[^\w.\- ()éèêëàâùûôîïçÉÈÊËÀÂÙÛÔÎÏÇ]/gi, "_");
}

/**
 * Garantit un fichier local pour analyse (OCR / PDF).
 * Sur Railway le disque est éphémère : récupère depuis Drive si besoin.
 */
export async function ensureDocumentLocalFile(
  dossier: Dossier,
  doc: any,
  uploadsDir: string,
): Promise<ResolveDocFileResult> {
  const candidates: string[] = [];
  if (doc?.localPath && typeof doc.localPath === "string") {
    candidates.push(doc.localPath);
  }
  const base = sanitizeFilename(path.basename(String(doc?.localPath || doc?.name || "document")));
  const dossierDir = path.join(uploadsDir, dossier.id);
  if (base) {
    candidates.push(path.join(dossierDir, base));
    candidates.push(path.join(uploadsDir, base));
  }
  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      return { localPath: p, source: "disk" };
    }
  }

  const accessToken = await serverDriveAccessToken();
  if (!accessToken && !(await createDriveClient(null))) {
    return { localPath: null, skipReason: "drive_not_configured" };
  }

  if (!fs.existsSync(dossierDir)) {
    fs.mkdirSync(dossierDir, { recursive: true });
  }

  let fileId = String(doc?.driveFileId || "").trim();
  if (!fileId && (dossier as any).workspaceFolderId && doc?.name) {
    fileId =
      (await findDriveFileIdInFolder(
        (dossier as any).workspaceFolderId,
        String(doc.name),
        accessToken,
      )) || "";
    if (fileId) {
      doc.driveFileId = fileId;
    }
  }

  if (!fileId) {
    return {
      localPath: null,
      skipReason: "file_missing_on_server",
    };
  }

  const buf = await downloadDriveFileToBuffer(fileId, accessToken);
  if (!buf?.length) {
    return { localPath: null, skipReason: "drive_download_failed" };
  }

  const dest = path.join(dossierDir, base || `drive_${fileId.slice(0, 8)}`);
  fs.writeFileSync(dest, buf);
  doc.localPath = dest;
  if (!doc.size) doc.size = buf.length;

  return {
    localPath: dest,
    source: doc.driveFileId === fileId ? "drive_id" : "drive_folder",
  };
}
