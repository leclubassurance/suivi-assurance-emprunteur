/**
 * Rattrapage des exports Drive restés PENDING (ou docs orphelins avec localPath encore dispo).
 */
import { readDB, writeDB } from "./db";
import { exportDossierToGoogleWorkspace } from "./googleAutomation";
import { resolveAutonomousGoogleAccessToken } from "./requestAuth";

const STALE_PENDING_MS = 3 * 60_000;
const MAX_PER_TICK = 4;

let retryInProgress = false;

function hasOrphanLocalDocs(dossier: any): boolean {
  const docs = dossier?.formData?.documents;
  if (!Array.isArray(docs)) return false;
  return docs.some((d: any) => d?.name && !d.driveFileId && d.localPath);
}

function isStalePendingWithoutFolder(dossier: any, now: number): boolean {
  if (String(dossier?.workspaceStatus || "") !== "PENDING") return false;
  if (dossier?.workspaceFolderId) return false;
  const t = new Date(dossier.updatedAt || dossier.createdAt || 0).getTime();
  if (!Number.isFinite(t) || t <= 0) return true;
  return now - t >= STALE_PENDING_MS;
}

export async function retryStaleWorkspaceExports(): Promise<{
  tried: number;
  ok: number;
  failed: number;
}> {
  if (retryInProgress) return { tried: 0, ok: 0, failed: 0 };
  retryInProgress = true;
  let tried = 0;
  let ok = 0;
  let failed = 0;

  try {
    const db = await readDB();
    const now = Date.now();
    const token = (await resolveAutonomousGoogleAccessToken().catch(() => null)) || null;

    for (const dossier of db.dossiers) {
      if (tried >= MAX_PER_TICK) break;
      if (String(dossier?.id || "").startsWith("LCIF-99999")) continue;

      const needsRetry =
        isStalePendingWithoutFolder(dossier, now) ||
        (Boolean(dossier.workspaceFolderId) && hasOrphanLocalDocs(dossier));

      if (!needsRetry) continue;

      tried += 1;
      try {
        const result = await exportDossierToGoogleWorkspace(dossier, token);
        const currentDb = await readDB();
        const existing = currentDb.dossiers.find((d: any) => d.id === dossier.id);
        if (!existing) continue;

        if (result.success) {
          existing.workspaceStatus = result.status;
          existing.workspaceWarning = result.warning;
          existing.workspaceFolderId = result.folderId || existing.workspaceFolderId;
          existing.workspaceSheetId = result.spreadsheetId || existing.workspaceSheetId;
          existing.workspaceError = undefined;
          if (dossier.formData?.documents?.length) {
            existing.formData = existing.formData || {};
            const { unionDossierDocuments } = await import("./gmailAttachments");
            existing.formData.documents = unionDossierDocuments(
              existing.formData.documents || [],
              dossier.formData.documents,
            );
          }
          if (existing.status === "NOUVEAU") existing.status = "EN_COURS";
          ok += 1;
          console.log(
            `[Drive retry] ${existing.id} → ${result.status}` +
              (result.folderId ? ` folder=${result.folderId}` : ""),
          );
        } else {
          existing.workspaceStatus = "FAILED";
          existing.workspaceError = result.error;
          failed += 1;
          console.warn(`[Drive retry] ${existing.id} FAILED: ${result.error}`);
        }
        existing.updatedAt = new Date().toISOString();
        await writeDB(currentDb, existing);
      } catch (err: any) {
        failed += 1;
        console.warn(`[Drive retry] ${dossier.id}:`, err?.message || err);
      }
    }
  } finally {
    retryInProgress = false;
  }

  return { tried, ok, failed };
}
