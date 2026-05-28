import type { Dossier } from "./dossierModel";
import { notifyRemiDossierNews, type DossierNewsKind } from "./camilleTelegramDigest";

export async function notifyTelegramNewDossier(params: {
  dossier: Dossier;
  clientEmail: string;
  clientName?: string;
}) {
  await notifyRemiDossierNews(params.dossier, "new_dossier", {
    extra: `Email client : ${params.clientEmail}. ${params.clientName || ""}`.trim(),
    eventId: `created_${params.dossier.createdAt}`,
  });
}

export async function notifyTelegramClientInbound(params: {
  dossier: Dossier;
  clientEmail: string;
  subject: string;
  excerpt: string;
  gmailId?: string;
  extra?: string;
}) {
  await notifyRemiDossierNews(params.dossier, "client_message", {
    subject: params.subject,
    excerpt: params.excerpt,
    extra: [params.clientEmail, params.extra].filter(Boolean).join(" — "),
    eventId: params.gmailId,
  });
}

export async function notifyTelegramClientDocuments(params: {
  dossier: Dossier;
  fileNames: string[];
  gmailId?: string;
}) {
  await notifyRemiDossierNews(params.dossier, "client_documents", {
    extra: params.fileNames.join(", "),
    eventId: params.gmailId,
  });
}

export async function notifyTelegramCamilleReplied(params: {
  dossier: Dossier;
  subject: string;
  gmailId?: string;
  extra?: string;
}) {
  await notifyRemiDossierNews(params.dossier, "camille_replied", {
    subject: params.subject,
    eventId: params.gmailId,
    extra: params.extra,
  });
}

export async function notifyTelegramStaffOutbound(params: {
  dossier: Dossier;
  subject: string;
  gmailId?: string;
}) {
  await notifyRemiDossierNews(params.dossier, "staff_outbound", {
    subject: params.subject,
    eventId: params.gmailId,
  });
}

export async function notifyTelegramEscalation(params: {
  dossier: Dossier;
  clientEmail: string;
  reason: string;
  excerpt: string;
  gmailId?: string;
  reminder?: boolean;
}) {
  await notifyRemiDossierNews(params.dossier, "escalation", {
    subject: params.reminder ? "Rappel — intervention requise" : params.reason,
    excerpt: params.excerpt,
    extra: params.clientEmail,
    eventId: params.gmailId || `esc_${Date.now()}`,
  });
}

export { notifyRemiDossierNews, type DossierNewsKind };
