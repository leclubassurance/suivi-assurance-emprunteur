import type { Dossier } from "./dossierModel";
import { borrowerDisplayName } from "./telegramUi";
import type { CamillePendingReview } from "./camilleReviewQueue";
import { isStaffMailbox } from "./camilleStaffHandoff";
import { extractStaffInstructionFromEmail } from "./camilleEscalationReply";

const REVIEW_SUBJECT_PREFIX = "[Camille]";

export function getStaffReviewEmail(): string {
  return String(
    process.env.CAMILLE_STAFF_REVIEW_EMAIL ||
      process.env.AI_ESCALATION_EMAIL ||
      "remi@leclubimmobilier.fr",
  )
    .trim()
    .toLowerCase();
}

/** Canal de validation humaine : email par défaut (Rémi pilote par mail). */
export function isCamilleEmailReviewEnabled(): boolean {
  const raw = String(process.env.CAMILLE_REVIEW_EMAIL_ENABLED ?? "true").toLowerCase();
  if (raw === "false" || raw === "0") return false;
  return Boolean(getStaffReviewEmail());
}

export function getCamilleReviewChannel(): "email" | "telegram" | "both" {
  const ch = String(process.env.CAMILLE_REVIEW_CHANNEL || "email").toLowerCase();
  if (ch === "telegram" || ch === "both") return ch;
  return "email";
}

export function shouldNotifyReviewByEmail(): boolean {
  const ch = getCamilleReviewChannel();
  if (ch === "telegram") return false;
  return isCamilleEmailReviewEnabled();
}

export function shouldNotifyReviewByTelegram(): boolean {
  const ch = getCamilleReviewChannel();
  if (ch === "email") return false;
  return false; // resolved dynamically in camilleReviewQueue to avoid circular import
}

export async function isTelegramReviewAvailable(): Promise<boolean> {
  const ch = getCamilleReviewChannel();
  if (ch === "email") return false;
  const { isTelegramEnabled } = await import("./telegramCamille");
  return isTelegramEnabled();
}

export function buildReviewEmailSubject(dossierId: string, kind: "draft" | "question"): string {
  const id = dossierId.toUpperCase();
  return kind === "draft"
    ? `${REVIEW_SUBJECT_PREFIX} Brouillon ${id} — à valider`
    : `${REVIEW_SUBJECT_PREFIX} Question ${id} — votre consigne`;
}

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatDraftValidationEmailHtml(params: {
  dossier: Dossier;
  review: CamillePendingReview;
  extraLabel?: string;
}): string {
  const name = borrowerDisplayName(params.dossier);
  const clientExcerpt = escapeHtml(params.review.clientMessageExcerpt.slice(0, 900));
  const draft = escapeHtml(
    String(params.review.proposedClientPlain || "").slice(0, 3500),
  );
  const reason = params.review.reason
    ? `<p style="color:#6b7280;font-size:13px;"><i>${escapeHtml(params.review.reason)}</i></p>`
    : "";
  const label = params.extraLabel
    ? `<p style="color:#1e40af;font-size:14px;"><b>${escapeHtml(params.extraLabel)}</b></p>`
    : "";

  return `
<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#111827;max-width:640px;">
  <p style="background:#1e3a8a;color:#fff;padding:12px 16px;border-radius:8px;margin:0 0 16px;">
    <b>Camille — brouillon à valider</b><br>
    <span style="font-size:13px;">${escapeHtml(params.dossier.id)} — ${escapeHtml(name)}</span>
  </p>
  ${label}
  ${reason}
  <p><b>Message client :</b></p>
  <blockquote style="margin:0 0 16px;padding:12px;border-left:4px solid #93c5fd;background:#f8fafc;">
    ${clientExcerpt || "—"}
  </blockquote>
  <p><b>Brouillon proposé pour le client :</b></p>
  <blockquote style="margin:0 0 16px;padding:12px;border-left:4px solid #86efac;background:#f0fdf4;white-space:pre-wrap;">
    ${draft || "—"}
  </blockquote>
  <p style="background:#eff6ff;padding:12px;border-radius:8px;font-size:14px;">
    <b>Que faire ?</b> Répondez à ce mail :<br>
    • <b>OK ENVOIE</b> ou <b>JE VALIDE</b> → envoi au client<br>
    • <b>Votre texte</b> → Camille révise le brouillon puis vous renvoie une validation<br>
    • <b>NON</b> ou <b>ANNULER</b> → pas d'envoi
  </p>
  <p style="color:#6b7280;font-size:12px;margin-top:20px;">
    Dossier ${escapeHtml(params.dossier.id)} — aucun mail client n'est parti tant que vous n'avez pas validé.
  </p>
</div>`.trim();
}

export function formatQuestionForDraftEmailHtml(params: {
  dossier: Dossier;
  review: CamillePendingReview;
}): string {
  const name = borrowerDisplayName(params.dossier);
  const clientExcerpt = escapeHtml(params.review.clientMessageExcerpt.slice(0, 900));
  const question = escapeHtml(params.review.questionForStaff.slice(0, 1200));

  return `
<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#111827;max-width:640px;">
  <p style="background:#92400e;color:#fff;padding:12px 16px;border-radius:8px;margin:0 0 16px;">
    <b>Camille — votre consigne attendue</b><br>
    <span style="font-size:13px;">${escapeHtml(params.dossier.id)} — ${escapeHtml(name)}</span>
  </p>
  <p><b>Message client :</b></p>
  <blockquote style="margin:0 0 16px;padding:12px;border-left:4px solid #93c5fd;background:#f8fafc;">
    ${clientExcerpt || "—"}
  </blockquote>
  <p><b>Question Camille :</b></p>
  <blockquote style="margin:0 0 16px;padding:12px;border-left:4px solid #fcd34d;background:#fffbeb;">
    ${question}
  </blockquote>
  <p style="background:#eff6ff;padding:12px;border-radius:8px;font-size:14px;">
    Répondez à ce mail avec votre consigne en français libre — Camille rédigera un brouillon puis vous le renverra pour validation.
  </p>
</div>`.trim();
}

export async function sendCamilleReviewEmail(params: {
  dossier: Dossier;
  review: CamillePendingReview;
  kind: "draft" | "question";
  extraLabel?: string;
}): Promise<{ ok: boolean; gmailId?: string; error?: string }> {
  if (!shouldNotifyReviewByEmail()) {
    return { ok: false, error: "email_review_disabled" };
  }

  const to = getStaffReviewEmail();
  const subject = buildReviewEmailSubject(params.dossier.id, params.kind);
  const html =
    params.kind === "draft"
      ? formatDraftValidationEmailHtml({
          dossier: params.dossier,
          review: params.review,
          extraLabel: params.extraLabel,
        })
      : formatQuestionForDraftEmailHtml({ dossier: params.dossier, review: params.review });

  const { sendEmailReplyWithGmailAPI } = await import("./mailAutomation");
  const send = await sendEmailReplyWithGmailAPI(null, to, subject, html);
  if (!send.ok) return { ok: false, error: send.error };

  params.review.reviewChannel = params.review.reviewChannel || "email";
  params.review.staffEmailGmailId = send.messageId;
  params.review.staffEmailThreadSubject = subject;
  const outboundIds = Array.isArray(params.review.staffReviewOutboundGmailIds)
    ? [...params.review.staffReviewOutboundGmailIds]
    : [];
  if (send.messageId && !outboundIds.includes(send.messageId)) {
    outboundIds.push(send.messageId);
  }
  params.review.staffReviewOutboundGmailIds = outboundIds;
  params.review.updatedAt = new Date().toISOString();

  return { ok: true, gmailId: send.messageId };
}

export function extractLcifFromReviewEmailSubject(subject: string): string | null {
  const m = String(subject || "").match(/LCIF-\d{6}/i);
  return m ? m[0].toUpperCase() : null;
}

/** Corps d'un mail [Camille] sortant (brouillon / question) — pas une réponse équipe. */
export function isCamilleReviewSystemEmailBody(text: string): boolean {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return false;
  return (
    /\bcamille\s*[—-]\s*(brouillon|question|votre consigne)\b/.test(t) ||
    /\bbrouillon proposé pour le client\b/.test(t) ||
    /\bque faire\s*\?/.test(t) ||
    (/\bmessage client\s*:/.test(t) && /\b(ok envoie|je valide)\b/.test(t))
  );
}

export function isStaffReviewEmailReply(labelIds: string[], senderEmail: string): boolean {
  if ((labelIds || []).includes("SENT")) return false;
  if (!isStaffMailbox(senderEmail)) return false;
  const gmailUser = String(process.env.GMAIL_USER || "assurance@leclubimmobilier.fr").toLowerCase();
  if (senderEmail.toLowerCase() === gmailUser) return false;
  return true;
}

export function isCamilleReviewStaffInbound(
  subject: string,
  senderEmail: string,
  opts?: { labelIds?: string[] },
): boolean {
  if (!String(subject || "").includes(REVIEW_SUBJECT_PREFIX)) return false;
  if (!isStaffMailbox(senderEmail)) return false;
  if ((opts?.labelIds || []).includes("SENT")) return false;
  const gmailUser = String(process.env.GMAIL_USER || "assurance@leclubimmobilier.fr").toLowerCase();
  if (senderEmail.toLowerCase() === gmailUser) return false;
  return Boolean(extractLcifFromReviewEmailSubject(subject));
}

function isIgnoredStaffReviewOutboundId(review: CamillePendingReview, gmailId: string): boolean {
  const id = String(gmailId || "");
  if (!id) return false;
  if (review.staffEmailGmailId && String(review.staffEmailGmailId) === id) return true;
  const outbound = review.staffReviewOutboundGmailIds || [];
  return outbound.some((x) => String(x) === id);
}

export function findDossierWithPendingReviewByLcif(
  dossiers: Dossier[],
  lcif: string,
): Dossier | null {
  const id = lcif.toUpperCase();
  const matches = dossiers.filter((d) => {
    if (String(d.id).toUpperCase() !== id) return false;
    const r = d.camillePendingReview as CamillePendingReview | undefined;
    return Boolean(r && (r.status === "awaiting_staff" || r.status === "awaiting_confirm"));
  });
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    return matches.sort(
      (a, b) =>
        new Date((b.camillePendingReview as CamillePendingReview).updatedAt || 0).getTime() -
        new Date((a.camillePendingReview as CamillePendingReview).updatedAt || 0).getTime(),
    )[0];
  }
  return null;
}

/**
 * Réponses Rémi/équipe aux mails [Camille] Brouillon / Question — validation ou consigne.
 */
export async function syncCamilleReviewStaffEmailReplies(
  gmail: { users: { messages: { list: (a: any) => Promise<any>; get: (a: any) => Promise<any> } } },
  db: { dossiers: Dossier[] },
  processedIds: Set<string>,
  helpers: {
    upsertCommunication: (dossier: Dossier, msg: any) => void;
    markProcessed: (dossier: Dossier, gmailId: string) => void;
  },
): Promise<number> {
  const staffEmail = getStaffReviewEmail();
  // Réponses équipe aux mails [Camille] — toute boîte @leclubimmobilier.fr (pas seulement CAMILLE_STAFF_REVIEW_EMAIL).
  const queries = [
    `subject:"${REVIEW_SUBJECT_PREFIX}" from:@leclubimmobilier.fr -in:sent newer_than:90d`,
    `subject:"${REVIEW_SUBJECT_PREFIX}" from:${staffEmail} -in:sent newer_than:90d`,
  ];

  let handled = 0;
  const seen = new Set<string>();

  for (const q of queries) {
    void staffEmail;
    const listRes = await gmail.users.messages.list({ userId: "me", q, maxResults: 40 });
    for (const msgMeta of listRes.data.messages || []) {
      if (!msgMeta.id || processedIds.has(msgMeta.id) || seen.has(msgMeta.id)) continue;
      seen.add(msgMeta.id);

      const msgRes = await gmail.users.messages.get({
        userId: "me",
        id: msgMeta.id,
        format: "full",
      });
      const payload = msgRes.data.payload;
      if (!payload?.headers) continue;

      const subject =
        payload.headers.find((h: any) => h.name?.toLowerCase() === "subject")?.value || "";
      const fromRaw =
        payload.headers.find((h: any) => h.name?.toLowerCase() === "from")?.value || "";
      const { extractEmail, decodeEmailBodies } = await import("./mailAutomation");
      const senderEmail = extractEmail(fromRaw);
      const labelIds = msgRes.data.labelIds || [];
      if (!isStaffReviewEmailReply(labelIds, senderEmail)) continue;
      if (!isCamilleReviewStaffInbound(subject, senderEmail, { labelIds })) continue;

      const lcif = extractLcifFromReviewEmailSubject(subject);
      if (!lcif) continue;

      const dossier = findDossierWithPendingReviewByLcif(db.dossiers, lcif);
      if (!dossier) continue;

      const review = dossier.camillePendingReview as CamillePendingReview | undefined;
      if (!review) continue;

      if (isIgnoredStaffReviewOutboundId(review, String(msgMeta.id))) {
        helpers.markProcessed(dossier, msgMeta.id);
        processedIds.add(msgMeta.id);
        continue;
      }

      const processed = new Set<string>((dossier.processedGmailIds || []).map(String));
      if (processed.has(msgMeta.id)) {
        processedIds.add(msgMeta.id);
        continue;
      }

      const { text } = decodeEmailBodies(payload);
      const instruction = extractStaffInstructionFromEmail(text);
      if (isCamilleReviewSystemEmailBody(instruction || text)) {
        helpers.markProcessed(dossier, msgMeta.id);
        processedIds.add(msgMeta.id);
        continue;
      }
      const msgDate = new Date(Number(msgRes.data.internalDate || Date.now())).toISOString();

      helpers.upsertCommunication(dossier, {
        id: `msg_staff_review_${msgMeta.id}`,
        gmailId: msgMeta.id,
        direction: "inbound",
        from: senderEmail,
        subject,
        text: instruction || text.slice(0, 2000),
        date: msgDate,
      });

      const { tryHandleCamilleReviewStaffEmailReply } = await import("./camilleReviewQueue");
      const { acquireCamilleClientEmailLock, releaseCamilleClientEmailLock } = await import(
        "./camilleClientEmailGuard"
      );

      if (!(await acquireCamilleClientEmailLock(dossier.id))) continue;

      try {
        const ok = await tryHandleCamilleReviewStaffEmailReply(dossier, instruction || text, db.dossiers);
        if (ok) {
          helpers.markProcessed(dossier, msgMeta.id);
          processedIds.add(msgMeta.id);
          handled += 1;
          const { writeDB } = await import("./db");
          await writeDB(db, dossier);
          console.log(`[Camille] Validation email traitée — ${dossier.id} (${senderEmail})`);
        }
      } catch (err: any) {
        console.error(`[Camille] Review email ${dossier.id}:`, err?.message || err);
      } finally {
        await releaseCamilleClientEmailLock(dossier.id);
      }
    }
  }

  return handled;
}
