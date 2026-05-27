import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

export interface WorkspaceExportResult {
  success: boolean;
  status: 'SUCCESS' | 'WARNING' | 'FAILED';
  folderId?: string;
  spreadsheetId?: string;
  warning?: string;
  error?: string;
}

export async function deleteDossierFromGoogleWorkspace(folderId: string, accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const drive = google.drive({ version: 'v3', auth });

  try {
    await drive.files.delete({ fileId: folderId });
    return true;
  } catch (error) {
    console.error("Failed to delete Google Drive dossier folder", error);
    return false;
  }
}

export async function exportDossierToGoogleWorkspace(dossier: any, accessToken: string): Promise<WorkspaceExportResult> {
  if (!accessToken) {
    return {
      success: false,
      status: 'FAILED',
      error: "Token OAuth Google manquant ou expiré. L'administrateur doit se connecter sur son tableau de bord."
    };
  }

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const drive = google.drive({ version: 'v3', auth });

  try {
    const primaryAssure = dossier.formData?.assures?.[0] || {};
    const clientNom = primaryAssure?.nom ? `${primaryAssure.prenom}_${primaryAssure.nom}` : dossier.id;

    // Default parent folder for Drive exports (can be overridden by env)
    const parentId = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID || "0ALC2kSJGmwXjUk9PVA";

    // Create a folder in the user's Drive
    const folderRes = await drive.files.create({
      requestBody: {
        name: `Dossier_Assurance_${clientNom}`,
        mimeType: 'application/vnd.google-apps.folder',
        ...(parentId ? { parents: [parentId] } : {}),
      },
      fields: 'id'
    });
    const folderId = folderRes.data.id!;

    // Upload documents
    if (dossier.formData?.documents && dossier.formData.documents.length > 0) {
      for (const doc of dossier.formData.documents) {
        if (!doc.localPath || !fs.existsSync(doc.localPath)) continue;
        await drive.files.create({
          requestBody: {
            name: doc.name,
            parents: [folderId]
          },
          media: {
            mimeType: doc.type || 'application/octet-stream',
            body: fs.createReadStream(doc.localPath)
          }
        });
      }
    }

    return { success: true, status: 'SUCCESS', folderId };
  } catch (err: any) {
    console.error("Google Automation Error:", err);
    return { success: false, status: 'FAILED', error: err.message };
  }
}
