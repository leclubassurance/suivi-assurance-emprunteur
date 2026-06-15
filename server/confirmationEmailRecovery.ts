import { readDB, writeDB } from "./db";
import type { Dossier } from "./dossierModel";
import { sendDossierConfirmationEmail } from "./dossierConfirmationEmail";

function dossierNeedsConfirmationResend(dossier: Dossier): boolean {
  const events = dossier.eventLog || [];
  const hasSent = events.some(
    (e) => e.type === "EMAIL_SENT" && e.meta?.template === "CONFIRMATION",
  );
  if (hasSent) return false;
  const hasFailed = events.some(
    (e) => e.type === "EMAIL_FAILED" && e.meta?.template === "CONFIRMATION",
  );
  return hasFailed;
}

export async function retryFailedConfirmationEmailsOnBoot(
  log: (message: string) => void,
): Promise<void> {
  if (String(process.env.RETRY_FAILED_CONFIRMATIONS_ON_BOOT || "true").toLowerCase() === "false") {
    return;
  }

  const explicitIds = String(
    process.env.RESEND_CONFIRMATION_DOSSIER_IDS || process.env.RESEND_CONFIRMATION_DOSSIER_ID || "",
  )
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const db = await readDB();
  const targets = db.dossiers.filter((dossier) => {
    if (explicitIds.length > 0) return explicitIds.includes(dossier.id);
    return dossierNeedsConfirmationResend(dossier);
  });

  if (!targets.length) return;

  log(`[Email recovery] ${targets.length} confirmation(s) à renvoyer au démarrage.`);

  for (const dossier of targets) {
    if (explicitIds.length === 0 && !dossierNeedsConfirmationResend(dossier)) continue;
    const result = await sendDossierConfirmationEmail(dossier, { log });
    if (result.ok) {
      log(`[Email recovery] Confirmation renvoyée pour ${dossier.id} (${result.channel}).`);
    } else {
      log(`[Email recovery] Échec ${dossier.id}: ${result.error || result.channel}`);
    }
  }

  await writeDB(db);
}

let recoveryStarted = false;

export function scheduleConfirmationEmailRecoveryOnBoot(log: (message: string) => void) {
  if (recoveryStarted || process.env.VERCEL) return;
  recoveryStarted = true;
  void retryFailedConfirmationEmailsOnBoot(log).catch((err) => {
    log(`[Email recovery] Erreur: ${err?.message || String(err)}`);
  });
}
