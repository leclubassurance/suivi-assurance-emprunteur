import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import {
  DRIVE_CONFIG_VERSION,
  resolveDriveParentFolderId,
} from './driveConfig';
import { loadServiceAccountCredentials } from './serviceAccount';
import { ensureDocumentLocalFile } from './documentFileResolve';
import { findDriveFileIdInFolder } from './gmailDriveUpload';

export { DRIVE_CONFIG_VERSION };

function getUploadsDir(): string {
  const base =
    process.env.VERCEL || process.env.RAILWAY_ENVIRONMENT
      ? path.join('/tmp', 'data')
      : path.join(process.cwd(), 'data');
  return path.join(base, 'uploads');
}

type DriveDocSyncResult = {
  uploaded: number;
  linkedExisting: number;
  missing: string[];
};

async function syncDocumentsToDriveFolder(
  drive: any,
  dossier: any,
  folderId: string,
  accessToken?: string | null,
): Promise<DriveDocSyncResult> {
  const uploadsDir = getUploadsDir();
  let uploaded = 0;
  let linkedExisting = 0;
  const missing: string[] = [];

  for (const doc of dossier.formData?.documents || []) {
    const name = String(doc?.name || '').trim();
    if (!name) continue;

    if (doc.driveFileId) {
      linkedExisting++;
      continue;
    }

    const existingId = await findDriveFileIdInFolder(folderId, name, accessToken);
    if (existingId) {
      doc.driveFileId = existingId;
      doc.driveLink = `https://drive.google.com/file/d/${existingId}/view`;
      linkedExisting++;
      continue;
    }

    const resolved = await ensureDocumentLocalFile(dossier, doc, uploadsDir);
    const localPath = resolved.localPath;
    if (!localPath || !fs.existsSync(localPath)) {
      missing.push(name);
      continue;
    }

    const up = await drive.files.create({
      requestBody: {
        name: doc.name,
        parents: [folderId],
      },
      media: {
        mimeType: doc.type || 'application/octet-stream',
        body: fs.createReadStream(localPath),
      },
      supportsAllDrives: true,
      fields: 'id,webViewLink',
    });
    if (up.data?.id) {
      doc.driveFileId = up.data.id;
      doc.driveLink = up.data.webViewLink || `https://drive.google.com/file/d/${up.data.id}/view`;
    }
    uploaded++;
  }

  return { uploaded, linkedExisting, missing };
}

function buildDocumentsDriveWarning(sync: DriveDocSyncResult): string | undefined {
  if (!sync.missing.length) return undefined;
  const preview = sync.missing.slice(0, 3).join(', ');
  const extra = sync.missing.length > 3 ? ` (+${sync.missing.length - 3})` : '';
  return (
    `Fichiers non copiés vers Drive : ${preview}${extra}. ` +
    'Les fichiers uploadés ne sont plus sur le serveur Railway (disque éphémère). ' +
    'Déposez les PDF dans le dossier Drive à la main, puis cliquez « Synchroniser fichiers Drive ».'
  );
}
function isMockAccessToken(token?: string | null) {
  return !token || token.startsWith('mock-gdrive');
}

export async function createDriveClient(accessToken?: string | null) {
  if (!isMockAccessToken(accessToken)) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken! });
    const drive = google.drive({ version: 'v3', auth });
    const connectedEmail = await getConnectedEmail(drive);
    return { drive, connectedEmail, authMode: 'oauth' as const };
  }

  const credentials = loadServiceAccountCredentials();
  if (!credentials) return null;

  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    const drive = google.drive({ version: 'v3', auth });
    return {
      drive,
      connectedEmail: (credentials.client_email as string) || null,
      authMode: 'service_account' as const,
    };
  } catch (err) {
    console.error('[Drive] Compte de service : échec auth Drive', err);
    return null;
  }
}

/** Token OAuth admin ou, à défaut, auth compte de service (export auto sans admin connecté). */
export async function resolveDriveAccessToken(userOAuthToken?: string | null) {
  if (!isMockAccessToken(userOAuthToken)) {
    return { token: userOAuthToken!, mode: 'oauth' as const };
  }
  const client = await createDriveClient(null);
  if (client?.authMode === 'service_account') {
    return { token: '', mode: 'service_account' as const, client };
  }
  return { token: null, mode: 'none' as const };
}

export interface WorkspaceExportResult {
  success: boolean;
  status: 'SUCCESS' | 'WARNING' | 'FAILED';
  folderId?: string;
  spreadsheetId?: string;
  warning?: string;
  error?: string;
  connectedEmail?: string;
  parentFolderName?: string;
  authMode?: 'oauth' | 'service_account';
}

export interface DriveDiagnosticsResult {
  email: string | null;
  emailError?: string;
  configuredParentId: string | null;
  rawEnvParentId?: string | null;
  effectiveParentId?: string | null;
  autoCorrectedParent?: boolean;
  correctionNote?: string;
  parent: {
    id?: string;
    name?: string;
    accessible: boolean;
    canAddChildren?: boolean;
    error?: string;
  } | null;
  parentOk: boolean;
  summary: string;
  driveConfigVersion?: number;
  authMode?: 'oauth' | 'service_account';
}

export async function getDriveDiagnostics(accessToken: string, parentId?: string): Promise<DriveDiagnosticsResult> {
  const client = await createDriveClient(accessToken);
  if (!client) {
    const { loadServiceAccountDetails } = await import("./serviceAccount");
    const sa = loadServiceAccountDetails();
    const saHint = sa.parseError
      ? sa.parseError
      : sa.credentials
        ? "Compte de service présent mais auth Drive impossible."
        : "Ajoutez GOOGLE_SERVICE_ACCOUNT_JSON (JSON une ligne) ou GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 sur Railway.";
    return {
      email: null,
      emailError: saHint,
      configuredParentId: parentId || null,
      parent: null,
      parentOk: false,
      summary: saHint,
      driveConfigVersion: DRIVE_CONFIG_VERSION,
    };
  }
  const { drive } = client;

  let email: string | null = null;
  let emailError: string | undefined;

  try {
    const about = await drive.about.get({ fields: 'user(emailAddress,displayName)' });
    email = about.data.user?.emailAddress || null;
  } catch (err: any) {
    if (client.authMode === 'service_account' && client.connectedEmail) {
      email = client.connectedEmail;
    } else {
      emailError =
        err?.message ||
        "Impossible de lire le compte Google. Déconnectez-vous puis reconnectez-vous dans l'admin (autorisation Drive).";
    }
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

  const resolved = resolveDriveParentFolderId();

  return {
    email,
    emailError,
    configuredParentId: parentId || null,
    rawEnvParentId: resolved.rawEnv,
    effectiveParentId: resolved.parentId || null,
    autoCorrectedParent: resolved.autoCorrected,
    correctionNote: resolved.correctionNote,
    parent,
    parentOk,
    summary: resolved.correctionNote ? `${resolved.correctionNote} ${summary}` : summary,
    driveConfigVersion: DRIVE_CONFIG_VERSION,
    authMode: client.authMode,
  };
}

export async function deleteDossierFromGoogleWorkspace(folderId: string, accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const drive = google.drive({ version: 'v3', auth });

  try {
    await drive.files.delete({ fileId: folderId, supportsAllDrives: true });
    return true;
  } catch (error: any) {
    const msg = error?.message || String(error);
    console.warn(`[Drive] Dossier Drive non supprimé (${folderId}): ${msg}`);
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

function escapeDriveQueryString(s: string) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function sanitizeDriveNamePart(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

/** Un dossier Drive par LCIF — évite les conflits quand le même client a plusieurs dossiers. */
export function buildWorkspaceFolderName(dossier: {
  id?: string;
  formData?: { assures?: { prenom?: string; nom?: string }[] };
}): string {
  const lcif = String(dossier.id || 'LCIF').toUpperCase();
  const primary = dossier.formData?.assures?.[0] || {};
  const prenom = sanitizeDriveNamePart(primary.prenom);
  const nom = sanitizeDriveNamePart(primary.nom);
  if (prenom && nom) return `Dossier_Assurance_${lcif}_${prenom}_${nom}`;
  if (nom) return `Dossier_Assurance_${lcif}_${nom}`;
  return `Dossier_Assurance_${lcif}`;
}

async function findWorkspaceFolderInParent(
  drive: any,
  parentId: string,
  dossierId: string,
): Promise<string | null> {
  const lcif = escapeDriveQueryString(String(dossierId || '').toUpperCase());
  if (!lcif) return null;
  try {
    const list = await drive.files.list({
      q: [
        `'${parentId}' in parents`,
        "mimeType='application/vnd.google-apps.folder'",
        'trashed=false',
        `name contains '${lcif}'`,
      ].join(' and '),
      fields: 'files(id,name)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageSize: 20,
    });
    const expectedPrefix = `Dossier_Assurance_${lcif}`;
    const match = (list.data.files || []).find((f: { name?: string }) =>
      String(f.name || '').startsWith(expectedPrefix),
    );
    return match?.id || null;
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

export async function exportDossierToGoogleWorkspace(
  dossier: any,
  accessToken?: string | null,
): Promise<WorkspaceExportResult> {
  const client = await createDriveClient(accessToken);
  if (!client) {
    return {
      success: false,
      status: 'FAILED',
      error:
        "Aucun accès Google Drive. Reconnectez-vous dans l'admin (compte assurance@leclubimmobilier.fr) " +
        "ou configurez GOOGLE_SERVICE_ACCOUNT_JSON sur Railway et partagez le dossier parent avec l'email du compte de service.",
    };
  }

  const { drive } = client;
  const connectedEmail =
    client.authMode === 'oauth'
      ? await getConnectedEmail(drive)
      : client.connectedEmail;

  try {
    const folderName = buildWorkspaceFolderName(dossier);
    const dossierId = String(dossier.id || '').toUpperCase();

    const resolved = resolveDriveParentFolderId();
    const configuredParent = resolved.parentId; // toujours défini (dossier recommandé par défaut)
    let warning: string | undefined;
    if (resolved.correctionNote) {
      warning = resolved.correctionNote;
    }
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

    parentFolderName = await getParentFolderName(drive, configuredParent);
    const existingInParent =
      dossier.workspaceFolderId ||
      (await findWorkspaceFolderInParent(drive, configuredParent, dossierId));
    if (existingInParent) {
      const folderId = existingInParent;
      const sync = await syncDocumentsToDriveFolder(drive, dossier, folderId, accessToken);
      const docWarning = buildDocumentsDriveWarning(sync);
      if (docWarning) {
        warning = (warning ? `${warning} ` : '') + docWarning;
      }
      return {
        success: true,
        status: warning ? 'WARNING' : 'SUCCESS',
        folderId,
        warning:
          (warning ? `${warning} ` : '') +
          `Dossier Drive existant réutilisé (${folderName}).`,
        connectedEmail: connectedEmail || undefined,
        parentFolderName,
        authMode: client.authMode,
      };
    }

    try {
      folderRes = await createFolder(drive, folderName, configuredParent);
    } catch (parentErr: any) {
      console.warn('[Drive] Échec dossier parent, repli racine:', parentErr?.message || parentErr);
      try {
        folderRes = await createAtRoot(
          `Impossible d'écrire dans « ${parentFolderName || configuredParent} » (${parentErr?.message || 'erreur'}). ` +
            (client.authMode === 'service_account'
              ? `Partagez le dossier parent avec ${connectedEmail}.`
              : `Connectez-vous avec le compte propriétaire du dossier parent.`),
        );
      } catch (rootErr: any) {
        return {
          success: false,
          status: 'FAILED',
          connectedEmail: connectedEmail || undefined,
          error:
            `Impossible d'écrire sur Drive (${rootErr?.message || rootErr}). ` +
            `Compte : ${connectedEmail || 'inconnu'}. Parent : ${configuredParent}.`,
        };
      }
    }

    const folderId = folderRes.data.id!;

    const sync = await syncDocumentsToDriveFolder(drive, dossier, folderId, accessToken);
    const docWarning = buildDocumentsDriveWarning(sync);
    if (docWarning) {
      warning = (warning ? `${warning} ` : '') + docWarning;
    }

    return {
      success: true,
      status: warning ? 'WARNING' : 'SUCCESS',
      folderId,
      warning,
      connectedEmail: connectedEmail || undefined,
      parentFolderName: parentFolderName && !warning ? parentFolderName : undefined,
      authMode: client.authMode,
    };
  } catch (err: any) {
    console.error('Google Automation Error:', err);
    return {
      success: false,
      status: 'FAILED',
      connectedEmail: connectedEmail || undefined,
      authMode: client.authMode,
      error: err?.message || String(err),
    };
  }
}
