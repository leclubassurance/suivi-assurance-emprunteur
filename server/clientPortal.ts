import crypto from "crypto";
import type { Dossier } from "./dossierModel";
import { computeDocumentChecklist } from "../shared/documentChecklist";
import { buildCamilleContextBlock } from "./camilleMail";
import { assessCertainLoanDocProblems } from "./loanDocCertainty";

export function ensureClientPortalToken(dossier: Dossier): string {
  const existing = (dossier as any).clientPortal?.token;
  if (existing && String(existing).length >= 24) return String(existing);

  const token = crypto.randomBytes(24).toString("hex");
  (dossier as any).clientPortal = {
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
  return (
    dossiers.find((d) => String((d as any).clientPortal?.token || "") === t) || null
  );
}

const STATUS_CLIENT: Record<string, { label: string; description: string }> = {
  NOUVEAU: {
    label: "Demande reçue",
    description: "Votre dossier est enregistré. Notre équipe prépare votre étude.",
  },
  EN_COURS: {
    label: "Étude en cours",
    description: "Nous analysons votre dossier. Vous serez contacté par email si besoin.",
  },
  EN_ATTENTE_CLIENT: {
    label: "En attente de votre retour",
    description: "Un email vous a été envoyé — merci de répondre ou d'envoyer les éléments demandés.",
  },
  "MAIL_ENVOYÉ": {
    label: "Étude envoyée",
    description: "Consultez votre boîte mail pour notre proposition personnalisée.",
  },
  MAIL_ENVOYE: {
    label: "Étude envoyée",
    description: "Consultez votre boîte mail pour notre proposition personnalisée.",
  },
  TRAITÉ: {
    label: "Dossier traité",
    description: "Votre demande a été finalisée. Pour toute question, répondez à nos emails.",
  },
  TRAITE: {
    label: "Dossier traité",
    description: "Votre demande a été finalisée. Pour toute question, répondez à nos emails.",
  },
  REFUSÉ: {
    label: "Sans suite",
    description: "Ce dossier est clos. Contactez-nous si vous souhaitez rouvrir une demande.",
  },
  CLOS: {
    label: "Clos",
    description: "Ce dossier est archivé.",
  },
};

export function buildClientPortalView(dossier: Dossier) {
  const a = dossier.formData?.assures?.[0];
  const prenom = a?.prenom || "Bonjour";
  const checklist = computeDocumentChecklist(dossier.formData?.documents || []);
  const ctx = buildCamilleContextBlock(dossier);
  const docProb = assessCertainLoanDocProblems(dossier);

  const steps = [
    { key: "received", label: "Demande reçue", done: true },
    {
      key: "docs",
      label: "Documents prêt reçus",
      done: ctx.loanDocsOk,
      hint: ctx.loanDocsOk
        ? "Offre et tableau d'amortissement OK"
        : "Merci d'envoyer l'offre et le tableau complets en PDF depuis votre espace bancaire",
    },
    {
      key: "study",
      label: "Étude des économies",
      done: Boolean(dossier.studyDraft) || dossier.status === "MAIL_ENVOYÉ" || dossier.status === "TRAITÉ",
    },
    {
      key: "done",
      label: "Proposition envoyée",
      done: ["MAIL_ENVOYÉ", "MAIL_ENVOYE", "TRAITÉ", "TRAITE", "CLOS"].includes(String(dossier.status)),
    },
  ];

  const documents = checklist
    .filter((c) => c.key === "offre" || c.key === "amort" || c.key === "cni" || c.key === "rib")
    .map((c) => ({
      key: c.key,
      label: c.label,
      received: c.ok,
      requiredNow: c.key === "offre" || c.key === "amort" || (docProb.certain && (c.key === "offre" || c.key === "amort")),
    }));

  const statusKey = String(dossier.status || "NOUVEAU");
  const statusInfo = STATUS_CLIENT[statusKey] || {
    label: statusKey,
    description: "Suivi en cours.",
  };

  const tips: string[] = [];
  if (docProb.certain) {
    tips.push(
      "Pour accélérer votre dossier, renvoyez l'offre de prêt et le tableau d'amortissement en PDF téléchargés depuis votre banque (évitez les captures d'écran).",
    );
  }
  if (!ctx.loanDocsOk) {
    tips.push("Les documents indispensables sont l'offre de prêt et le tableau d'amortissement au format PDF.");
  }
  tips.push(
    "Pour toute question, répondez aux emails envoyés par Le Club Immobilier Français : notre équipe vous accompagne personnellement.",
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
