import crypto from "crypto";

type OtpEntry = {
  hash: string;
  expiresAt: number;
  attempts: number;
  sentAt: number;
};

const otpByApporteurId = new Map<string, OtpEntry>();

const OTP_TTL_MS = 15 * 60 * 1000;
const OTP_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 6;

function hashOtp(apporteurId: string, code: string): string {
  return crypto.createHash("sha256").update(`${apporteurId}:${code.trim()}`).digest("hex");
}

export function issueApporteurContractOtp(apporteurId: string): {
  code: string;
  cooldownSeconds?: number;
} {
  const existing = otpByApporteurId.get(apporteurId);
  if (existing && Date.now() - existing.sentAt < OTP_COOLDOWN_MS) {
    const cooldownSeconds = Math.ceil((OTP_COOLDOWN_MS - (Date.now() - existing.sentAt)) / 1000);
    return { code: "", cooldownSeconds };
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  otpByApporteurId.set(apporteurId, {
    hash: hashOtp(apporteurId, code),
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
    sentAt: Date.now(),
  });
  return { code };
}

export function verifyApporteurContractOtp(apporteurId: string, code: string): boolean {
  const entry = otpByApporteurId.get(apporteurId);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    otpByApporteurId.delete(apporteurId);
    return false;
  }
  if (entry.attempts >= MAX_ATTEMPTS) return false;

  entry.attempts += 1;
  const ok = entry.hash === hashOtp(apporteurId, code);
  if (ok) otpByApporteurId.delete(apporteurId);
  return ok;
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
