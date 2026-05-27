import { google } from 'googleapis';
import fs from 'fs';

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
    await drive.files.delete({ fileId: folderId, supportsAllDrives: true });
    return true;
  } catch (error) {
    console.error("Failed to delete Google Drive dossier folder", error);
    return false;
  }
}

async function parentFolderAccessible(drive: any, parentId: string) {
  try {
    await drive.files.get({
      fileId: parentId,
      fields: 'id,name,mimeType',
      supportsAllDrives: true,
    });
    return true;
  } catch {
    return false;
  }
}

export async function exportDossierToGoogleWorkspace(dossier: any, accessToken: string): Promise<WorkspaceExportResult> {
  if (!accessToken) {
    return {
      success: false,
      status: 'FAILED',
      error: "Token OAuth Google manquant ou expiré. L'administrateur doit se connecter sur son tableau de bord.",
    };
  }

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const drive = google.drive({ version: 'v3', auth });

  try {
    const primaryAssure = dossier.formData?.assures?.[0] || {};
    const clientNom = primaryAssure?.nom ? `${primaryAssure.prenom}_${primaryAssure.nom}` : dossier.id;

    const configuredParent = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID?.trim();
    let parentId: string | undefined = configuredParent || undefined;
    let warning: string | undefined;

    if (parentId) {
      const ok = await parentFolderAccessible(drive, parentId);
      if (!ok) {
        warning =
          `Dossier parent Drive introuvable (${parentId}). Le dossier client a été créé à la racine de votre Drive. Vérifiez GOOGLE_DRIVE_PARENT_FOLDER_ID ou partagez le dossier parent avec votre compte Google.`;
        parentId = undefined;
      }
    }

    const folderRes = await drive.files.create({
      requestBody: {
        name: `Dossier_Assurance_${clientNom}`,
        mimeType: 'application/vnd.google-apps.folder',
        ...(parentId ? { parents: [parentId] } : {}),
      },
      fields: 'id',
      supportsAllDrives: true,
    });
    const folderId = folderRes.data.id!;

    let uploaded = 0;
    if (dossier.formData?.documents && dossier.formData.documents.length > 0) {
      for (const doc of dossier.formData.documents) {
        if (!doc.localPath || !fs.existsSync(doc.localPath)) continue;
        await drive.files.create({
          requestBody: {
            name: doc.name,
            parents: [folderId],
          },
          media: {
            mimeType: doc.type || 'application/octet-stream',
            body: fs.createReadStream(doc.localPath),
          },
          supportsAllDrives: true,
        });
        uploaded++;
      }
    }

    if (uploaded === 0 && dossier.formData?.documents?.length > 0) {
      warning = (warning ? warning + " " : "") + "Aucun fichier local trouvé sur le serveur (chemins uploads manquants).";
    }

    return { success: true, status: warning ? 'WARNING' : 'SUCCESS', folderId, warning };
  } catch (err: any) {
    console.error("Google Automation Error:", err);
    return { success: false, status: 'FAILED', error: err.message };
  }
}
