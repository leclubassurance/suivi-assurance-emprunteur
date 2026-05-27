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
  parentFolderName?: string;
}

export interface DriveDiagnosticsResult {
  email: string | null;
  emailError?: string;
  configuredParentId: string | null;
  parent: {
    id?: string;
    name?: string;
    accessible: boolean;
    canAddChildren?: boolean;
    error?: string;
  } | null;
  parentOk: boolean;
  summary: string;
}

export async function getDriveDiagnostics(accessToken: string, parentId?: string): Promise<DriveDiagnosticsResult> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const drive = google.drive({ version: 'v3', auth });

  let email: string | null = null;
  let emailError: string | undefined;

  try {
    const about = await drive.about.get({ fields: 'user(emailAddress,displayName)' });
    email = about.data.user?.emailAddress || null;
  } catch (err: any) {
    emailError =
      err?.message ||
      "Impossible de lire le compte Google. Déconnectez-vous puis reconnectez-vous dans l'admin (autorisation Drive).";
  }

  let parent: DriveDiagnosticsResult['parent'] = null;
  if (parentId) {
    try {
      const meta = await drive.files.get({
        fileId: parentId,
        fields: 'id,name,mimeType,driveId,capabilities',
        supportsAllDrives: true,
      });
      const canAdd = meta.data.capabilities?.canAddChildren;
      parent = {
        id: meta.data.id || parentId,
        name: meta.data.name || undefined,
        accessible: true,
        canAddChildren: canAdd ?? undefined,
      };
      if (canAdd === false) {
        parent.accessible = false;
        parent.error = `Pas le droit de créer des sous-dossiers dans « ${meta.data.name} ».`;
      }
    } catch (err: any) {
      parent = {
        accessible: false,
        error: err?.message || String(err),
      };
    }
  }

  const parentOk = Boolean(parent?.accessible && parent.canAddChildren !== false);
  let summary: string;

  if (emailError) {
    summary = emailError;
  } else if (!parentId) {
    summary = `Compte ${email || '?'} — aucun dossier parent configuré (export à la racine Mon Drive).`;
  } else if (parentOk && parent?.name) {
    summary = `Compte ${email} — dossier parent « ${parent.name} » accessible. Vous pouvez cliquer sur Drive.`;
  } else if (parentOk) {
    summary = `Compte ${email} — dossier parent (${parentId}) accessible.`;
  } else {
    summary =
      `Compte ${email || '?'} — dossier parent inaccessible (${parent?.error || 'erreur'}). ` +
      `Vérifiez GOOGLE_DRIVE_PARENT_FOLDER_ID (ID dans l'URL …/folders/XXXX, pas la racine d'un Drive partagé) ` +
      `ou reconnectez Google avec assurance@leclubimmobilier.fr.`;
  }

  return {
    email,
    emailError,
    configuredParentId: parentId || null,
    parent,
    parentOk,
    summary,
  };
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

async function getParentFolderName(drive: any, parentId: string) {
  try {
    const meta = await drive.files.get({
      fileId: parentId,
      fields: 'name',
      supportsAllDrives: true,
    });
    return meta.data.name || undefined;
  } catch {
    return undefined;
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
    let parentFolderName: string | undefined;
    let folderRes;

    const createAtRoot = async (reason?: string) => {
      const res = await createFolder(drive, folderName);
      if (reason) {
        warning =
          `${reason} Dossier créé dans le Drive de ${connectedEmail || 'votre compte connecté'} (Mon Drive / racine).`;
      }
      return res;
    };

    if (configuredParent) {
      parentFolderName = await getParentFolderName(drive, configuredParent);
      try {
        folderRes = await createFolder(drive, folderName, configuredParent);
      } catch (parentErr: any) {
        console.warn('[Drive] Échec dossier parent, repli racine:', parentErr?.message || parentErr);
        try {
          folderRes = await createAtRoot(
            `Impossible d'écrire dans « ${parentFolderName || configuredParent} » (${parentErr?.message || 'erreur'}).`,
          );
        } catch (rootErr: any) {
          return {
            success: false,
            status: 'FAILED',
            connectedEmail: connectedEmail || undefined,
            error:
              `Impossible d'écrire sur Drive (${rootErr?.message || rootErr}). ` +
              `Compte connecté : ${connectedEmail || 'inconnu — reconnectez Google'}. ` +
              `Parent configuré : ${configuredParent}.`,
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
        'Fichiers non copiés : chemins absents sur le serveur (réessayez après un nouvel envoi formulaire).';
    }

    return {
      success: true,
      status: warning ? 'WARNING' : 'SUCCESS',
      folderId,
      warning,
      connectedEmail: connectedEmail || undefined,
      parentFolderName: parentFolderName && !warning ? parentFolderName : undefined,
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
