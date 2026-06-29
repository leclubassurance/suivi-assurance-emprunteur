import type { Apporteur } from "../shared/apporteurTypes";
import { resolveDriveParentFolderId } from "./driveConfig";
import { createDriveClient } from "./googleAutomation";
import { uploadBufferToDriveFolder } from "./gmailDriveUpload";
import { getServerAccessToken, hasServerOAuthRefreshToken } from "./googleOAuthServer";
import { hasServiceAccountReady } from "./serviceAccount";

export const APPORTEUR_DRIVE_ROOT_FOLDER_NAME = "Apporteurs_Affaires";

function sanitizeDriveNamePart(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

export function buildApporteurDriveFolderName(apporteur: Pick<Apporteur, "id" | "contactName" | "companyName">): string {
  const id = String(apporteur.id || "AP").toUpperCase();
  const contact = sanitizeDriveNamePart(apporteur.contactName);
  const company = sanitizeDriveNamePart(apporteur.companyName);
  if (company && company !== contact) return `Apporteur_${id}_${contact}_${company}`;
  return `Apporteur_${id}_${contact || "Partenaire"}`;
}

async function resolveDriveToken(): Promise<string | null> {
  if (hasServerOAuthRefreshToken()) {
    try {
      return await getServerAccessToken();
    } catch {
      return null;
    }
  }
  return null;
}

async function findChildFolder(
  parentId: string,
  name: string,
  accessToken: string | null,
): Promise<string | null> {
  const client = await createDriveClient(accessToken);
  if (!client) return null;
  const safeName = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  try {
    const list = await client.drive.files.list({
      q: [
        `'${parentId}' in parents`,
        `name='${safeName}'`,
        "mimeType='application/vnd.google-apps.folder'",
        "trashed=false",
      ].join(" and "),
      fields: "files(id)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageSize: 1,
    });
    return list.data.files?.[0]?.id || null;
  } catch {
    return null;
  }
}

async function createChildFolder(
  parentId: string,
  name: string,
  accessToken: string | null,
): Promise<string | null> {
  const client = await createDriveClient(accessToken);
  if (!client) return null;
  try {
    const created = await client.drive.files.create({
      requestBody: {
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      },
      fields: "id",
      supportsAllDrives: true,
    });
    return created.data.id || null;
  } catch (err: any) {
    console.warn("[Apporteur Drive] Création dossier:", name, err?.message || err);
    return null;
  }
}

async function ensureFolder(parentId: string, name: string, accessToken: string | null): Promise<string | null> {
  const existing = await findChildFolder(parentId, name, accessToken);
  if (existing) return existing;
  return createChildFolder(parentId, name, accessToken);
}

/** Crée ou retrouve le dossier Drive du partenaire sous « Apporteurs_Affaires ». */
export async function ensureApporteurDriveFolder(
  apporteur: Pick<Apporteur, "id" | "contactName" | "companyName" | "driveFolderId">,
): Promise<{ folderId: string; folderName: string } | null> {
  if (!hasServiceAccountReady() && !hasServerOAuthRefreshToken()) {
    console.warn("[Apporteur Drive] Auth Google indisponible — archivage ignoré.");
    return null;
  }

  const accessToken = await resolveDriveToken();
  if (apporteur.driveFolderId) {
    return {
      folderId: apporteur.driveFolderId,
      folderName: buildApporteurDriveFolderName(apporteur),
    };
  }

  const { parentId } = resolveDriveParentFolderId();
  const rootId = await ensureFolder(parentId, APPORTEUR_DRIVE_ROOT_FOLDER_NAME, accessToken);
  if (!rootId) return null;

  const folderName = buildApporteurDriveFolderName(apporteur);
  const folderId = await ensureFolder(rootId, folderName, accessToken);
  if (!folderId) return null;

  return { folderId, folderName };
}

export async function uploadApporteurContractPdfToDrive(params: {
  apporteur: Pick<Apporteur, "id" | "contactName" | "companyName" | "driveFolderId">;
  pdfBuffer: Buffer;
  filename: string;
}): Promise<{ folderId: string; fileId: string; webViewLink?: string | null } | null> {
  const folder = await ensureApporteurDriveFolder(params.apporteur);
  if (!folder) return null;

  const accessToken = await resolveDriveToken();
  const uploaded = await uploadBufferToDriveFolder(
    folder.folderId,
    params.filename,
    "application/pdf",
    params.pdfBuffer,
    accessToken,
  );
  if (!uploaded?.fileId) return null;

  return {
    folderId: folder.folderId,
    fileId: uploaded.fileId,
    webViewLink: uploaded.webViewLink,
  };
}
