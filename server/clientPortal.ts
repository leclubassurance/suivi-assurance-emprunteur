import crypto from "crypto";
import type { Dossier } from "./dossierModel";
import { computeDocumentChecklistForDossier } from "../shared/documentChecklist";
import { hasStudyBeenSent, getLastStudyOutbound } from "./dossierLifecycle";
import {
  isLoanDocsStepComplete,
  loanDocsStepHint,
  resolveLoanDocPresence,
} from "./loanDocPresence";
import { clientHasAcceptedInsuranceChange } from "./insuranceAcceptance";
import {
  buildClientPortalSteps,
  ensureSubscriptionProgressOnAcceptance,
  resolveClientPortalStatusView,
  resolveEffectiveSubscriptionPhase,
  SUBSCRIPTION_PHASE_OPTIONS,
  type SubscriptionPhase,
} from "./subscriptionProgress";
import {
  formatInsuranceChangePlanLabel,
  getInsuranceChangePlan,
} from "./insuranceChangePlan";

export { SUBSCRIPTION_PHASE_OPTIONS, type SubscriptionPhase, buildClientPortalSteps };

export function ensureClientPortalToken(dossier: Dossier): string {
  const existing = dossier.clientPortal?.token;
  if (existing && String(existing).length >= 24) return String(existing);

  const token = crypto.randomBytes(24).toString("hex");
  dossier.clientPortal = {
    token,
    createdAt: new Date().toISOString(),
  };
  return token;
}

export function getClientPortalPublicPath(token: string) {
  return `/suivi/${token}`;
}

export function resolvePublicAppBaseUrl(fallbackOrigin?: string): string {
  const raw =
    process.env.PUBLIC_APP_URL ||
    process.env.RAILWAY_PUBLIC_DOMAIN ||
    fallbackOrigin ||
    "";
  const base = String(raw).trim().replace(/\/$/, "");
  if (!base) return "";
  return base.startsWith("http") ? base : `https://${base}`;
}

export function getClientPortalAbsoluteUrl(token: string, baseUrl?: string) {
  const base = resolvePublicAppBaseUrl(baseUrl);
  if (!base) return getClientPortalPublicPath(token);
  return `${base}${getClientPortalPublicPath(token)}`;
}

/** Bloc HTML pour le mail de confirmation de dépôt (lien page suivi client). */
export function buildClientPortalEmailCtaHtml(portalUrl: string): string {
  if (!portalUrl.startsWith("http")) return "";

  const safeUrl = portalUrl.replace(/"/g, "&quot;");
  return `
      <div style="margin:0 0 20px 0;padding:16px 18px;background-color:#EFF6FF;border:1px solid #BFDBFE;border-radius:12px;">
        <p style="font-size:14px;margin:0 0 10px 0;color:#1E3A8A;font-weight:600;">
          Suivez l'avancement de votre demande en ligne
        </p>
        <p style="font-size:13px;margin:0 0 14px 0;color:#374151;line-height:1.55;">
          Consultez les étapes de votre dossier : documents, étude des économies, votre décision, puis la finalisation de votre changement d'assurance.
          Ce lien personnel vous est réservé — aucun mot de passe n'est nécessaire.
        </p>
        <a href="${safeUrl}" style="display:inline-block;background-color:#1E3A8A;color:#FFFFFF;font-size:14px;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:10px;">
          Voir l'avancement de mon dossier
        </a>
        <p style="font-size:11px;margin:14px 0 0 0;color:#6B7280;line-height:1.5;word-break:break-all;">
          Lien de suivi : <a href="${safeUrl}" style="color:#1E40AF;text-decoration:underline;">${safeUrl}</a>
        </p>
      </div>`;
}

export function findDossierByPortalToken(dossiers: Dossier[], token: string): Dossier | null {
  const t = String(token || "").trim();
  if (!t) return null;
  return dossiers.find((d) => String(d.clientPortal?.token || "") === t) || null;
}

export function buildClientPortalView(dossier: Dossier) {
  ensureSubscriptionProgressOnAcceptance(dossier);

  const a = dossier.formData?.assures?.[0];
  const prenom = a?.prenom || "Bonjour";
  const checklist = computeDocumentChecklistForDossier(dossier);
  const loan = resolveLoanDocPresence(dossier);
  const studySent = hasStudyBeenSent(dossier);
  const clientAccepted = clientHasAcceptedInsuranceChange(dossier);
  const lastStudy = getLastStudyOutbound(dossier);
  const statusInfo = resolveClientPortalStatusView(dossier);
  const steps = buildClientPortalSteps(dossier);
  const subscriptionPhase = resolveEffectiveSubscriptionPhase(dossier);
  const changePlan = getInsuranceChangePlan(dossier);
  const plannedChangeDateLabel = changePlan
    ? formatInsuranceChangePlanLabel(changePlan.plannedDate)
    : undefined;

  const documents: {
    key: string;
    label: string;
    received: boolean;
    requiredNow: boolean;
  }[] = [];

  for (const c of checklist.filter(
    (x) => x.key === "offre" || x.key === "amort" || x.key === "cni" || x.key === "rib",
  )) {
    const isLoanDoc = c.key === "offre" || c.key === "amort";
    const isIdentityDoc = c.key === "cni" || c.key === "rib";
    const loanFilePresent =
      c.key === "offre" ? loan.offrePresent : c.key === "amort" ? loan.amortPresent : c.ok;
    const slotReceived = isLoanDoc ? loanFilePresent : c.ok;
    const slotRequired =
      (isLoanDoc && !studySent && !loanFilePresent) ||
      (isIdentityDoc && clientAccepted && !c.ok);

    const fileRows = c.files?.length ? c.files : [];
    if (fileRows.length <= 1) {
      documents.push({
        key: c.key,
        label: c.label,
        received: slotReceived,
        requiredNow: slotRequired,
      });
      continue;
    }

    for (let i = 0; i < fileRows.length; i++) {
      const f = fileRows[i];
      const received = f.status === "ok";
      documents.push({
        key: `${c.key}-${f.docId || i}`,
        label: `${c.label} — ${f.name}`,
        received,
        requiredNow: slotRequired && !received,
      });
    }
  }

  const tips: string[] = [];
  if (loan.needsResubmit && loan.docProb.certain) {
    tips.push(
      "Pour avancer, merci de renvoyer l'offre de prêt et le tableau d'amortissement en fichiers PDF complets, téléchargés depuis le site ou l'application de votre banque (pas de photo ni de capture d'écran).",
    );
  } else if (!loan.filesPresent && !studySent) {
    tips.push(
      "Les documents indispensables pour l'étude sont l'offre de prêt et le tableau d'amortissement, au format PDF.",
    );
  } else if (loan.filesPresent && !studySent && isLoanDocsStepComplete(dossier)) {
    tips.push(
      "Nous avons bien reçu votre offre de prêt et votre tableau d'amortissement. Notre équipe finalise l'analyse de votre dossier.",
    );
  }
  if (studySent && lastStudy) {
    tips.push(
      `Votre étude vous a été envoyée par email${lastStudy.date ? ` le ${new Date(lastStudy.date).toLocaleDateString("fr-FR")}` : ""}. Pensez à vérifier vos courriers indésirables.`,
    );
  }
  if (plannedChangeDateLabel && (studySent || clientAccepted)) {
    tips.push(
      `Date prévue du changement d'assurance : ${plannedChangeDateLabel}. Cette date peut être ajustée selon l'avancement de votre souscription et les délais bancaires.`,
    );
  }
  if (studySent && !clientAccepted) {
    tips.push(
      "Pour lancer la substitution de votre assurance, répondez à notre email en indiquant que vous souhaitez activer le changement après lecture de l'étude.",
    );
  }
  if (subscriptionPhase && subscriptionPhase !== "awaiting_decision" && subscriptionPhase !== "completed") {
    tips.push(
      "La suite du dossier se fait sur une plateforme d'adhésion sécurisée : vous recevrez les instructions par email (validation des informations, questionnaire de santé, signatures).",
    );
  }
  tips.push(
    "Pour toute question, répondez directement aux emails du Club Immobilier Français : notre équipe vous accompagne personnellement.",
  );

  return {
    dossierId: dossier.id,
    clientPrenom: prenom,
    status: statusInfo,
    updatedAt: dossier.updatedAt,
    createdAt: dossier.createdAt,
    steps,
    documents,
    tips,
    subscriptionPhase: subscriptionPhase || undefined,
    subscriptionPhaseLabel:
      SUBSCRIPTION_PHASE_OPTIONS.find((o) => o.value === subscriptionPhase)?.label || undefined,
    plannedChangeDate: changePlan?.plannedDate,
    plannedChangeDateLabel,
    lastUpdateLabel: new Date(dossier.updatedAt || dossier.createdAt).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
  };
}
