import { google } from 'googleapis';
import fs from 'fs';

export interface WorkspaceExportResult {
  success: boolean;
  status: 'SUCCESS' | 'WARNING' | 'FAILED';
  folderId?: string;
  spreadsheetId?: string;
  warning?: string;
  error?: string;
  connectedEmail?: string;
}

export async function getDriveDiagnostics(accessToken: string, parentId?: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const drive = google.drive({ version: 'v3', auth });

  const about = await drive.about.get({ fields: 'user(emailAddress,displayName)' });
  const email = about.data.user?.emailAddress || null;

  let parent: Record<string, unknown> | null = null;
  if (parentId) {
    try {
      const meta = await drive.files.get({
        fileId: parentId,
        fields: 'id,name,mimeType,driveId,capabilities',
        supportsAllDrives: true,
      });
      parent = {
        id: meta.data.id,
        name: meta.data.name,
        driveId: meta.data.driveId,
        canAddChildren: meta.data.capabilities?.canAddChildren,
      };
    } catch (err: any) {
      parent = { error: err?.message || String(err) };
    }
  }

  return { email, parent, configuredParentId: parentId || null };
}

export async function deleteDossierFromGoogleWorkspace(folderId: string, accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const drive = google.drive({ version: 'v3', auth });

  try {
    await drive.files.delete({ fileId: folderId, supportsAllDrives: true });
    return true;
  } catch (error) {
    console.error('Failed to delete Google Drive dossier folder', error);
    return false;
  }
}

async function getConnectedEmail(drive: any) {
  try {
    const about = await drive.about.get({ fields: 'user(emailAddress)' });
    return about.data.user?.emailAddress || null;
  } catch {
    return null;
  }
}

async function createFolder(drive: any, folderName: string, parentId?: string) {
  return drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: 'id,webViewLink',
    supportsAllDrives: true,
  });
}

export async function exportDossierToGoogleWorkspace(dossier: any, accessToken: string): Promise<WorkspaceExportResult> {
  if (!accessToken) {
    return {
      success: false,
      status: 'FAILED',
      error: "Token OAuth Google manquant. Déconnectez-vous puis reconnectez-vous dans l'admin.",
    };
  }

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const drive = google.drive({ version: 'v3', auth });
  const connectedEmail = await getConnectedEmail(drive);

  try {
    const primaryAssure = dossier.formData?.assures?.[0] || {};
    const clientNom = primaryAssure?.nom ? `${primaryAssure.prenom}_${primaryAssure.nom}` : dossier.id;
    const folderName = `Dossier_Assurance_${clientNom}`;

    const configuredParent = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID?.trim();
    let warning: string | undefined;
    let folderRes;

    const createAtRoot = async (reason?: string) => {
      const res = await createFolder(drive, folderName);
      if (reason) {
        warning =
          `${reason} Dossier créé dans le Drive de ${connectedEmail || 'votre compte connecté'} (racine / Mon Drive).`;
      }
      return res;
    };

    if (configuredParent) {
      try {
        folderRes = await createFolder(drive, folderName, configuredParent);
      } catch (parentErr: any) {
        console.warn('[Drive] Échec dossier parent, repli racine:', parentErr?.message || parentErr);
        try {
          folderRes = await createAtRoot(
            `Dossier parent « ${configuredParent} » inaccessible (${parentErr?.message || 'erreur'}).`,
          );
        } catch (rootErr: any) {
          return {
            success: false,
            status: 'FAILED',
            connectedEmail: connectedEmail || undefined,
            error:
              `Impossible d'écrire sur Drive (${rootErr?.message || rootErr}). ` +
              `Compte connecté : ${connectedEmail || 'inconnu'}. ` +
              `Reconnectez Google dans l'admin (autorisation Drive complète) ou supprimez GOOGLE_DRIVE_PARENT_FOLDER_ID sur Railway.`,
          };
        }
      }
    } else {
      folderRes = await createAtRoot();
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
        (warning ? `${warning} ` : '') +
        'Fichiers non copiés : chemins absents sur le serveur (normal si dossier créé avant migration Railway).';
    }

    return {
      success: true,
      status: warning ? 'WARNING' : 'SUCCESS',
      folderId,
      warning,
      connectedEmail: connectedEmail || undefined,
    };
  } catch (err: any) {
    console.error('Google Automation Error:', err);
    return {
      success: false,
      status: 'FAILED',
      connectedEmail: connectedEmail || undefined,
      error: err?.message || String(err),
    };
  }
}
