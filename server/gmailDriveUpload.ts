import { Readable } from "stream";
import { createDriveClient, resolveDriveAccessToken } from "./googleAutomation";
import { isDriveFolderNotFoundError } from "./driveConfig";

export type DriveUploadResult = {
  fileId: string;
  webViewLink?: string | null;
};

/** Envoie un fichier vers un dossier Drive (OAuth admin ou compte de service). */
export async function uploadBufferToDriveFolder(
  folderId: string,
  filename: string,
  mimeType: string,
  buffer: Buffer,
  accessToken?: string | null,
): Promise<DriveUploadResult | null> {
  if (!folderId || !buffer?.length) return null;

  const client = await createDriveClient(accessToken);
  if (!client) return null;

  try {
    const res = await client.drive.files.create({
      requestBody: {
        name: filename,
        parents: [folderId],
      },
      media: {
        mimeType: mimeType || "application/octet-stream",
        body: Readable.from(buffer),
      },
      supportsAllDrives: true,
      fields: "id,webViewLink",
    });
    if (!res.data.id) return null;
    return { fileId: res.data.id, webViewLink: res.data.webViewLink };
  } catch (err: any) {
    console.error("[Gmail→Drive] Upload échoué:", filename, err?.message || err);
    return null;
  }
}

/** Télécharge un fichier Drive (compte de service ou OAuth serveur). */
export async function downloadDriveFileToBuffer(
  fileId: string,
  accessToken?: string | null,
): Promise<Buffer | null> {
  if (!fileId) return null;

  let client = (await createDriveClient(accessToken)) || null;
  if (!client) {
    const resolved = await resolveDriveAccessToken(null);
    if (resolved.mode === "service_account" && resolved.client) {
      client = resolved.client;
    }
  }
  if (!client) return null;

  try {
    const res = await client.drive.files.get(
      {
        fileId,
        alt: "media",
        supportsAllDrives: true,
      },
      { responseType: "arraybuffer" },
    );
    const data = res.data as ArrayBuffer;
    return Buffer.from(data);
  } catch (err: any) {
    console.warn(`[Drive] Téléchargement ${fileId} échoué:`, err?.message || err);
    return null;
  }
}

function escapeDriveQueryString(s: string) {
  return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Recherche un fichier par nom dans un dossier Drive client. */
export async function findDriveFileIdInFolder(
  folderId: string,
  fileName: string,
  accessToken?: string | null,
): Promise<string | null> {
  if (!folderId || !fileName) return null;

  let client = (await createDriveClient(accessToken)) || null;
  if (!client) {
    const resolved = await resolveDriveAccessToken(null);
    if (resolved.mode === "service_account" && resolved.client) {
      client = resolved.client;
    }
  }
  if (!client) return null;

  const safeName = escapeDriveQueryString(fileName);
  try {
    const list = await client.drive.files.list({
      q: `'${folderId}' in parents and name='${safeName}' and trashed=false`,
      fields: "files(id,name)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageSize: 5,
    });
    return list.data.files?.[0]?.id || null;
  } catch (err: any) {
    console.warn(`[Drive] Recherche ${fileName} dans ${folderId}:`, err?.message || err);
    return null;
  }
}

/** Sous-dossier « Pièces jointes email » dans le dossier client. */
export async function ensureGmailAttachmentsSubfolder(
  parentFolderId: string,
  accessToken?: string | null,
): Promise<string | null> {
  const client = await createDriveClient(accessToken);
  // Ne pas bloquer l'usage du dossier parent si l'auth Drive échoue temporairement.
  if (!client) return parentFolderId;

  const subfolderName = "Pieces jointes email";
  try {
    const q = [
      `'${parentFolderId}' in parents`,
      `name='${subfolderName}'`,
      "mimeType='application/vnd.google-apps.folder'",
      "trashed=false",
    ].join(" and ");

    const existing = await client.drive.files.list({
      q,
      fields: "files(id)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageSize: 1,
    });
    if (existing.data.files?.[0]?.id) {
      return existing.data.files[0].id!;
    }

    const created = await client.drive.files.create({
      requestBody: {
        name: subfolderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentFolderId],
      },
      fields: "id",
      supportsAllDrives: true,
    });
    return created.data.id || null;
  } catch (err: any) {
    if (isDriveFolderNotFoundError(err)) {
      console.warn(
        `[Gmail→Drive] Dossier Drive introuvable (${parentFolderId}) — recréez le dossier client depuis l’admin.`,
      );
      return null;
    }
    console.error("[Gmail→Drive] Sous-dossier PJ:", err?.message || err);
    // Erreur autre que 404: on conserve le dossier parent (évite de "perdre" workspaceFolderId).
    return parentFolderId;
  }
}
