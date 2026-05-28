import crypto from "crypto";
import type { Dossier } from "./dossierModel";
import { computeDocumentChecklist } from "../shared/documentChecklist";
import { buildCamilleContextBlock } from "./camilleMail";
import { assessCertainLoanDocProblems } from "./loanDocCertainty";
import {
  hasStudyBeenSent,
  resolveClientPortalStatusKey,
  getLastStudyOutbound,
} from "./dossierLifecycle";

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

export function getClientPortalAbsoluteUrl(token: string, baseUrl?: string) {
  const base = (baseUrl || process.env.PUBLIC_APP_URL || process.env.RAILWAY_PUBLIC_DOMAIN || "")
    .toString()
    .replace(/\/$/, "");
  if (!base) return getClientPortalPublicPath(token);
  const host = base.startsWith("http") ? base : `https://${base}`;
  return `${host}${getClientPortalPublicPath(token)}`;
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
  const checklist = computeDocumentChecklist(dossier.formData?.documents || []);
  const ctx = buildCamilleContextBlock(dossier);
  const docProb = assessCertainLoanDocProblems(dossier);
  const studySent = hasStudyBeenSent(dossier);
  const lastStudy = getLastStudyOutbound(dossier);
  const statusKey = resolveClientPortalStatusKey(dossier);
  const statusInfo = STATUS_CLIENT[statusKey] || STATUS_CLIENT.EN_COURS;

  const steps = [
    { key: "received", label: "Demande enregistrée", done: true },
    {
      key: "docs",
      label: "Offre de prêt et tableau d'amortissement",
      done: ctx.loanDocsOk && !docProb.certain,
      hint: docProb.certain
        ? "Merci de renvoyer l'offre de prêt et le tableau d'amortissement en PDF complets, téléchargés depuis votre espace client bancaire (évitez les photos et captures d'écran)."
        : ctx.loanDocsOk
          ? "Documents reçus et exploitables"
          : "Merci d'envoyer l'offre de prêt et le tableau d'amortissement en PDF depuis votre banque en ligne",
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

  const documents = checklist
    .filter((c) => c.key === "offre" || c.key === "amort" || c.key === "cni" || c.key === "rib")
    .map((c) => {
      const isLoanDoc = c.key === "offre" || c.key === "amort";
      const received = c.ok && !(docProb.certain && isLoanDoc);
      return {
        key: c.key,
        label: c.label,
        received,
        requiredNow: isLoanDoc && (!c.ok || docProb.certain),
      };
    });

  const tips: string[] = [];
  if (docProb.certain && !studySent) {
    tips.push(
      "Pour avancer, merci de renvoyer l'offre de prêt et le tableau d'amortissement en fichiers PDF complets, téléchargés depuis le site ou l'application de votre banque (pas de photo ni de capture d'écran).",
    );
  } else if (!ctx.loanDocsOk && !studySent) {
    tips.push(
      "Les documents indispensables pour l'étude sont l'offre de prêt et le tableau d'amortissement, au format PDF.",
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
