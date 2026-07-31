/**
 * Relances automatiques au conseiller / apporteur après envoi de l'étude,
 * tant que le client n'a pas accepté ni refusé la substitution.
 * Délais courts pour accélérer la signature.
 */
import { addEvent, scheduleTask, type Dossier } from "./dossierModel";
import { hasStudyBeenSent, getLastStudyOutbound, getStudySentAtMs } from "./dossierLifecycle";
import { clientHasAcceptedInsuranceChange } from "./insuranceAcceptance";
import { isArchivedDossier } from "../shared/dossierInactive";
import { LCIF_EMAIL_LOGO_HEADER_IMG } from "../shared/emailBrand";
import { resolvePublicAppBaseUrl } from "./clientPortal";
import { buildApporteurPortalUrl } from "./apporteurNotify";
import { formatApporteurDisplayName } from "../shared/apporteurProfile";
import { isConseillerImmoClubType } from "../shared/conseillerImmoClub";

/** Jours après l'envoi d'étude : 1re / 2e / 3e relance conseiller. */
export const CONSEILLER_DECISION_FOLLOWUP_DAYS = [2, 5, 9] as const;

export const CONSEILLER_DECISION_TASK = "FOLLOWUP_CONSEILLER_DECISION" as const;

function clientLabel(dossier: Dossier): string {
  const a = dossier.formData?.assures?.[0] || {};
  return [a.prenom, a.nom].filter(Boolean).join(" ").trim() || dossier.id;
}

export function cancelConseillerDecisionFollowUps(dossier: Dossier, reason?: string): number {
  let n = 0;
  for (const t of dossier.tasks || []) {
    if (t.type === CONSEILLER_DECISION_TASK && t.status === "PENDING") {
      t.status = "CANCELLED";
      t.lastError = reason || "Décision client connue — relance conseiller annulée.";
      n += 1;
    }
  }
  return n;
}

export function shouldSendConseillerDecisionFollowUp(dossier: Dossier): {
  ok: boolean;
  reason?: string;
} {
  if (isArchivedDossier(dossier)) {
    return { ok: false, reason: "Dossier archivé (refusé / clos)." };
  }
  if (!hasStudyBeenSent(dossier)) {
    return { ok: false, reason: "Étude pas encore envoyée au client." };
  }
  if (clientHasAcceptedInsuranceChange(dossier)) {
    return { ok: false, reason: "Client a déjà accepté la substitution." };
  }
  const status = String(dossier.status || "").toUpperCase();
  if (
    status === "ADHESION_EN_COURS" ||
    status === "TRAITÉ" ||
    status === "TRAITE" ||
    status === "SIGNE"
  ) {
    return { ok: false, reason: `Statut CRM ${dossier.status} — plus d'attente de décision.` };
  }
  const phase = String(dossier.subscriptionProgress?.phase || "");
  if (phase === "decision_received" || phase === "adhesion_space_sent" || phase === "completed") {
    return { ok: false, reason: `Phase souscription ${phase}.` };
  }
  if (!(dossier as any).apporteur?.apporteurId) {
    return { ok: false, reason: "Aucun conseiller / apporteur rattaché." };
  }
  return { ok: true };
}

/**
 * Planifie 3 relances (J+2 / J+5 / J+9) si un conseiller est rattaché et l'étude est partie.
 * Idempotent : n'ajoute pas de doublons PENDING pour le même stage.
 */
export function scheduleConseillerDecisionFollowUps(
  dossier: Dossier,
  options?: { fromMs?: number },
): number {
  const gate = shouldSendConseillerDecisionFollowUp(dossier);
  if (!gate.ok) return 0;

  const fromMs =
    options?.fromMs ??
    getStudySentAtMs(dossier) ??
    new Date(getLastStudyOutbound(dossier)?.date || dossier.updatedAt || Date.now()).getTime();

  if (!Number.isFinite(fromMs) || fromMs <= 0) return 0;

  if (!dossier.tasks) dossier.tasks = [];
  let added = 0;
  for (let i = 0; i < CONSEILLER_DECISION_FOLLOWUP_DAYS.length; i++) {
    const stage = i + 1;
    const days = CONSEILLER_DECISION_FOLLOWUP_DAYS[i];
    const already = dossier.tasks.some(
      (t) =>
        t.type === CONSEILLER_DECISION_TASK &&
        Number(t.payload?.stage) === stage &&
        (t.status === "PENDING" || t.status === "DONE"),
    );
    if (already) continue;
    const dueAt = new Date(fromMs + days * 24 * 3600 * 1000).toISOString();
    scheduleTask(dossier, {
      type: CONSEILLER_DECISION_TASK,
      dueAt,
      payload: { stage, daysAfterStudy: days },
    });
    added += 1;
  }
  return added;
}

/** Rattrapage dossiers déjà en attente de décision (sans tâches planifiées). */
export function ensureConseillerDecisionFollowUps(dossier: Dossier): number {
  const gate = shouldSendConseillerDecisionFollowUp(dossier);
  if (!gate.ok) {
    cancelConseillerDecisionFollowUps(dossier, gate.reason);
    return 0;
  }
  return scheduleConseillerDecisionFollowUps(dossier);
}

export function buildConseillerDecisionFollowUpEmail(params: {
  conseillerPrenom: string;
  clientName: string;
  dossierId: string;
  stage: number;
  portalUrl?: string;
  isConseillerClub: boolean;
}): { subject: string; html: string } {
  const stageHint =
    params.stage >= 3
      ? "Dernière relance automatique de notre côté — un retour rapide nous aide à clôturer le dossier."
      : params.stage === 2
        ? "Deuxième point : sans retour, le dossier reste bloqué côté LCIF."
        : "Petit point rapide après l'envoi de l'étude.";

  const actions = params.isConseillerClub
    ? `<ul style="margin:12px 0;padding-left:18px;color:#374151;font-size:14px;">
        <li>Le client <strong>souhaite le changement</strong> → répondez à ce mail ou indiquez-le dans votre espace.</li>
        <li>Le client a <strong>refusé</strong> → bouton « Client a refusé la substitution » dans votre espace (Archivés).</li>
        <li>Décision en cours → un simple message suffit pour qu'on calibre la suite.</li>
      </ul>`
    : `<p style="font-size:14px;color:#374151;">Merci de nous indiquer par retour de mail si le client souhaite ou non le changement d'assurance.</p>`;

  const portalBlock = params.portalUrl
    ? `<p style="margin:18px 0 0 0;"><a href="${params.portalUrl}" style="display:inline-block;background:#1E3A8A;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;font-size:14px;">Ouvrir mon espace</a></p>`
    : "";

  const html = `
<div style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#F8FAFC;color:#1F2937;line-height:1.6;">
  <div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E5E7EB;">
    <div style="background-color:#1E3A8A;padding:24px 20px;text-align:center;">
      ${LCIF_EMAIL_LOGO_HEADER_IMG}
    </div>
    <div style="padding:24px 22px;">
      <p style="font-size:16px;margin:0 0 14px 0;color:#111827;"><strong>Bonjour ${params.conseillerPrenom},</strong></p>
      <p style="font-size:14px;margin:0 0 12px 0;color:#374151;">
        Concernant votre recommandation <strong>${params.clientName}</strong>
        (dossier <strong>${params.dossierId}</strong>) :
      </p>
      <p style="font-size:14px;margin:0 0 12px 0;padding:12px 16px;background:#FFF7ED;border-radius:8px;color:#9A3412;">
        Nous n'avons toujours <strong>pas de retour client</strong> (acceptation ou refus) suite à l'étude / devis envoyé.
        ${stageHint}
      </p>
      <p style="font-size:14px;margin:0 0 8px 0;color:#374151;">
        N'hésitez pas à nous tenir informés si le client souhaite — ou non — faire le changement :
        votre retour nous permet de signer rapidement ou de clôturer proprement.
      </p>
      ${actions}
      ${portalBlock}
      <p style="font-size:14px;margin:18px 0 0 0;color:#111827;">Bien cordialement,<br/>
        <strong>L'équipe Le Club Immobilier Français</strong>
      </p>
    </div>
    <div style="background:#F8FAFC;padding:16px 22px;border-top:1px solid #E5E7EB;">
      <p style="font-size:11px;margin:0;color:#9CA3AF;">Le Club Immobilier Français — ORIAS 24002253</p>
    </div>
  </div>
</div>`;

  return {
    subject: `[LCIF] Pas de retour client — ${params.clientName} (${params.dossierId})`,
    html,
  };
}

export async function sendConseillerDecisionFollowUp(
  dossier: Dossier,
  stage: number,
): Promise<{ ok: boolean; reason?: string; to?: string }> {
  const gate = shouldSendConseillerDecisionFollowUp(dossier);
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const { findApporteurById } = await import("./apporteurStore");
  const apporteurId = String((dossier as any).apporteur?.apporteurId || "").trim();
  const apporteur = await findApporteurById(apporteurId);
  if (!apporteur) return { ok: false, reason: "Conseiller introuvable." };
  if (apporteur.notifyEmailEnabled === false) {
    return { ok: false, reason: "Notifications email désactivées pour ce partenaire." };
  }
  if (!apporteur.email?.includes("@")) return { ok: false, reason: "Email conseiller manquant." };

  const isClub = isConseillerImmoClubType(apporteur.type);
  const portalUrl = apporteur.portalToken
    ? buildApporteurPortalUrl(resolvePublicAppBaseUrl(), apporteur.portalToken)
    : undefined;
  const prenom =
    String(apporteur.contactPrenom || "").trim() ||
    formatApporteurDisplayName(apporteur).split(/\s+/)[0] ||
    "Bonjour";

  const { subject, html } = buildConseillerDecisionFollowUpEmail({
    conseillerPrenom: prenom,
    clientName: clientLabel(dossier),
    dossierId: dossier.id,
    stage,
    portalUrl,
    isConseillerClub: isClub,
  });

  const { sendEmail } = await import("./emailProvider");
  const result = await sendEmail({ to: apporteur.email, subject, html });
  if (!result.ok) {
    return { ok: false, reason: "error" in result ? result.error : "send_failed", to: apporteur.email };
  }

  addEvent(dossier, {
    type: "EMAIL_SENT",
    actor: { kind: "SYSTEM", label: "Conseiller" },
    message: `Relance décision client → conseiller (${apporteur.email}), étape ${stage}.`,
    meta: {
      template: CONSEILLER_DECISION_TASK,
      stage,
      to: apporteur.email,
      dossierId: dossier.id,
    },
  });

  return { ok: true, to: apporteur.email };
}
