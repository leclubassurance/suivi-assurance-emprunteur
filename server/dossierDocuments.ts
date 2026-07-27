import fs from "fs";
import path from "path";
import type { Express } from "express";
import { addEvent, type Dossier } from "./dossierModel";
import { classifyFileName, inferDocumentCategory } from "../shared/documentClassifier";

export type AddedDossierDocument = {
  id: string;
  category: string;
  name: string;
  size: number;
  type: string;
  localPath: string;
  source: string;
  uploadedAt: string;
  driveFileId?: string;
  driveLink?: string;
};

const DRIVE_UPLOAD_TIMEOUT_MS = 20_000;
const LOAN_ANALYZE_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_timeout_${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function addFileToDossier(
  dossier: Dossier,
  file: Express.Multer.File,
  options: {
    uploadsDir: string;
    category?: string;
    source?: string;
    driveAccessToken?: string | null;
    /** Si false, pas d'analyse offre/tableau (évite blocage OCR). Défaut true avec timeout. */
    analyzeLoan?: boolean;
  },
): Promise<AddedDossierDocument> {
  if (!dossier.formData) dossier.formData = {};
  if (!Array.isArray(dossier.formData.documents)) dossier.formData.documents = [];

  const inferred = classifyFileName(file.originalname);
  let category = String(options.category || "").trim().toLowerCase();
  if (!category || category === "auto") {
    category = inferred || "autre";
  }

  const doc: AddedDossierDocument = {
    id: `${category}-${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    category,
    name: file.originalname,
    size: file.size,
    type: file.mimetype,
    localPath: file.path,
    source: options.source || "admin",
    uploadedAt: new Date().toISOString(),
  };

  const dossierDir = path.join(options.uploadsDir, dossier.id);
  if (!fs.existsSync(dossierDir)) fs.mkdirSync(dossierDir, { recursive: true });
  const base = path.basename(doc.localPath);
  const nextPath = path.join(dossierDir, base);
  if (doc.localPath !== nextPath && fs.existsSync(doc.localPath)) {
    fs.renameSync(doc.localPath, nextPath);
    doc.localPath = nextPath;
  }

  if (dossier.workspaceFolderId && options.driveAccessToken) {
    try {
      const { uploadBufferToDriveFolder } = await import("./gmailDriveUpload");
      const buf = fs.readFileSync(doc.localPath);
      const uploaded = await withTimeout(
        uploadBufferToDriveFolder(
          dossier.workspaceFolderId,
          doc.name,
          doc.type || "application/octet-stream",
          buf,
          options.driveAccessToken,
        ),
        DRIVE_UPLOAD_TIMEOUT_MS,
        "drive_upload",
      );
      if (uploaded) {
        doc.driveFileId = uploaded.fileId;
        doc.driveLink = uploaded.webViewLink || undefined;
      }
    } catch (err: any) {
      console.warn(
        `[addFileToDossier] Drive upload skip (${doc.name}):`,
        err?.message || err,
      );
    }
  }

  const shouldAnalyze = options.analyzeLoan !== false;
  const { isLoanPdfOrImage } = await import("./documentPdfSignals");
  if (
    shouldAnalyze &&
    (category === "offre" || category === "tableau") &&
    isLoanPdfOrImage(doc.name, doc.type)
  ) {
    try {
      const { analyzeLoanPdf } = await import("./documentPdfSignals");
      const sig = await withTimeout(
        analyzeLoanPdf(doc.localPath, category as "offre" | "tableau", {
          mimeType: doc.type,
        }),
        LOAN_ANALYZE_TIMEOUT_MS,
        "loan_analyze",
      );
      (doc as any).loanSignal = sig;
      if (!(doc as any).quality) {
        (doc as any).quality = { ok: sig.ok, reasons: sig.reasons || [] };
      } else if (!sig.ok) {
        (doc as any).quality.ok = false;
        (doc as any).quality.reasons = [
          ...new Set([...((doc as any).quality.reasons || []), ...(sig.reasons || [])]),
        ];
      }
    } catch (err: any) {
      console.warn(
        `[addFileToDossier] Analyse prêt skip (${doc.name}):`,
        err?.message || err,
      );
      (doc as any).quality = {
        ok: true,
        reasons: ["Analyse différée (timeout) — document quand même enregistré"],
      };
    }
  }

  dossier.formData.documents.push(doc);

  addEvent(dossier, {
    type: "DOCUMENT_UPLOADED",
    actor: { kind: "ADMIN", label: "Rémi" },
    message: `Document ajouté : ${doc.name} (${category})`,
    meta: {
      docId: doc.id,
      category,
      drive: Boolean(doc.driveLink),
    },
  });

  return doc;
}

export function resolveUploadCategory(fileName: string, requested?: string): string {
  const r = String(requested || "auto").trim().toLowerCase();
  if (r && r !== "auto") return r;
  return classifyFileName(fileName) || inferDocumentCategory({ name: fileName }) || "autre";
}
