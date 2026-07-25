import fs from "fs";
import path from "path";
import type { Dossier } from "./dossierModel";
import { addEvent } from "./dossierModel";
import { extractPdfTextFromBuffer } from "./pdfTextExtract";
import { parseStudyEconomicsFromPdfText } from "../shared/studyPdfEconomicsParse";
import { applyStudyKpiFromStudyDraft } from "./studyEmailKpi";
import { materializeStudyEconomics } from "./materializeStudyEconomics";
import {
  formatInsuranceChangePlanLabel,
  getInsuranceChangePlan,
} from "./insuranceChangePlan";

export type StudyPdfMeta = {
  fileName: string;
  localPath: string;
  size: number;
  uploadedAt: string;
  mimeType?: string;
};

export async function ingestStudyPdfForDossier(params: {
  dossier: Dossier;
  filePath: string;
  originalName: string;
  mimeType?: string;
  size?: number;
  uploadsDir: string;
  actorLabel?: string;
}): Promise<{
  ok: boolean;
  error?: string;
  parsed?: ReturnType<typeof parseStudyEconomicsFromPdfText>;
  pdfTextPreview?: string;
}> {
  const { dossier, uploadsDir } = params;
  if (!fs.existsSync(params.filePath)) {
    return { ok: false, error: "Fichier PDF introuvable après upload." };
  }

  const dossierDir = path.join(uploadsDir, dossier.id);
  if (!fs.existsSync(dossierDir)) fs.mkdirSync(dossierDir, { recursive: true });
  const safeName = String(params.originalName || "etude.pdf")
    .replace(/[^\w.\-àâäéèêëïîôùûüç ]+/gi, "_")
    .slice(0, 120);
  const destName = `etude-${Date.now()}_${safeName.endsWith(".pdf") ? safeName : `${safeName}.pdf`}`;
  const destPath = path.join(dossierDir, destName);
  if (params.filePath !== destPath) {
    fs.renameSync(params.filePath, destPath);
  }

  const buf = fs.readFileSync(destPath);
  const text = await extractPdfTextFromBuffer(buf);
  if (!text || text.length < 40) {
    return { ok: false, error: "Impossible d'extraire le texte du PDF (fichier scanné ou illisible)." };
  }

  const parsed = parseStudyEconomicsFromPdfText(text);
  if (parsed.grossSavingsEur == null) {
    return {
      ok: false,
      error:
        "Économie brute introuvable dans le PDF. Vérifiez qu'il s'agit du modèle d'étude LCIF (ÉCONOMIE BRUTE).",
      parsed,
      pdfTextPreview: text.slice(0, 500),
    };
  }

  const now = new Date().toISOString();
  const pdfMeta: StudyPdfMeta = {
    fileName: params.originalName || destName,
    localPath: destPath,
    size: params.size || buf.length,
    uploadedAt: now,
    mimeType: params.mimeType || "application/pdf",
  };

  const clientName = [dossier.formData?.assures?.[0]?.prenom, dossier.formData?.assures?.[0]?.nom]
    .filter(Boolean)
    .join(" ")
    .trim();
  const defaultSubject = clientName
    ? `${clientName}, votre étude personnalisée - Assurance Emprunteur`
    : `Votre étude personnalisée - Assurance Emprunteur`;

  dossier.studyDraft = {
    kind: "PDF_UPLOAD",
    computedAt: now,
    reliability: parsed.confidence === "high" ? "HIGH" : parsed.confidence === "partial" ? "MEDIUM" : "LOW",
    subject: dossier.studyDraft?.subject || defaultSubject,
    html: dossier.studyDraft?.html || null,
    economySummary: {
      grossSavingsEur: Math.round(parsed.grossSavingsEur),
      feesCourtageEur: dossier.studyDraft?.economySummary?.feesCourtageEur ?? 0,
      feesAssureurEur:
        parsed.feesAssureurEur != null ? Math.round(parsed.feesAssureurEur) : undefined,
      annualPremiumEur:
        parsed.annualPremiumEur != null ? Math.round(parsed.annualPremiumEur) : undefined,
    },
    extracted: {
      source: "study_pdf",
      ...parsed,
      pdf: pdfMeta,
    },
  };

  // Brouillon mail court (PJ PDF) — prêt pour envoi / soumission conseiller.
  if (!String(dossier.studyDraft.html || "").trim()) {
    const built = buildStudyClientEmailHtml({
      clientPrenom: String(dossier.formData?.assures?.[0]?.prenom || "").trim(),
      grossSavingsEur: parsed.grossSavingsEur,
      feesCourtageTotalEur: dossier.studyDraft.economySummary?.feesCourtageEur ?? 0,
      plannedChangeDate: parsed.plannedChangeDate,
    });
    dossier.studyDraft.subject = dossier.studyDraft.subject || built.subject;
    dossier.studyDraft.html = built.html;
  }

  (dossier as any).studyPdf = pdfMeta;

  applyStudyKpiFromStudyDraft(dossier);
  if (dossier.studyKpi && parsed.loanCapitalEur != null && parsed.loanCapitalEur > 0) {
    dossier.studyKpi.loanCapitalEur = Math.round(parsed.loanCapitalEur);
  }
  if (dossier.studyKpi) {
    dossier.studyKpi.confidence =
      parsed.confidence === "high" ? "high" : parsed.confidence === "partial" ? "medium" : "low";
  }

  materializeStudyEconomics(dossier);

  if (parsed.plannedChangeDate) {
    try {
      const existing = getInsuranceChangePlan(dossier);
      if (existing?.source !== "manual") {
        (dossier as any).insuranceChangePlan = {
          plannedDate: parsed.plannedChangeDate,
          source: "study_email",
          updatedAt: now,
          updatedBy: params.actorLabel || "admin_pdf",
        };
        addEvent(dossier, {
          type: "NOTE_ADDED",
          actor: { kind: "SYSTEM" },
          message: `Date de changement prévue extraite du PDF d'étude : ${formatInsuranceChangePlanLabel(parsed.plannedChangeDate)}.`,
          meta: {
            template: "INSURANCE_CHANGE_PLAN_EXTRACTED",
            plannedDate: parsed.plannedChangeDate,
            source: "study_pdf",
          },
        });
      }
    } catch {
      /* non bloquant */
    }
  }

  addEvent(dossier, {
    type: "NOTE_ADDED",
    actor: { kind: "ADMIN", label: params.actorLabel || "Admin" },
    message: `PDF d'étude importé — économie brute ${Math.round(parsed.grossSavingsEur).toLocaleString("fr-FR")} € (KPI mis à jour).`,
    meta: {
      template: "STUDY_PDF_UPLOAD",
      fileName: pdfMeta.fileName,
      grossSavingsEur: parsed.grossSavingsEur,
      feesAssureurEur: parsed.feesAssureurEur,
      annualPremiumEur: parsed.annualPremiumEur,
      loanCapitalEur: parsed.loanCapitalEur,
      plannedChangeDate: parsed.plannedChangeDate,
    },
  });

  return { ok: true, parsed, pdfTextPreview: text.slice(0, 400) };
}

export function getStudyPdfPath(dossier: Dossier): string | null {
  const fromDraft = (dossier.studyDraft as any)?.extracted?.pdf?.localPath;
  const fromRoot = (dossier as any).studyPdf?.localPath;
  const p = String(fromRoot || fromDraft || "").trim();
  if (p && fs.existsSync(p)) return p;
  return null;
}

export function buildStudyClientEmailHtml(params: {
  clientPrenom?: string;
  grossSavingsEur?: number | null;
  feesCourtageTotalEur: number;
  plannedChangeDate?: string | null;
}): { subject: string; html: string } {
  const prenom = String(params.clientPrenom || "").trim() || "Bonjour";
  const greeting = prenom === "Bonjour" ? "Bonjour," : `Bonjour ${prenom},`;
  const courtage = Math.round(Number(params.feesCourtageTotalEur) || 0);
  const gross =
    params.grossSavingsEur != null && Number.isFinite(params.grossSavingsEur)
      ? Math.round(Number(params.grossSavingsEur)).toLocaleString("fr-FR")
      : null;
  const planned = params.plannedChangeDate
    ? new Date(params.plannedChangeDate + "T12:00:00").toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  const subject = prenom !== "Bonjour"
    ? `${prenom}, votre étude personnalisée - Assurance Emprunteur`
    : "Votre étude personnalisée - Assurance Emprunteur";

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#0f172a;max-width:640px">
  <p>${greeting}</p>
  <p>Nous avons finalisé votre <strong>étude d'économies</strong> sur l'assurance emprunteur.${
    gross ? ` L'économie brute estimée s'élève à <strong>${gross}&nbsp;€</strong>.` : ""
  }</p>
  <p>Vous trouverez le détail complet de l'étude <strong>en pièce jointe (PDF)</strong>.</p>
  <p>Pour l'accompagnement sur votre dossier de changement d'assurance, nos frais de courtage s'élèvent à <strong>${courtage.toLocaleString("fr-FR")}&nbsp;€</strong>.</p>
  ${
    planned
      ? `<p>Date de changement envisagée : <strong>${planned}</strong>. Votre banque dispose de 10 jours ouvrés pour accepter, obligation légale, et résilie automatiquement votre contrat actuel.</p>`
      : `<p>Votre banque dispose de 10 jours ouvrés pour accepter, obligation légale, et résilie automatiquement votre contrat actuel.</p>`
  }
  <p>Si vous souhaitez donner suite, répondez simplement à ce mail. Nous resterons à vos côtés jusqu'à la prise d'effet.</p>
  <p style="margin-top:24px">Bien cordialement,<br/><strong>Charles Victor</strong><br/>Le Club Immobilier Français · ORIAS 24002253</p>
</div>`;

  return { subject, html };
}
