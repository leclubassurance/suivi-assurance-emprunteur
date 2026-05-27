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

function isParentNotFoundError(err: any) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('not found') || msg.includes('file not found') || err?.code === 404;
}

async function createFolder(drive: any, folderName: string, parentId?: string) {
  return drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: 'id',
    supportsAllDrives: true,
  });
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
    const folderName = `Dossier_Assurance_${clientNom}`;

    const configuredParent = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID?.trim();
    let warning: string | undefined;
    let folderRes;

    if (configuredParent) {
      try {
        folderRes = await createFolder(drive, folderName, configuredParent);
      } catch (err: any) {
        if (isParentNotFoundError(err)) {
          console.warn(`[Drive] Parent folder inaccessible (${configuredParent}), fallback to root.`);
          folderRes = await createFolder(drive, folderName);
          warning =
            `Le dossier parent (${configuredParent}) est inaccessible. Dossier créé à la racine de votre Drive. Partagez le dossier parent avec assurance@leclubimmobilier.fr ou retirez GOOGLE_DRIVE_PARENT_FOLDER_ID sur Railway.`;
        } else {
          throw err;
        }
      }
    } else {
      folderRes = await createFolder(drive, folderName);
    }

    const folderId = folderRes.data.id!;

    let uploaded = 0;
    if (dossier.formData?.documents?.length > 0) {
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
      warning =
        (warning ? warning + ' ' : '') +
        'Aucun fichier trouvé sur le serveur (uploads Railway). Réessayez Drive après un nouvel envoi du formulaire.';
    }

    return { success: true, status: warning ? 'WARNING' : 'SUCCESS', folderId, warning };
  } catch (err: any) {
    console.error('Google Automation Error:', err);
    return { success: false, status: 'FAILED', error: err.message };
  }
}
