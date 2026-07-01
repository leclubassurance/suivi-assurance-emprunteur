import type { Dossier } from "./dossierModel";
import { notifyRemiDossierNews, type DossierNewsKind } from "./camilleTelegramDigest";
import type { CamilleTelegramActionDetails } from "./camilleTelegramActionNotify";

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
  camilleAction?: CamilleTelegramActionDetails;
}) {
  await notifyRemiDossierNews(params.dossier, "camille_replied", {
    subject: params.subject,
    eventId: params.gmailId,
    extra: params.extra,
    camilleAction: params.camilleAction,
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
    eventId: params.reminder
      ? `esc_reminder_${params.dossier.id}`
      : params.gmailId || `esc_${params.dossier.id}`,
  });
}

function apporteurAdminUrl(): string {
  const base = String(
    process.env.PUBLIC_APP_URL || process.env.VITE_PUBLIC_APP_URL || process.env.APP_URL || "",
  ).replace(/\/$/, "");
  return base ? `${base}/admin/apporteurs` : "/admin/apporteurs";
}

/** Nouvelle candidature partenaire recommandée par un apporteur. */
export async function notifyTelegramPartnerRecruit(params: {
  recruit: {
    id: string;
    contactName: string;
    email: string;
    phone?: string;
    companyName?: string;
    notes?: string;
  };
  sponsorName: string;
  sponsorCompany?: string;
}) {
  const { isTelegramEnabled, getAllowedChatIdsForNotify, sendTelegramRaw } = await import("./telegramCamille");
  const { escapeTelegramHtml } = await import("./telegramUi");
  if (!isTelegramEnabled()) return;
  const enabled = (process.env.TELEGRAM_NOTIFY_ENABLED || "true").toLowerCase();
  if (enabled === "false" || enabled === "0") return;

  const adminLink = apporteurAdminUrl();
  const lines = [
    `<b>🤝 Nouvelle candidature apporteur</b>`,
    "",
    `<b>${escapeTelegramHtml(params.recruit.contactName)}</b>`,
    `📧 ${escapeTelegramHtml(params.recruit.email)}`,
  ];
  if (params.recruit.phone) lines.push(`📱 ${escapeTelegramHtml(params.recruit.phone)}`);
  if (params.recruit.companyName) lines.push(`🏢 ${escapeTelegramHtml(params.recruit.companyName)}`);
  lines.push(
    "",
    `Parrain : <b>${escapeTelegramHtml(params.sponsorName)}</b>${
      params.sponsorCompany ? ` (${escapeTelegramHtml(params.sponsorCompany)})` : ""
    }`,
  );
  if (params.recruit.notes) {
    lines.push("", `<i>${escapeTelegramHtml(params.recruit.notes.slice(0, 500))}</i>`);
  }
  lines.push("", `➡️ Admin : ${escapeTelegramHtml(adminLink)}`);

  const text = lines.join("\n");
  for (const chatId of getAllowedChatIdsForNotify()) {
    try {
      await sendTelegramRaw(chatId, text, { parse_mode: "HTML" } as any);
    } catch (err: any) {
      console.warn("[Telegram] candidature apporteur:", err?.message || err);
    }
  }
}

export async function notifyTelegramPartnerRecruitConverted(params: {
  recruit: { contactName: string; email: string };
  apporteur: { contactName: string; companyName: string; referralToken: string };
  sponsorName: string;
}) {
  const { isTelegramEnabled, getAllowedChatIdsForNotify, sendTelegramRaw } = await import("./telegramCamille");
  const { escapeTelegramHtml } = await import("./telegramUi");
  if (!isTelegramEnabled()) return;

  const text = [
    `<b>✅ Apporteur créé (candidature signée)</b>`,
    "",
    `<b>${escapeTelegramHtml(params.apporteur.contactName)}</b> — ${escapeTelegramHtml(params.apporteur.companyName)}`,
    `ref=${escapeTelegramHtml(params.apporteur.referralToken)}`,
    `Parrain : ${escapeTelegramHtml(params.sponsorName)}`,
  ].join("\n");

  for (const chatId of getAllowedChatIdsForNotify()) {
    try {
      await sendTelegramRaw(chatId, text, { parse_mode: "HTML" } as any);
    } catch {
      /* ignore */
    }
  }
}

/** Contrat apporteur signé (signature en ligne). */
export async function notifyTelegramApporteurContractSigned(params: {
  apporteur: { contactName: string; companyName?: string; email?: string; portalToken?: string; driveLink?: string | null };
}) {
  const { isTelegramEnabled, getAllowedChatIdsForNotify, sendTelegramRaw } = await import("./telegramCamille");
  const { escapeTelegramHtml } = await import("./telegramUi");
  if (!isTelegramEnabled()) return;
  const enabled = (process.env.TELEGRAM_NOTIFY_ENABLED || "true").toLowerCase();
  if (enabled === "false" || enabled === "0") return;

  const base = String(process.env.PUBLIC_APP_URL || process.env.VITE_PUBLIC_APP_URL || process.env.APP_URL || "").replace(
    /\/$/,
    "",
  );
  const portalLink = params.apporteur.portalToken ? `${base}/apporteur/${escapeTelegramHtml(params.apporteur.portalToken)}` : "";
  const lines = [
    `<b>✅ Contrat apporteur signé</b>`,
    "",
    `<b>${escapeTelegramHtml(params.apporteur.contactName)}</b>${
      params.apporteur.companyName ? ` — ${escapeTelegramHtml(params.apporteur.companyName)}` : ""
    }`,
  ];
  if (params.apporteur.email) lines.push(`📧 ${escapeTelegramHtml(params.apporteur.email)}`);
  if (portalLink) lines.push(`➡️ Portail : ${portalLink}`);
  if (params.apporteur.driveLink) lines.push(`📎 Drive : ${escapeTelegramHtml(params.apporteur.driveLink)}`);

  const text = lines.join("\n");
  for (const chatId of getAllowedChatIdsForNotify()) {
    try {
      await sendTelegramRaw(chatId, text, { parse_mode: "HTML" } as any);
    } catch (err: any) {
      console.warn("[Telegram] contrat apporteur signé:", err?.message || err);
    }
  }
}

export { notifyRemiDossierNews, type DossierNewsKind };
