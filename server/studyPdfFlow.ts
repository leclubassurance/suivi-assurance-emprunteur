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
  /** Persistance Drive (disque Railway éphémère). */
  driveFileId?: string;
  driveLink?: string;
};

export type StudyClientEmailEconomics = {
  clientPrenom?: string;
  grossSavingsEur?: number | null;
  netSavingsEur?: number | null;
  feesCourtageTotalEur: number;
  feesAssureurEur?: number | null;
  currentInsuranceTotalEur?: number | null;
  proposedInsuranceTotalEur?: number | null;
  plannedChangeDate?: string | null;
};

function eurInt(n: number): string {
  return Math.round(n).toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/** Mail type PDF brandé (bandeau navy + logo) — vs ancien plaintext. */
export function isBrandedStudyClientEmailHtml(html: string): boolean {
  const h = String(html || "");
  if (!h.trim()) return false;
  return (
    /background-color:\s*#1E3A8A/i.test(h) &&
    /Économie brute estimée/i.test(h) &&
    /Comment ça marche/i.test(h) &&
    (/cloudinary\.com/i.test(h) || /leclubimmobilier/i.test(h) || /ORIAS/i.test(h))
  );
}

export function buildStudyClientEmailHtml(params: StudyClientEmailEconomics): {
  subject: string;
  html: string;
} {
  const prenom = String(params.clientPrenom || "").trim() || "Bonjour";
  const greeting = prenom === "Bonjour" ? "Bonjour," : `Bonjour ${prenom},`;
  const courtage = Math.round(Number(params.feesCourtageTotalEur) || 0);
  const courtageLabel = eurInt(courtage);
  const grossNum =
    params.grossSavingsEur != null && Number.isFinite(params.grossSavingsEur)
      ? Math.round(Number(params.grossSavingsEur))
      : null;
  const grossLabel = grossNum != null ? eurInt(grossNum) : null;
  const feesAssureur =
    params.feesAssureurEur != null && Number.isFinite(params.feesAssureurEur)
      ? Math.round(Number(params.feesAssureurEur))
      : null;
  const currentTotal =
    params.currentInsuranceTotalEur != null && Number.isFinite(params.currentInsuranceTotalEur)
      ? Math.round(Number(params.currentInsuranceTotalEur))
      : null;
  const proposedTotal =
    params.proposedInsuranceTotalEur != null && Number.isFinite(params.proposedInsuranceTotalEur)
      ? Math.round(Number(params.proposedInsuranceTotalEur))
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

  const comparisonRows =
    currentTotal != null && proposedTotal != null
      ? `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:14px 0 0 0;">
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #DBEAFE;color:#4B5563;">Assurance actuelle (durée restante)</td>
          <td style="padding:10px 0;border-bottom:1px solid #DBEAFE;text-align:right;color:#1F2937;font-weight:600;">${eurInt(currentTotal)}&nbsp;€</td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #DBEAFE;color:#4B5563;">Nouvelle solution (durée restante)</td>
          <td style="padding:10px 0;border-bottom:1px solid #DBEAFE;text-align:right;color:#1F2937;font-weight:600;">${eurInt(proposedTotal)}&nbsp;€</td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:2px solid #1E3A8A;color:#1E3A8A;font-weight:700;">Économie brute</td>
          <td style="padding:10px 0;border-bottom:2px solid #1E3A8A;text-align:right;color:#1E3A8A;font-weight:700;">${grossLabel != null ? `${grossLabel}&nbsp;€` : "—"}</td>
        </tr>
      </table>`
      : "";

  const economyHero = grossLabel
    ? `<div style="background-color:#EFF6FF;border-left:4px solid #1E3A8A;padding:24px 20px;margin:0 0 22px 0;border-radius:8px;">
      <p style="font-size:12px;margin:0 0 8px 0;color:#1E3A8A;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;">
        Économie brute estimée (avant frais)
      </p>
      <p style="font-size:36px;margin:0 0 6px 0;color:#1E3A8A;font-weight:700;line-height:1.1;">
        ${grossLabel}&nbsp;€
      </p>
      <p style="font-size:13px;margin:0;color:#6B7280;font-style:italic;">
        Les frais éventuels (si applicables) sont à déduire une seule fois à la mise en place.
      </p>
      ${comparisonRows}
      <div style="margin-top:14px;font-size:13px;color:#374151;">
        <div style="margin:6px 0;">
          <span style="font-weight:600;">Frais de dossier de la nouvelle assurance :</span>
          <span>${feesAssureur != null ? `${eurInt(feesAssureur)}&nbsp;€` : "selon devis"}</span>
        </div>
        <div style="margin:6px 0;">
          <span style="font-weight:600;">Frais de courtage :</span>
          <strong>${courtageLabel}&nbsp;€</strong>
        </div>
      </div>
    </div>`
    : `<div style="background-color:#EFF6FF;border-left:4px solid #1E3A8A;padding:18px 16px;margin:0 0 22px 0;border-radius:8px;">
      <p style="margin:0;color:#1E3A8A;font-weight:700;">Votre étude personnalisée est prête</p>
      <p style="margin:8px 0 0 0;color:#374151;font-size:14px;">Le détail complet se trouve en pièce jointe (PDF).</p>
      <p style="margin:10px 0 0 0;font-size:14px;color:#1F2937;">Frais de courtage : <strong>${courtageLabel}&nbsp;€</strong></p>
    </div>`;

  const plannedBlock = planned
    ? `<p style="font-size:14px;margin:0 0 12px 0;color:#1F2937;">Date de changement prévue : <strong>${planned}</strong></p>`
    : "";

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background-color:#F8FAFC;color:#1F2937;line-height:1.6;">
<div style="max-width:640px;margin:0 auto;background-color:#FFFFFF;border:1px solid #E5E7EB;">
  <div style="background-color:#1E3A8A;padding:32px 24px;text-align:center;">
    ${LCIF_EMAIL_LOGO_HEADER_IMG}
    <p style="margin:14px 0 0 0;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.88);">
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

    <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-left:4px solid #16A34A;border-radius:8px;padding:16px 16px;margin:0 0 22px 0;">
      <p style="margin:0 0 4px 0;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#166534;">Pièce jointe</p>
      <p style="margin:0;font-size:14px;color:#14532D;line-height:1.5;">
        Le détail complet de l'étude (comparaison, cotisations, garanties) est <strong>en pièce jointe (PDF)</strong>.
      </p>
    </div>

    <h3 style="font-size:17px;margin:0 0 10px 0;color:#1E3A8A;">Comment ça marche</h3>
    <ol style="margin:0 0 18px 18px;padding:0;color:#1F2937;font-size:14px;">
      <li style="margin:6px 0;">Vous confirmez par retour de mail que vous souhaitez activer le changement.</li>
      <li style="margin:6px 0;">Nous constituons et soumettons le dossier à votre banque.</li>
      <li style="margin:6px 0;">Votre banque dispose de 10 jours ouvrés pour accepter, obligation légale, et résilie automatiquement votre contrat actuel.</li>
    </ol>

    ${plannedBlock}

    <div style="background-color:#1E3A8A;border-radius:8px;text-align:center;padding:14px 16px;margin:8px 0 22px 0;">
      <p style="margin:0;color:#FFFFFF;font-weight:700;font-size:15px;">Répondez à ce mail pour donner suite</p>
    </div>

    <p style="font-size:14px;margin:0;color:#374151;">
      Une question ? Répondez à ce message — nous resterons à vos côtés jusqu'à la prise d'effet.
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

/** Reconstruit le mail client brandé depuis les KPI / PDF extraits. */
export function rebuildStudyClientEmailFromDossier(
  dossier: Dossier,
  feesCourtageTotalEur?: number | null,
): { subject: string; html: string } {
  const extracted = (dossier.studyDraft?.extracted || {}) as Record<string, unknown>;
  const summary = dossier.studyDraft?.economySummary;
  const courtage =
    feesCourtageTotalEur != null && Number.isFinite(feesCourtageTotalEur)
      ? Math.round(Number(feesCourtageTotalEur))
      : Math.round(
          Number(
            dossier.studyConseillerValidation?.feesCourtageTotalEur ??
              summary?.feesCourtageEur ??
              0,
          ) || 0,
        );

  let current =
    (extracted.currentInsuranceTotalEur as number | undefined) ?? null;
  let proposed =
    (extracted.proposedInsuranceTotalEur as number | undefined) ?? null;
  const gross =
    summary?.grossSavingsEur ??
    dossier.studyKpi?.grossSavingsEur ??
    (extracted.grossSavingsEur as number | undefined) ??
    null;
  if (
    (proposed == null || !Number.isFinite(proposed)) &&
    current != null &&
    gross != null &&
    Number(current) >= Number(gross)
  ) {
    proposed = Math.round((Number(current) - Number(gross)) * 100) / 100;
  }

  const built = buildStudyClientEmailHtml({
    clientPrenom: String(dossier.formData?.assures?.[0]?.prenom || "").trim(),
    grossSavingsEur: gross,
    netSavingsEur: (extracted.netSavingsEur as number | undefined) ?? null,
    feesCourtageTotalEur: courtage,
    feesAssureurEur:
      summary?.feesAssureurEur ??
      dossier.studyKpi?.feesAssureurEur ??
      (extracted.feesAssureurEur as number | undefined) ??
      null,
    currentInsuranceTotalEur: current,
    proposedInsuranceTotalEur: proposed,
    plannedChangeDate:
      dossier.insuranceChangePlan?.plannedDate ||
      (extracted.plannedChangeDate as string | undefined) ||
      null,
  });
  return built;
}

/**
 * Pour un dossier PDF : force le HTML brandé si absent ou encore en version plaintext.
 * Retourne true si le HTML a été mis à jour.
 */
export function ensureBrandedStudyClientEmail(
  dossier: Dossier,
  feesCourtageTotalEur?: number | null,
): boolean {
  const hasPdf =
    Boolean(getStudyPdfPath(dossier)) ||
    dossier.studyDraft?.kind === "PDF_UPLOAD" ||
    dossier.studyConseillerValidation?.studySource === "pdf";
  if (!hasPdf) return false;

  const current = String(
    dossier.studyDraft?.html || dossier.studyConseillerValidation?.html || "",
  ).trim();
  if (current && isBrandedStudyClientEmailHtml(current) && feesCourtageTotalEur == null) {
    return false;
  }

  const built = rebuildStudyClientEmailFromDossier(dossier, feesCourtageTotalEur);
  if (!dossier.studyDraft) {
    dossier.studyDraft = {
      kind: "PDF_UPLOAD",
      computedAt: new Date().toISOString(),
      reliability: "HIGH",
      subject: built.subject,
      html: built.html,
    };
  } else {
    dossier.studyDraft.subject = dossier.studyDraft.subject || built.subject;
    dossier.studyDraft.html = built.html;
  }
  if (dossier.studyConseillerValidation) {
    dossier.studyConseillerValidation.html = built.html;
    if (!dossier.studyConseillerValidation.subject) {
      dossier.studyConseillerValidation.subject = built.subject;
    }
  }
  return true;
}

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

  (dossier as any).studyPdf = pdfMeta;

  // Persistance Drive + registre documents (évite la perte après redéploiement Railway)
  const uploaded = await persistStudyPdfToDrive(dossier, destPath, pdfMeta.fileName);
  registerStudyPdfAsDocument(dossier, {
    localPath: destPath,
    fileName: pdfMeta.fileName,
    size: pdfMeta.size,
    driveFileId: uploaded?.driveFileId || (dossier as any).studyPdf?.driveFileId,
    driveLink: uploaded?.driveLink || (dossier as any).studyPdf?.driveLink,
  });

  // Toujours régénérer le mail brandé à l'import PDF (écrase l'ancien plaintext).
  const built = rebuildStudyClientEmailFromDossier(dossier);
  dossier.studyDraft.subject = built.subject;
  dossier.studyDraft.html = built.html;

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

function studyPdfDriveFileId(dossier: Dossier): string | null {
  const root = String((dossier as any).studyPdf?.driveFileId || "").trim();
  if (root) return root;
  const fromDraft = String((dossier.studyDraft as any)?.extracted?.pdf?.driveFileId || "").trim();
  return fromDraft || null;
}

function patchStudyPdfMeta(dossier: Dossier, patch: Partial<StudyPdfMeta>) {
  const current = { ...((dossier as any).studyPdf || {}) } as StudyPdfMeta;
  const next = { ...current, ...patch } as StudyPdfMeta;
  (dossier as any).studyPdf = next;
  if (dossier.studyDraft?.extracted?.pdf) {
    (dossier.studyDraft.extracted as any).pdf = {
      ...(dossier.studyDraft.extracted as any).pdf,
      ...patch,
    };
  }
  if (dossier.studyConseillerValidation && patch.fileName) {
    dossier.studyConseillerValidation.studyPdfFileName =
      dossier.studyConseillerValidation.studyPdfFileName || patch.fileName;
  }
}

/** Upload le PDF d'étude vers le dossier Drive du client (crée le workspace si besoin). */
export async function persistStudyPdfToDrive(
  dossier: Dossier,
  localPath: string,
  fileName: string,
): Promise<{ driveFileId?: string; driveLink?: string } | null> {
  if (!localPath || !fs.existsSync(localPath)) return null;
  try {
    const { getServerAccessToken } = await import("./googleOAuthServer");
    const token = await getServerAccessToken().catch(() => null);

    let folderId = String((dossier as any).workspaceFolderId || "").trim();
    if (!folderId) {
      const { exportDossierToGoogleWorkspace } = await import("./googleAutomation");
      const exported = await exportDossierToGoogleWorkspace(dossier, token);
      if (exported.success && exported.folderId) {
        folderId = exported.folderId;
        (dossier as any).workspaceFolderId = folderId;
      }
    }
    if (!folderId) {
      console.warn("[study-pdf] Pas de dossier Drive — PDF non persisté hors disque local.");
      return null;
    }

    const { uploadBufferToDriveFolder } = await import("./gmailDriveUpload");
    const buf = fs.readFileSync(localPath);
    const uploaded = await uploadBufferToDriveFolder(
      folderId,
      fileName || path.basename(localPath),
      "application/pdf",
      buf,
      token,
    );
    if (!uploaded?.fileId) return null;
    patchStudyPdfMeta(dossier, {
      driveFileId: uploaded.fileId,
      driveLink: uploaded.webViewLink || undefined,
    });
    return { driveFileId: uploaded.fileId, driveLink: uploaded.webViewLink || undefined };
  } catch (e: any) {
    console.warn("[study-pdf] Drive upload skip:", e?.message || e);
    return null;
  }
}

/** Enregistre / met à jour le PDF d'étude dans formData.documents (catégorie etude). */
export function registerStudyPdfAsDocument(
  dossier: Dossier,
  meta: { localPath: string; fileName: string; size?: number; driveFileId?: string; driveLink?: string },
) {
  if (!dossier.formData) dossier.formData = {};
  if (!Array.isArray(dossier.formData.documents)) dossier.formData.documents = [];
  const docs = dossier.formData.documents as any[];
  const existingIdx = docs.findIndex(
    (d) =>
      String(d?.category || "").toLowerCase() === "etude" ||
      String(d?.id || "").startsWith("etude-study-pdf"),
  );
  const entry = {
    id: existingIdx >= 0 ? docs[existingIdx].id : `etude-study-pdf-${Date.now()}`,
    category: "etude",
    name: meta.fileName,
    size: meta.size || 0,
    type: "application/pdf",
    localPath: meta.localPath,
    source: "study_pdf",
    uploadedAt: new Date().toISOString(),
    driveFileId: meta.driveFileId || (dossier as any).studyPdf?.driveFileId,
    driveLink: meta.driveLink || (dossier as any).studyPdf?.driveLink,
  };
  if (existingIdx >= 0) docs[existingIdx] = { ...docs[existingIdx], ...entry };
  else docs.push(entry);
}

function isStudyDocCandidate(doc: any): boolean {
  const cat = String(doc?.category || "").toLowerCase();
  const name = String(doc?.name || "").toLowerCase();
  if (cat === "etude" || cat === "study") return true;
  return /etude|étude|economies|économies|ade_study|study.?pdf/.test(name) && name.endsWith(".pdf");
}

function writeRestoredPdf(
  dossier: Dossier,
  uploadsDir: string,
  buf: Buffer,
  fileNameHint: string,
): string {
  const dossierDir = path.join(uploadsDir, dossier.id);
  if (!fs.existsSync(dossierDir)) fs.mkdirSync(dossierDir, { recursive: true });
  const safe =
    String(fileNameHint || `etude-${dossier.id}.pdf`)
      .replace(/[^\w.\-àâäéèêëïîôùûüç ]+/gi, "_")
      .slice(0, 120) || `etude-${dossier.id}.pdf`;
  const dest = path.join(
    dossierDir,
    `restored-${Date.now()}_${safe.endsWith(".pdf") ? safe : `${safe}.pdf`}`,
  );
  fs.writeFileSync(dest, buf);
  return dest;
}

/**
 * Garantit un PDF d'étude local.
 * Chaîne : disque → driveFileId → document « etude » → recherche Drive → régénération ADE.
 */
export async function ensureStudyPdfLocalFile(
  dossier: Dossier,
  uploadsDir: string,
): Promise<{
  localPath: string | null;
  source?: "disk" | "drive" | "document" | "drive_search" | "regenerated";
  error?: string;
}> {
  const onDisk = getStudyPdfPath(dossier);
  if (onDisk) return { localPath: onDisk, source: "disk" };

  const dossierDir = path.join(uploadsDir, dossier.id);
  if (!fs.existsSync(dossierDir)) fs.mkdirSync(dossierDir, { recursive: true });

  const tryDownloadDriveId = async (
    fileId: string,
    fileName: string,
    source: "drive" | "document" | "drive_search",
  ): Promise<{ localPath: string; source: typeof source } | null> => {
    const { downloadDriveFileToBuffer } = await import("./gmailDriveUpload");
    const buf = await downloadDriveFileToBuffer(fileId, null);
    if (!buf?.length) return null;
    const dest = writeRestoredPdf(dossier, uploadsDir, buf, fileName);
    patchStudyPdfMeta(dossier, {
      localPath: dest,
      size: buf.length,
      fileName: (dossier as any).studyPdf?.fileName || fileName,
      mimeType: "application/pdf",
      driveFileId: fileId,
    });
    registerStudyPdfAsDocument(dossier, {
      localPath: dest,
      fileName: (dossier as any).studyPdf?.fileName || fileName,
      size: buf.length,
      driveFileId: fileId,
    });
    return { localPath: dest, source };
  };

  // 1) driveFileId sur studyPdf
  const driveId = studyPdfDriveFileId(dossier);
  if (driveId) {
    try {
      const got = await tryDownloadDriveId(
        driveId,
        String((dossier as any).studyPdf?.fileName || `etude-${dossier.id}.pdf`),
        "drive",
      );
      if (got) return got;
    } catch (e: any) {
      console.warn("[study-pdf] Drive id restore failed:", e?.message || e);
    }
  }

  // 2) Documents dossier (catégorie etude / nom)
  const docs = ((dossier as any).formData?.documents || []) as any[];
  for (const doc of docs.filter(isStudyDocCandidate)) {
    const local = String(doc.localPath || "").trim();
    if (local && fs.existsSync(local)) {
      patchStudyPdfMeta(dossier, {
        localPath: local,
        fileName: doc.name || path.basename(local),
        size: doc.size,
        mimeType: "application/pdf",
        driveFileId: doc.driveFileId,
        driveLink: doc.driveLink,
      });
      return { localPath: local, source: "document" };
    }
    if (doc.driveFileId) {
      try {
        const got = await tryDownloadDriveId(
          String(doc.driveFileId),
          String(doc.name || `etude-${dossier.id}.pdf`),
          "document",
        );
        if (got) return got;
      } catch {
        /* next */
      }
    }
  }

  // 3) Recherche dans le dossier Drive client
  const folderId = String((dossier as any).workspaceFolderId || "").trim();
  if (folderId) {
    try {
      const { listDriveFilesInFolder } = await import("./gmailDriveUpload");
      const files = await listDriveFilesInFolder(folderId, null);
      const studyLike = [...files.values()].filter((f) => {
        const n = String(f.name || "").toLowerCase();
        return (
          n.endsWith(".pdf") &&
          (/etude|étude|economies|économies|ade_study|study/.test(n) ||
            n.includes(String(dossier.id || "").toLowerCase()))
        );
      });
      // Préférer le plus « étude économies »
      studyLike.sort((a, b) => {
        const score = (n: string) =>
          (/etude_economies|étude.?économies|economies_ade/.test(n) ? 2 : 0) +
          (/etude|étude/.test(n) ? 1 : 0);
        return score(String(b.name || "").toLowerCase()) - score(String(a.name || "").toLowerCase());
      });
      for (const f of studyLike) {
        const got = await tryDownloadDriveId(f.fileId, f.name || `etude-${dossier.id}.pdf`, "drive_search");
        if (got) return got;
      }
    } catch (e: any) {
      console.warn("[study-pdf] Drive folder search failed:", e?.message || e);
    }
  }

  // 4) Régénération depuis le calcul ADE stocké
  const comp = (dossier as any).adeStudyComputation;
  if (
    comp &&
    typeof comp.grossSavingsEur === "number" &&
    typeof comp.currentTotalEur === "number" &&
    typeof comp.proposedTotalEur === "number"
  ) {
    try {
      const { generateAdeStudyPdfBuffer } = await import("./adeStudyPdfGenerate");
      const pdfBuf = await generateAdeStudyPdfBuffer(comp);
      const fileName = `Etude_economies_ADE_${dossier.id}_restored_${Date.now()}.pdf`;
      const dest = path.join(dossierDir, fileName);
      fs.writeFileSync(dest, pdfBuf);
      patchStudyPdfMeta(dossier, {
        fileName,
        localPath: dest,
        size: pdfBuf.length,
        uploadedAt: new Date().toISOString(),
        mimeType: "application/pdf",
      });
      const uploaded = await persistStudyPdfToDrive(dossier, dest, fileName);
      registerStudyPdfAsDocument(dossier, {
        localPath: dest,
        fileName,
        size: pdfBuf.length,
        driveFileId: uploaded?.driveFileId,
        driveLink: uploaded?.driveLink,
      });
      return { localPath: dest, source: "regenerated" };
    } catch (e: any) {
      console.warn("[study-pdf] regenerate from computation failed:", e?.message || e);
    }
  }

  // 5) Dernier recours : régénérer toute l'étude ADE depuis tableaux + devis
  const hasDevis = docs.some(
    (d) =>
      String(d?.category || "").toLowerCase() === "devis" || /devis/i.test(String(d?.name || "")),
  );
  const hasTableau = docs.some((d) => String(d?.category || "").toLowerCase() === "tableau");
  if (hasDevis && hasTableau) {
    try {
      const { generateAndIngestAdeStudyForDossier } = await import("./adeStudyPipeline");
      const gen = await generateAndIngestAdeStudyForDossier({
        dossier,
        uploadsDir,
        actorLabel: "Restore PDF étude (auto)",
      });
      if (gen.ok) {
        const pathNow = getStudyPdfPath(dossier);
        if (pathNow) {
          const uploaded = await persistStudyPdfToDrive(
            dossier,
            pathNow,
            String((dossier as any).studyPdf?.fileName || path.basename(pathNow)),
          );
          registerStudyPdfAsDocument(dossier, {
            localPath: pathNow,
            fileName: String((dossier as any).studyPdf?.fileName || path.basename(pathNow)),
            size: (dossier as any).studyPdf?.size,
            driveFileId: uploaded?.driveFileId || (dossier as any).studyPdf?.driveFileId,
            driveLink: uploaded?.driveLink || (dossier as any).studyPdf?.driveLink,
          });
          return { localPath: pathNow, source: "regenerated" };
        }
      } else {
        console.warn("[study-pdf] full ADE restore failed:", gen.error);
      }
    } catch (e: any) {
      console.warn("[study-pdf] full ADE restore exception:", e?.message || e);
    }
  }

  return {
    localPath: null,
    error:
      "PDF d'étude introuvable. Depuis l'admin : régénérez l'étude (Générer étude depuis devis) ou réimportez le PDF, puis renvoyez le débrief au conseiller.",
  };
}

/** Assure PDF local + Drive + entrée documents avant envoi conseiller / téléchargement. */
export async function ensureStudyPdfDurable(
  dossier: Dossier,
  uploadsDir: string,
): Promise<{ ok: true; localPath: string; driveFileId?: string } | { ok: false; error: string }> {
  const ensured = await ensureStudyPdfLocalFile(dossier, uploadsDir);
  if (!ensured.localPath) {
    return { ok: false, error: ensured.error || "PDF d'étude introuvable." };
  }
  let driveFileId = studyPdfDriveFileId(dossier) || undefined;
  if (!driveFileId) {
    const uploaded = await persistStudyPdfToDrive(
      dossier,
      ensured.localPath,
      String((dossier as any).studyPdf?.fileName || path.basename(ensured.localPath)),
    );
    driveFileId = uploaded?.driveFileId;
  }
  registerStudyPdfAsDocument(dossier, {
    localPath: ensured.localPath,
    fileName: String((dossier as any).studyPdf?.fileName || path.basename(ensured.localPath)),
    size: (dossier as any).studyPdf?.size,
    driveFileId,
    driveLink: (dossier as any).studyPdf?.driveLink,
  });
  return { ok: true, localPath: ensured.localPath, driveFileId };
}
