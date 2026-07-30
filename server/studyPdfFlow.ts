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

import {
  buildStudyClientIntroByTier,
  buildStudyClientSubjectByTier,
} from "../shared/studyEconomyEmailCopy";

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

  const subject = buildStudyClientSubjectByTier({
    clientPrenom: prenom === "Bonjour" ? undefined : prenom,
    grossSavingsEur: grossNum,
  });
  const { introHtml } = buildStudyClientIntroByTier({ grossSavingsEur: grossNum });

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
      ${introHtml}
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
  drivePersisted?: boolean;
  warning?: string;
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

  // Nouvel import : lève le blocage de restauration et retire l'ancien fichier Drive.
  const previousDriveId = studyPdfDriveFileId(dossier);
  unsuppressStudyPdf(dossier);
  if (previousDriveId) {
    try {
      const { trashDriveFile } = await import("./gmailDriveUpload");
      await trashDriveFile(previousDriveId, null);
    } catch {
      /* best-effort */
    }
  }

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
  const drivePersisted = Boolean(uploaded?.driveFileId || (dossier as any).studyPdf?.driveFileId);
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
      drivePersisted,
    },
  });

  return {
    ok: true,
    parsed,
    pdfTextPreview: text.slice(0, 400),
    drivePersisted,
    warning: drivePersisted
      ? undefined
      : "PDF enregistré localement, mais pas encore sur Drive — réimportez si le téléchargement échoue après redémarrage.",
  };
}

export function getStudyPdfPath(dossier: Dossier): string | null {
  const fromDraft = (dossier.studyDraft as any)?.extracted?.pdf?.localPath;
  const fromRoot = (dossier as any).studyPdf?.localPath;
  const p = String(fromRoot || fromDraft || "").trim();
  if (p && fs.existsSync(p)) return p;
  return null;
}

/** Présence logique du PDF (métadonnées), indépendante du disque Railway éphémère. */
export function hasStudyPdfMeta(dossier: Dossier): boolean {
  if (isStudyPdfSuppressed(dossier)) return false;
  if (getStudyPdfPath(dossier)) return true;
  const root = (dossier as any).studyPdf || {};
  const draftPdf = (dossier.studyDraft as any)?.extracted?.pdf || {};
  if (String(root.fileName || draftPdf.fileName || "").trim()) return true;
  if (String(root.driveFileId || draftPdf.driveFileId || "").trim()) return true;
  const docs = (dossier.formData?.documents || []) as any[];
  return docs.some((d) => isStudyDocumentEntry(d));
}

/** Document reconnu comme PDF d'étude (catégorie, source, id ou nom). */
export function isStudyDocumentEntry(doc: any): boolean {
  const cat = String(doc?.category || "").toLowerCase();
  const source = String(doc?.source || "").toLowerCase();
  const id = String(doc?.id || "");
  const name = String(doc?.name || "").toLowerCase();
  if (cat === "etude" || cat === "study") return true;
  if (source === "study_pdf") return true;
  if (id.startsWith("etude-study-pdf")) return true;
  return /etude|étude|economies|économies|ade_study|study.?pdf/.test(name) && name.endsWith(".pdf");
}

/** Après suppression admin : empêche Drive/ADE de ressusciter l'ancien PDF. */
export function isStudyPdfSuppressed(dossier: Dossier): boolean {
  if (dossier.studyPdfSuppressed === true) return true;
  if (String(dossier.studyDraft?.kind || "") === "PDF_UPLOAD_CLEARED") return true;
  if (String(dossier.studyPdfClearedAt || "").trim()) {
    // Suppressé tant qu'aucun nouveau studyPdf n'a été réimporté
    return !dossier.studyPdf?.fileName && !dossier.studyPdf?.driveFileId;
  }
  return false;
}

export function unsuppressStudyPdf(dossier: Dossier) {
  delete dossier.studyPdfSuppressed;
  delete dossier.studyPdfClearedAt;
  if (String(dossier.studyDraft?.kind || "") === "PDF_UPLOAD_CLEARED" && dossier.studyDraft) {
    dossier.studyDraft.kind = "PDF_UPLOAD";
  }
}

/**
 * Efface toute trace du PDF d'étude (meta, docs, validation) et bloque la restauration auto.
 * Optionnellement met à la corbeille les fichiers Drive connus (+ PDF « étude » du dossier Drive).
 */
export async function clearStudyPdfState(
  dossier: Dossier,
  options?: { trashDrive?: boolean },
): Promise<{ trashedDriveIds: string[] }> {
  const driveIds = new Set<string>();
  const rootId = String((dossier as any).studyPdf?.driveFileId || "").trim();
  const draftId = String((dossier.studyDraft as any)?.extracted?.pdf?.driveFileId || "").trim();
  if (rootId) driveIds.add(rootId);
  if (draftId) driveIds.add(draftId);
  for (const d of (dossier.formData?.documents || []) as any[]) {
    if (isStudyDocumentEntry(d) && d?.driveFileId) driveIds.add(String(d.driveFileId).trim());
  }

  const localPath = getStudyPdfPath(dossier);
  if (localPath) {
    try {
      fs.unlinkSync(localPath);
    } catch {
      /* ignore */
    }
  }

  delete (dossier as any).studyPdf;
  if (dossier.studyDraft?.extracted?.pdf) {
    delete (dossier.studyDraft.extracted as any).pdf;
  }
  // Toujours poser un marqueur persisté (même sans studyDraft préalable).
  dossier.studyDraft = {
    ...(dossier.studyDraft || {
      computedAt: new Date().toISOString(),
      reliability: "cleared",
    }),
    kind: "PDF_UPLOAD_CLEARED",
  } as any;
  if (Array.isArray(dossier.formData?.documents)) {
    dossier.formData.documents = dossier.formData.documents.filter(
      (d: any) => !isStudyDocumentEntry(d),
    );
  }
  if (dossier.studyConseillerValidation) {
    delete dossier.studyConseillerValidation.studyPdfFileName;
    if (dossier.studyConseillerValidation.studySource === "pdf") {
      dossier.studyConseillerValidation.studySource = undefined as any;
    }
  }

  dossier.studyPdfSuppressed = true;
  dossier.studyPdfClearedAt = new Date().toISOString();

  const trashedDriveIds: string[] = [];
  if (options?.trashDrive !== false) {
    try {
      const { trashDriveFile, listDriveFilesInFolder } = await import("./gmailDriveUpload");
      const folderId = String((dossier as any).workspaceFolderId || "").trim();
      if (folderId) {
        try {
          const files = await listDriveFilesInFolder(folderId, null);
          for (const f of files.values()) {
            const n = String(f.name || "").toLowerCase();
            if (
              n.endsWith(".pdf") &&
              (/etude|étude|economies|économies|ade_study|study/.test(n) ||
                n.includes(String(dossier.id || "").toLowerCase()))
            ) {
              driveIds.add(String(f.fileId || "").trim());
            }
          }
        } catch (e: any) {
          console.warn("[study-pdf] list Drive for trash skip:", e?.message || e);
        }
      }
      for (const id of driveIds) {
        if (!id) continue;
        const ok = await trashDriveFile(id, null);
        if (ok) trashedDriveIds.push(id);
      }
    } catch (e: any) {
      console.warn("[study-pdf] trash Drive skip:", e?.message || e);
    }
  }

  return { trashedDriveIds };
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

function isStudyDocCandidate(doc: any): boolean {
  return isStudyDocumentEntry(doc);
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
    categoryManual: true,
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
 * Restaure un PDF d'étude **déjà référencé** sur le dossier (disque / driveFileId connu / doc étude).
 * Ne recrée JAMAIS un PDF depuis ADE, ni par recherche floue dans Drive :
 * c'est ce qui produisait les `…_restored_…pdf` après une suppression admin.
 */
export async function ensureStudyPdfLocalFile(
  dossier: Dossier,
  uploadsDir: string,
): Promise<{
  localPath: string | null;
  source?: "disk" | "drive" | "document";
  error?: string;
}> {
  // Suppression admin explicite : ne jamais ressusciter.
  if (isStudyPdfSuppressed(dossier)) {
    return {
      localPath: null,
      error: "PDF d'étude supprimé. Réimportez un nouveau PDF depuis l'admin.",
    };
  }

  // Sans métadonnée / doc étude : rien à restaurer (évite la régénération fantôme).
  if (!hasStudyPdfMeta(dossier)) {
    return {
      localPath: null,
      error:
        "Aucun PDF d'étude sur ce dossier. Générez l'étude ou importez un PDF depuis l'admin.",
    };
  }

  const onDisk = getStudyPdfPath(dossier);
  if (onDisk) return { localPath: onDisk, source: "disk" };

  if (!fs.existsSync(path.join(uploadsDir, dossier.id))) {
    fs.mkdirSync(path.join(uploadsDir, dossier.id), { recursive: true });
  }

  const tryDownloadDriveId = async (
    fileId: string,
    fileName: string,
    source: "drive" | "document",
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

  // 1) driveFileId sur studyPdf / studyDraft
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

  // 2) Documents dossier déjà classés étude (chemin local ou driveFileId connu)
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

  return {
    localPath: null,
    error:
      "PDF d'étude introuvable (fichier local / Drive id). Depuis l'admin : régénérez l'étude (Générer étude depuis devis) ou réimportez le PDF.",
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
