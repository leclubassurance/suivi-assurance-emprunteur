import nodemailer from "nodemailer";

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  from?: string;
  cc?: string[];
  bcc?: string[];
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
};

export type SendEmailResult =
  | { ok: true; providerId?: string }
  | { ok: false; error: string };

function getEnv(name: string) {
  return (process.env as any)[name] as string | undefined;
}

export function isEmailConfigured() {
  return Boolean(getEnv("SMTP_HOST") && getEnv("SMTP_USER") && getEnv("SMTP_PASS"));
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const host = getEnv("SMTP_HOST");
  const portRaw = getEnv("SMTP_PORT") || "587";
  const secure = (getEnv("SMTP_SECURE") || "false").toLowerCase() === "true";
  const user = getEnv("SMTP_USER");
  const pass = getEnv("SMTP_PASS");
  const from = input.from || getEnv("SMTP_FROM") || user || "no-reply@example.com";

  if (!host || !user || !pass) {
    // Simulation mode: return ok but do not send.
    return { ok: true, providerId: "SIMULATED" };
  }

  const transporter = nodemailer.createTransport({
    host,
    port: Number(portRaw),
    secure,
    auth: { user, pass },
  });

  try {
    const info = await transporter.sendMail({
      from,
      to: input.to,
      cc: (input.cc || []).filter(Boolean).join(", ") || undefined,
      bcc: (input.bcc || []).filter(Boolean).join(", ") || undefined,
      subject: input.subject,
      html: input.html,
      attachments: (input.attachments || []).map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType || "application/octet-stream",
      })),
    });
    return { ok: true, providerId: info.messageId };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

