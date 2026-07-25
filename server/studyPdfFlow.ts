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
import { LCIF_EMAIL_LOGO_HEADER_IMG } from "../shared/emailBrand";

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
  const courtageLabel = courtage.toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const grossNum =
    params.grossSavingsEur != null && Number.isFinite(params.grossSavingsEur)
      ? Math.round(Number(params.grossSavingsEur))
      : null;
  const grossLabel =
    grossNum != null
      ? grossNum.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
      : null;
  const planned = params.plannedChangeDate
    ? new Date(params.plannedChangeDate + "T12:00:00").toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  const subject =
    prenom !== "Bonjour"
      ? `${prenom}, votre étude personnalisée - Assurance Emprunteur`
      : "Votre étude personnalisée - Assurance Emprunteur";

  const economyHero = grossLabel
    ? `<div style="background-color:#EFF6FF;border-left:4px solid #1E3A8A;padding:22px 20px;margin:0 0 22px 0;border-radius:6px;">
      <p style="font-size:12px;margin:0 0 8px 0;color:#1E3A8A;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;">
        Économie brute estimée
      </p>
      <p style="font-size:34px;margin:0 0 6px 0;color:#1E3A8A;font-weight:700;line-height:1.15;">
        ${grossLabel}&nbsp;€
      </p>
      <p style="font-size:13px;margin:0;color:#6B7280;">
        Avant frais — détail complet dans le PDF joint.
      </p>
    </div>`
    : `<div style="background-color:#EFF6FF;border-left:4px solid #1E3A8A;padding:18px 16px;margin:0 0 22px 0;border-radius:6px;">
      <p style="margin:0;color:#1E3A8A;font-weight:700;">Votre étude personnalisée est prête</p>
      <p style="margin:8px 0 0 0;color:#374151;font-size:14px;">Le détail complet se trouve en pièce jointe (PDF).</p>
    </div>`;

  const plannedBlock = planned
    ? `<p style="font-size:14px;margin:0 0 12px 0;color:#1F2937;">Date de changement prévue : <strong>${planned}</strong></p>`
    : "";

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background-color:#F8FAFC;color:#1F2937;line-height:1.6;">
<div style="max-width:640px;margin:0 auto;background-color:#FFFFFF;border:1px solid #E5E7EB;">
  <div style="background-color:#1E3A8A;padding:28px 24px;text-align:center;">
    ${LCIF_EMAIL_LOGO_HEADER_IMG}
    <p style="margin:14px 0 0 0;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.88);">
      Étude d'économies — Assurance emprunteur
    </p>
  </div>

  <div style="padding:32px 28px;">
    <p style="font-size:16px;margin:0 0 16px 0;color:#111827;"><strong>${greeting}</strong></p>
    <p style="font-size:15px;margin:0 0 20px 0;color:#374151;">
      Nous avons finalisé votre <strong>étude d'économies</strong> sur l'assurance emprunteur.
      Les garanties de la solution proposée sont <strong>équivalentes</strong> à votre contrat actuel.
    </p>

    ${economyHero}

    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate;border-spacing:0 10px;margin:0 0 8px 0;">
      <tr>
        <td style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;padding:14px 16px;">
          <p style="margin:0 0 4px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#166534;">Pièce jointe</p>
          <p style="margin:0;font-size:14px;color:#14532D;line-height:1.45;">
            Le détail complet de l'étude est <strong>en pièce jointe (PDF)</strong>.
          </p>
        </td>
      </tr>
      <tr>
        <td style="background:#F8FAFC;border:1px solid #E5E7EB;border-radius:8px;padding:14px 16px;">
          <p style="margin:0 0 4px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#64748B;">Accompagnement</p>
          <p style="margin:0;font-size:14px;color:#1F2937;">
            Frais de courtage : <strong>${courtageLabel}&nbsp;€</strong>
          </p>
          <p style="margin:6px 0 0 0;font-size:12px;color:#6B7280;">
            Pour l'accompagnement de votre dossier de changement d'assurance.
          </p>
        </td>
      </tr>
    </table>

    ${plannedBlock}
    <p style="font-size:14px;margin:0 0 16px 0;color:#374151;">
      Votre banque dispose de 10 jours ouvrés pour accepter, obligation légale, et résilie automatiquement votre contrat actuel.
    </p>

    <div style="background-color:#1E3A8A;border-radius:8px;text-align:center;padding:14px 16px;margin:8px 0 22px 0;">
      <p style="margin:0;color:#FFFFFF;font-weight:700;font-size:15px;">Répondez à ce mail pour donner suite</p>
    </div>

    <p style="font-size:14px;margin:0 0 0 0;color:#374151;">
      Si vous souhaitez avancer, répondez simplement à ce message. Nous resterons à vos côtés jusqu'à la prise d'effet.
    </p>

    <p style="font-size:14px;margin:28px 0 0 0;color:#111827;">Bien cordialement,<br/>
      <strong>Charles Victor</strong><br/>
      <span style="color:#6B7280;">Conseiller en assurance emprunteur</span><br/>
      <span style="color:#6B7280;">Le Club Immobilier Français</span>
    </p>
  </div>

  <div style="background-color:#F8FAFC;padding:18px 28px;border-top:1px solid #E5E7EB;">
    <p style="font-size:11px;margin:0;color:#9CA3AF;line-height:1.5;">
      Le Club Immobilier Français — 17 Passage Leroy, 44000 Nantes<br/>
      N° ORIAS : 24002253 | Courtier en assurance emprunteur, indépendant de tout assureur<br/>
      Cette proposition est établie à titre indicatif et n'a pas de valeur contractuelle.
    </p>
  </div>
</div>
</body>
</html>`;

  return { subject, html };
}
