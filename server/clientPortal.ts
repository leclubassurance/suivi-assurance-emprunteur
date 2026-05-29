import crypto from "crypto";
import type { Dossier } from "./dossierModel";
import { computeDocumentChecklistForDossier } from "../shared/documentChecklist";
import {
  hasStudyBeenSent,
  resolveClientPortalStatusKey,
  getLastStudyOutbound,
} from "./dossierLifecycle";
import {
  isLoanDocsStepComplete,
  loanDocsStepHint,
  resolveLoanDocPresence,
} from "./loanDocPresence";
import { clientHasAcceptedInsuranceChange } from "./insuranceAcceptance";

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
          Consultez à tout moment les étapes de votre dossier (documents reçus, préparation de l'étude, envoi par email).
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

const STATUS_CLIENT: Record<string, { label: string; description: string }> = {
  NOUVEAU: {
    label: "Demande reçue",
    description: "Votre dossier est enregistré. Notre équipe prépare votre étude.",
  },
  EN_COURS: {
    label: "Analyse en cours",
    description:
      "Nous vérifions vos documents de prêt. Vous recevrez un email dès que votre étude personnalisée sera prête.",
  },
  EN_ATTENTE_CLIENT: {
    label: "En attente de votre retour",
    description: "Un email vous a été envoyé — merci de répondre ou d'envoyer les éléments demandés.",
  },
  "MAIL_ENVOYÉ": {
    label: "Étude envoyée par email",
    description:
      "Votre étude personnalisée vous a été transmise par email. Consultez votre boîte de réception (et les spams).",
  },
  TRAITÉ: {
    label: "Dossier finalisé",
    description: "Votre demande a été traitée. Pour toute question, répondez à nos emails.",
  },
};

export function buildClientPortalView(dossier: Dossier) {
  const a = dossier.formData?.assures?.[0];
  const prenom = a?.prenom || "Bonjour";
  const checklist = computeDocumentChecklistForDossier(dossier);
  const loan = resolveLoanDocPresence(dossier);
  const studySent = hasStudyBeenSent(dossier);
  const clientAccepted = clientHasAcceptedInsuranceChange(dossier);
  const lastStudy = getLastStudyOutbound(dossier);
  const statusKey = resolveClientPortalStatusKey(dossier);
  const statusInfo = STATUS_CLIENT[statusKey] || STATUS_CLIENT.EN_COURS;

  const steps = [
    { key: "received", label: "Demande enregistrée", done: true },
    {
      key: "docs",
      label: "Offre de prêt et tableau d'amortissement",
      done: isLoanDocsStepComplete(dossier),
      hint: loanDocsStepHint(dossier),
    },
    {
      key: "study",
      label: "Étude des économies réalisée",
      done: studySent,
      hint: studySent
        ? undefined
        : "Notre équipe prépare votre comparaison d'assurance emprunteur",
    },
    {
      key: "done",
      label: "Étude transmise par email",
      done: studySent,
      hint: lastStudy?.subject ? `Dernier envoi : ${lastStudy.subject}` : undefined,
    },
  ];

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
    lastUpdateLabel: new Date(dossier.updatedAt || dossier.createdAt).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
  };
}
