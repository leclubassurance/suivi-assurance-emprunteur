import crypto from "crypto";
import type { Apporteur } from "../shared/apporteurTypes";

export type ContractOtpEntry = {
  hash: string;
  expiresAt: number;
  attempts: number;
  sentAt: number;
};

const OTP_TTL_MS = 15 * 60 * 1000;
const OTP_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 6;

function hashOtp(apporteurId: string, code: string): string {
  return crypto.createHash("sha256").update(`${apporteurId}:${code.trim()}`).digest("hex");
}

async function readOtpEntry(apporteurId: string): Promise<ContractOtpEntry | null> {
  const { loadApporteurStore } = await import("./apporteurStore");
  const store = await loadApporteurStore();
  const apporteur = store.apporteurs.find((a) => a.id === apporteurId);
  return apporteur?.contractOtp || null;
}

async function writeOtpEntry(apporteurId: string, entry: ContractOtpEntry | null): Promise<void> {
  const { loadApporteurStore, persistApporteurStoreMutation } = await import("./apporteurStore");
  await loadApporteurStore();
  await persistApporteurStoreMutation((store) => {
    const apporteur = store.apporteurs.find((a) => a.id === apporteurId);
    if (!apporteur) return false;
    if (entry) {
      (apporteur as Apporteur).contractOtp = entry;
    } else {
      delete (apporteur as Apporteur).contractOtp;
    }
    return true;
  });
}

export async function issueApporteurContractOtp(apporteurId: string): Promise<{
  code: string;
  cooldownSeconds?: number;
}> {
  const existing = await readOtpEntry(apporteurId);
  if (existing && Date.now() - existing.sentAt < OTP_COOLDOWN_MS) {
    const cooldownSeconds = Math.ceil((OTP_COOLDOWN_MS - (Date.now() - existing.sentAt)) / 1000);
    return { code: "", cooldownSeconds };
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await writeOtpEntry(apporteurId, {
    hash: hashOtp(apporteurId, code),
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
    sentAt: Date.now(),
  });
  return { code };
}

export async function verifyApporteurContractOtp(apporteurId: string, code: string): Promise<boolean> {
  const entry = await readOtpEntry(apporteurId);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    await writeOtpEntry(apporteurId, null);
    return false;
  }
  if (entry.attempts >= MAX_ATTEMPTS) return false;

  const nextAttempts = entry.attempts + 1;
  const ok = entry.hash === hashOtp(apporteurId, code);
  if (ok) {
    await writeOtpEntry(apporteurId, null);
    return true;
  }
  await writeOtpEntry(apporteurId, { ...entry, attempts: nextAttempts });
  return false;
}

export function buildApporteurContractOtpEmailHtml(code: string): string {
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1F2937;line-height:1.6;max-width:520px;">
  <p style="font-size:15px;margin:0 0 12px 0;">Bonjour,</p>
  <p style="font-size:14px;margin:0 0 16px 0;">
    Voici votre code de validation pour signer votre contrat d'apporteur d'affaires Le Club Immobilier Français :
  </p>
  <p style="font-size:28px;font-weight:800;letter-spacing:6px;margin:0 0 16px 0;color:#1E3A8A;">${code}</p>
  <p style="font-size:13px;margin:0;color:#6B7280;">
    Ce code est valable 15 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.
  </p>
</div>`;
}
