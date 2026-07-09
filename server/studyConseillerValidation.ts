import type { Dossier } from "./dossierModel";
import { addEvent } from "./dossierModel";
import { findApporteurById } from "./apporteurStore";
import { isConseillerImmoClubType } from "../shared/conseillerImmoClub";
import { formatApporteurDisplayName } from "../shared/apporteurProfile";
import {
  computeBrokerageFeeEur,
  getRemunerationConfig,
  type RemunerationConfig,
} from "../shared/apporteurRemuneration";
import { countAssuredFromDossier } from "../shared/apporteurCommissionFromDossier";
import { parseEuroToken } from "./studyEmailKpi";
import { hasBrokerageFeeLine, patchStudyHtmlBrokerageFee } from "./studyHtmlPatch";
import { sendApporteurHtmlEmail } from "./apporteurNotify";
import { resolvePublicAppBaseUrl } from "./clientPortal";

export type StudyConseillerValidation = {
  status: "pending" | "approved" | "cancelled";
  submittedAt: string;
  submittedBy?: string;
  subject: string;
  html: string;
  grossSavingsEur?: number;
  feesAssureurEur?: number;
  assuredCount: number;
  suggestedFeePerAssuredEur: number;
  feesPerAssuredEur?: number;
  feesCourtageTotalEur?: number;
  conseillerRetroEur?: number;
  approvedAt?: string;
  approvedBy?: string;
  /** @deprecated Ne plus utiliser — l'envoi client est manuel depuis l'admin. */
  sentAt?: string;
  /** Note contexte visible par le conseiller (débrief admin). */
  debriefNote?: string;
};

export type StudyValidationContext = {
  grossSavingsEur: number | null;
  feesAssureurEur: number | null;
  assuredCount: number;
  suggestedFeePerAssuredEur: number;
};

function decodeHtmlEntities(s: string): string {
  return String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripHtml(html: string): string {
  return decodeHtmlEntities(html)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstAmountAfter(labelRe: RegExp, blob: string, windowChars = 140): number | null {
  const m = blob.match(labelRe);
  if (!m || m.index == null) return null;
  const tail = blob.slice(m.index + m[0].length, m.index + m[0].length + windowChars);
  const amt = tail.match(/(\d{1,3}(?:[\s\u00a0.]\d{3})*(?:[,.]\d{2})?)\s*€/);
  return amt ? parseEuroToken(amt[1]) : null;
}

/** Extraction légère depuis HTML manuel (sans exiger objet « étude »). */
export function extractStudyValidationContext(
  html: string,
  dossier: Dossier,
): StudyValidationContext {
  const raw = decodeHtmlEntities(String(html || ""));
  const blob = stripHtml(raw);
  const assuredCount = countAssuredFromDossier(dossier, 1);

  let gross: number | null = null;
  const tablePatterns = [
    /<td[^>]*>\s*[ÉE]conomie\s*<\/td>\s*<td[^>]*>\s*([^<]+)\s*<\/td>/i,
    /<td[^>]*>\s*[ÉE]conomie brute\s*<\/td>\s*<td[^>]*>\s*([^<]+)\s*<\/td>/i,
  ];
  for (const re of tablePatterns) {
    const m = raw.match(re);
    if (m?.[1]) {
      const n = parseEuroToken(m[1]);
      if (n != null && n > 0) {
        gross = n;
        break;
      }
    }
  }
  if (gross == null) {
    const hero = raw.match(
      /[ÉE]conomie potentielle[\s\S]{0,400}?font-size:\s*(?:2[4-9]|3[0-9])px[\s\S]{0,120}?>([^<]+)</i,
    );
    if (hero?.[1]) gross = parseEuroToken(hero[1]);
  }
  if (gross == null) {
    gross =
      firstAmountAfter(/[ée]conomie potentielle/i, blob, 80) ??
      firstAmountAfter(/[ée]conomie brute/i, blob, 80) ??
      firstAmountAfter(/[ée]conomie\s+g[ée]n[ée]r[ée]e/i, blob, 80);
  }

  const feesAssureur =
    firstAmountAfter(/frais de dossier de la nouvelle assurance/i, blob) ??
    firstAmountAfter(/frais de dossier/i, blob);

  const config = getRemunerationConfig("conseiller_immo_club");
  const yearsHint = 15;
  const annualSavings = gross != null && gross > 0 ? gross / yearsHint : config.defaultAnnualSavingsEur;
  const suggestedFeePerAssuredEur = Math.round(
    computeBrokerageFeeEur({
      annualSavingsEur: annualSavings,
      assuredCount: 1,
      config,
    }),
  );

  return {
    grossSavingsEur: gross,
    feesAssureurEur: feesAssureur,
    assuredCount,
    suggestedFeePerAssuredEur,
  };
}

export async function resolveDossierConseillerApporteur(dossier: Dossier) {
  const apporteurId = String(dossier.apporteur?.apporteurId || "").trim();
  if (!apporteurId) return null;
  const apporteur = await findApporteurById(apporteurId);
  if (!apporteur || !isConseillerImmoClubType(apporteur.type)) return null;
  return apporteur;
}

export async function dossierRequiresConseillerStudyValidation(dossier: Dossier): Promise<boolean> {
  return Boolean(await resolveDossierConseillerApporteur(dossier));
}

/** Bloque l'envoi admin tant que le courtage n'est pas validé par le conseiller. */
export async function getConseillerStudySendGate(
  dossier: Dossier,
): Promise<{ blocked: boolean; reason?: string }> {
  if (!(await dossierRequiresConseillerStudyValidation(dossier))) {
    return { blocked: false };
  }
  const v = dossier.studyConseillerValidation;
  if (v?.status === "pending") {
    return {
      blocked: true,
      reason: "En attente de validation du courtage par le conseiller.",
    };
  }
  if (v?.status === "approved") {
    return { blocked: false };
  }
  const { hasStudyBeenSent } = await import("./dossierLifecycle");
  if (hasStudyBeenSent(dossier)) {
    return { blocked: false };
  }
  return {
    blocked: true,
    reason:
      "Soumettez d'abord le débrief au conseiller pour validation du courtage, puis envoyez l'étude après sa validation.",
  };
}

export function validateFeesPerAssuredEur(
  feesPerAssuredEur: number,
  config: Pick<RemunerationConfig, "minPerAssuredEur" | "maxPerAssuredEur">,
): { ok: true } | { ok: false; error: string } {
  const n = Number(feesPerAssuredEur);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: "Montant de courtage invalide." };
  }
  if (n > 0 && n < config.minPerAssuredEur) {
    return {
      ok: false,
      error: `Minimum barème : ${config.minPerAssuredEur} € par assuré (ou 0 € sans courtage).`,
    };
  }
  if (n > config.maxPerAssuredEur) {
    return { ok: false, error: `Maximum barème : ${config.maxPerAssuredEur} € par assuré.` };
  }
  return { ok: true };
}

export function buildStudyValidationSummaryForPortal(
  validation: StudyConseillerValidation,
  config: RemunerationConfig,
) {
  const feesPerAssured =
    validation.feesPerAssuredEur ?? validation.suggestedFeePerAssuredEur;
  const total = feesPerAssured * validation.assuredCount;
  const retro = Math.round(total * config.apporteurShareOfBrokerage);
  return {
    grossSavingsEur: validation.grossSavingsEur ?? null,
    feesAssureurEur: validation.feesAssureurEur ?? null,
    assuredCount: validation.assuredCount,
    feesPerAssuredEur: feesPerAssured,
    feesCourtageTotalEur: total,
    conseillerRetroEur: retro,
    minPerAssuredEur: config.minPerAssuredEur,
    maxPerAssuredEur: config.maxPerAssuredEur,
    payoutSharePercent: config.apporteurShareOfBrokerage,
  };
}

export async function notifyConseillerStudyPending(params: {
  dossier: Dossier;
  apporteur: NonNullable<Awaited<ReturnType<typeof findApporteurById>>>;
  portalToken: string;
  publicBaseUrl: string;
  validation: StudyConseillerValidation;
}): Promise<{ sent: boolean; reason?: string }> {
  const { dossier, apporteur, portalToken, publicBaseUrl, validation } = params;
  if (!apporteur.email?.includes("@")) return { sent: false, reason: "no_email" };

  const prenom = String(
    apporteur.contactPrenom || formatApporteurDisplayName(apporteur).split(" ")[0] || "",
  );
  const clientName = [
    dossier.formData?.assures?.[0]?.prenom,
    dossier.formData?.assures?.[0]?.nom,
  ]
    .filter(Boolean)
    .join(" ");
  const portalUrl = `${publicBaseUrl.replace(/\/$/, "")}/apporteur/${encodeURIComponent(portalToken)}?etude=${encodeURIComponent(dossier.id)}`;

  const grossLine =
    validation.grossSavingsEur != null
      ? `Économie affichée : ${Math.round(validation.grossSavingsEur).toLocaleString("fr-FR")} €`
      : "Économie : à confirmer dans l'étude";

  const subject = `[${dossier.id}] Débrief étude — valider le courtage`;
  const debriefBlock = validation.debriefNote
    ? `<p style="background:#F8FAFC;border-left:4px solid #1E3A8A;padding:12px 16px;margin:16px 0"><strong>Contexte LCIF :</strong><br>${String(validation.debriefNote).replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`
    : "";
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#334155">
    <p>Bonjour ${prenom},</p>
    <p>Un dossier assurance emprunteur est prêt pour validation du <strong>courtage</strong> : <strong>${dossier.id}</strong>${clientName ? ` (${clientName})` : ""}.</p>
    <p>${grossLine}<br>Assurés : <strong>${validation.assuredCount}</strong></p>
    ${debriefBlock}
    <p>Indiquez le montant de courtage adapté à ce client (barème 200–500 € / assuré). L'équipe LCIF enverra ensuite l'étude au client.</p>
    <p style="margin:24px 0"><a href="${portalUrl}" style="display:inline-block;background:#1E3A8A;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Valider le courtage</a></p>
    <p style="font-size:12px;color:#64748b">Le Club Immobilier Français</p>
  </div>`;

  const sent = await sendApporteurHtmlEmail(apporteur.email, subject, html);
  if (!sent) return { sent: false, reason: "send_failed" };
  return { sent: true };
}

export async function notifyAdminStudyCourtageApproved(params: {
  dossier: Dossier;
  apporteur: NonNullable<Awaited<ReturnType<typeof findApporteurById>>>;
  validation: StudyConseillerValidation;
}): Promise<{ sent: boolean }> {
  const { dossier, apporteur, validation } = params;
  const notifyTo = process.env.AI_ESCALATION_EMAIL || "remi@leclubimmobilier.fr";
  const clientName = [
    dossier.formData?.assures?.[0]?.prenom,
    dossier.formData?.assures?.[0]?.nom,
  ]
    .filter(Boolean)
    .join(" ");
  const conseillerName = formatApporteurDisplayName(apporteur);
  const perAssured = validation.feesPerAssuredEur ?? 0;
  const total = validation.feesCourtageTotalEur ?? 0;
  const subject = `[${dossier.id}] Courtage validé — envoyer l'étude au client`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#334155">
    <p><strong>${conseillerName}</strong> a validé le courtage pour le dossier <strong>${dossier.id}</strong>${clientName ? ` (${clientName})` : ""}.</p>
    <ul>
      <li>Courtage : <strong>${perAssured} €</strong> / assuré × ${validation.assuredCount} = <strong>${total} €</strong></li>
      ${validation.grossSavingsEur != null ? `<li>Économie affichée : <strong>${Math.round(validation.grossSavingsEur).toLocaleString("fr-FR")} €</strong></li>` : ""}
      <li>Rétro conseiller (70 %) : <strong>${validation.conseillerRetroEur ?? 0} €</strong></li>
    </ul>
    <p>Mettez à jour la ligne « Frais de courtage » dans votre HTML et envoyez l'étude depuis l'admin.</p>
  </div>`;
  const sent = await sendApporteurHtmlEmail(notifyTo, subject, html);
  return { sent };
}

export async function submitStudyToConseiller(params: {
  dossier: Dossier;
  subject: string;
  html: string;
  submittedBy?: string;
  publicBaseUrl: string;
  debriefNote?: string;
}): Promise<
  | { ok: true; validation: StudyConseillerValidation }
  | { ok: false; error: string }
> {
  const { dossier, subject, html, submittedBy, publicBaseUrl, debriefNote } = params;
  const trimmedHtml = String(html || "").trim();
  const trimmedSubject = String(subject || "").trim();
  if (!trimmedSubject || !trimmedHtml) {
    return { ok: false, error: "Objet et HTML requis." };
  }

  const apporteur = await resolveDossierConseillerApporteur(dossier);
  if (!apporteur) {
    return { ok: false, error: "Ce dossier n'est pas rattaché à un conseiller LCIF." };
  }
  if (!apporteur.portalToken) {
    return { ok: false, error: "Le conseiller n'a pas de lien portail actif." };
  }

  const { hasStudyBeenSent } = await import("./dossierLifecycle");
  if (hasStudyBeenSent(dossier)) {
    return { ok: false, error: "study_already_sent" };
  }
  const existing = dossier.studyConseillerValidation;
  if (existing?.status === "pending") {
    return { ok: false, error: "validation_pending" };
  }
  if (existing?.status === "approved") {
    return { ok: false, error: "validation_already_approved" };
  }

  const ctx = extractStudyValidationContext(trimmedHtml, dossier);
  const now = new Date().toISOString();
  const validation: StudyConseillerValidation = {
    status: "pending",
    submittedAt: now,
    submittedBy,
    subject: trimmedSubject,
    html: trimmedHtml,
    grossSavingsEur: ctx.grossSavingsEur ?? undefined,
    feesAssureurEur: ctx.feesAssureurEur ?? undefined,
    assuredCount: ctx.assuredCount,
    suggestedFeePerAssuredEur: ctx.suggestedFeePerAssuredEur,
    debriefNote: debriefNote?.trim() || undefined,
  };

  (dossier as Dossier & { studyConseillerValidation?: StudyConseillerValidation }).studyConseillerValidation =
    validation;

  dossier.studyDraft = {
    kind: "MANUAL",
    computedAt: now,
    reliability: "MANUAL",
    subject: trimmedSubject,
    html: trimmedHtml,
    economySummary:
      ctx.grossSavingsEur != null
        ? {
            grossSavingsEur: Math.round(ctx.grossSavingsEur),
            feesCourtageEur: 0,
            feesAssureurEur: ctx.feesAssureurEur ?? undefined,
          }
        : undefined,
  };

  addEvent(dossier, {
    type: "NOTE_ADDED",
    actor: { kind: "ADMIN", label: submittedBy || "Admin" },
    message: "Débrief soumis au conseiller pour validation du courtage.",
    meta: {
      template: "STUDY_CONSEILLER_SUBMIT",
      grossSavingsEur: ctx.grossSavingsEur,
      assuredCount: ctx.assuredCount,
    },
  });

  const notify = await notifyConseillerStudyPending({
    dossier,
    apporteur,
    portalToken: apporteur.portalToken,
    publicBaseUrl,
    validation,
  });
  if (!notify.sent) {
    addEvent(dossier, {
      type: "EMAIL_FAILED",
      actor: { kind: "SYSTEM" },
      message: `Notification conseiller non envoyée (${notify.reason || "erreur"}).`,
      meta: { template: "STUDY_CONSEILLER_NOTIFY" },
    });
  }

  return { ok: true, validation };
}

/** Conseiller valide le courtage — pas d'envoi client (admin envoie manuellement). */
export async function approveConseillerStudyCourtage(params: {
  dossier: Dossier;
  apporteur: NonNullable<Awaited<ReturnType<typeof findApporteurById>>>;
  feesPerAssuredEur: number;
  config: RemunerationConfig;
}): Promise<
  | { ok: true; validation: StudyConseillerValidation; total: number }
  | { ok: false; error: string }
> {
  const { dossier, apporteur, feesPerAssuredEur, config } = params;
  const validation = dossier.studyConseillerValidation;
  if (!validation || validation.status !== "pending") {
    return { ok: false, error: "no_pending_validation" };
  }

  const feeCheck = validateFeesPerAssuredEur(feesPerAssuredEur, config);
  if (!feeCheck.ok) return { ok: false, error: feeCheck.error };

  const approved = applyConseillerApprovedFees(validation, feesPerAssuredEur, config);
  const total = approved.feesCourtageTotalEur ?? 0;
  const now = new Date().toISOString();

  dossier.studyConseillerValidation = {
    ...approved,
    status: "approved",
    approvedAt: now,
    approvedBy: apporteur.email || apporteur.id,
  };
  if (dossier.studyDraft?.economySummary) {
    dossier.studyDraft.economySummary.feesCourtageEur = total;
  }

  addEvent(dossier, {
    type: "NOTE_ADDED",
    actor: { kind: "APPORTEUR", label: apporteur.companyName || "Conseiller" },
    message: `Courtage validé par le conseiller : ${feesPerAssuredEur} €/assuré (${total} € total). Envoi étude à faire par l'admin.`,
    meta: {
      template: "STUDY_CONSEILLER_APPROVED",
      feesPerAssuredEur,
      feesCourtageTotalEur: total,
      conseillerRetroEur: approved.conseillerRetroEur,
    },
  });

  await notifyAdminStudyCourtageApproved({ dossier, apporteur, validation: dossier.studyConseillerValidation });

  return { ok: true, validation: dossier.studyConseillerValidation, total };
}

export function applyConseillerApprovedFees(
  validation: StudyConseillerValidation,
  feesPerAssuredEur: number,
  config: RemunerationConfig,
): StudyConseillerValidation {
  const total = Math.round(feesPerAssuredEur * validation.assuredCount);
  const retro = Math.round(total * config.apporteurShareOfBrokerage);
  return {
    ...validation,
    feesPerAssuredEur,
    feesCourtageTotalEur: total,
    conseillerRetroEur: retro,
  };
}

export function buildFinalStudyHtmlForSend(
  validation: StudyConseillerValidation,
  feesCourtageTotalEur: number,
): { html: string; patched: boolean } {
  return patchStudyHtmlBrokerageFee(validation.html, feesCourtageTotalEur);
}

export function resolvePublicBaseFromRequest(req: { headers: Record<string, unknown> }): string {
  return resolvePublicAppBaseUrl(
    String(req.headers.origin || req.headers.referer || "").replace(/\/$/, ""),
  );
}
