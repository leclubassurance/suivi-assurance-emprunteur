import { Readable } from "stream";
import { createDriveClient } from "./googleAutomation";

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

/** Sous-dossier « Pièces jointes email » dans le dossier client. */
export async function ensureGmailAttachmentsSubfolder(
  parentFolderId: string,
  accessToken?: string | null,
): Promise<string | null> {
  const client = await createDriveClient(accessToken);
  if (!client) return null;

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
    console.error("[Gmail→Drive] Sous-dossier PJ:", err?.message || err);
    return parentFolderId;
  }
}
