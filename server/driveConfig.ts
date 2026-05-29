/** Version logique de la config Drive (visible dans /api/health). */
export const DRIVE_CONFIG_VERSION = 3;

/** Ancien ID racine Drive partagé — ne jamais utiliser comme parent. */
export const LEGACY_DRIVE_PARENT_ID = "0ALC2kSJGmwXjUk9PVA";

/** Dossier « Dossiers Clients Assurance » (…/folders/1KedZC85KypR6zpr5bZOLIh3eWAxiRz7u). */
export const RECOMMENDED_DRIVE_PARENT_ID = "1KedZC85KypR6zpr5bZOLIh3eWAxiRz7u";

export type ResolvedDriveParent = {
  parentId: string;
  rawEnv: string | null;
  autoCorrected: boolean;
  correctionNote?: string;
};

function normalizeEnvValue(value: string | undefined | null): string | null {
  if (!value) return null;
  let v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  return v || null;
}

export function isLegacyDriveParentId(id: string | null | undefined): boolean {
  if (!id) return false;
  return id === LEGACY_DRIVE_PARENT_ID || id.includes(LEGACY_DRIVE_PARENT_ID);
}

/** Toujours un parent valide : dossier « Dossiers Clients Assurance » par défaut. */
export function resolveDriveParentFolderId(): ResolvedDriveParent {
  const rawEnv = normalizeEnvValue(process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID);

  if (!rawEnv || isLegacyDriveParentId(rawEnv)) {
    const autoCorrected = Boolean(rawEnv);
    return {
      rawEnv,
      autoCorrected,
      parentId: RECOMMENDED_DRIVE_PARENT_ID,
      correctionNote: !rawEnv
        ? `GOOGLE_DRIVE_PARENT_FOLDER_ID absent — utilisation de « Dossiers Clients Assurance » (${RECOMMENDED_DRIVE_PARENT_ID}).`
        : `Ancien ID Drive (${LEGACY_DRIVE_PARENT_ID}) ignoré — utilisation de « Dossiers Clients Assurance » (${RECOMMENDED_DRIVE_PARENT_ID}). Mettez à jour Railway.`,
    };
  }

  if (rawEnv === RECOMMENDED_DRIVE_PARENT_ID) {
    return { rawEnv, autoCorrected: false, parentId: rawEnv };
  }

  return { rawEnv, autoCorrected: false, parentId: rawEnv };
}

/** Retire les erreurs Drive obsolètes (ancien ID) pour ne pas bloquer l’admin. */
export function isDriveFolderNotFoundError(err: unknown): boolean {
  const e = err as { code?: number; message?: string; response?: { status?: number } };
  const status = e?.code ?? e?.response?.status;
  const msg = String(e?.message || err || "");
  return status === 404 || /file not found|not found/i.test(msg);
}

export function sanitizeLegacyDriveWorkspaceState<T extends Record<string, unknown>>(dossier: T): T {
  const err = typeof dossier.workspaceError === "string" ? dossier.workspaceError : "";
  if (!err.includes(LEGACY_DRIVE_PARENT_ID) || dossier.workspaceFolderId) {
    return dossier;
  }
  const next = { ...dossier };
  delete next.workspaceError;
  if (next.workspaceStatus === "FAILED") {
    delete next.workspaceStatus;
  }
  return next;
}
