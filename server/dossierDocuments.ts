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

export async function addFileToDossier(
  dossier: Dossier,
  file: Express.Multer.File,
  options: {
    uploadsDir: string;
    category?: string;
    source?: string;
    driveAccessToken?: string | null;
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
      const uploaded = await uploadBufferToDriveFolder(
        dossier.workspaceFolderId,
        doc.name,
        doc.type || "application/octet-stream",
        buf,
        options.driveAccessToken,
      );
      if (uploaded) {
        doc.driveFileId = uploaded.fileId;
        doc.driveLink = uploaded.webViewLink || undefined;
      }
    } catch {
      // Drive best-effort
    }
  }

  const isPdf =
    /\.pdf$/i.test(doc.name) ||
    String(doc.type || "").includes("pdf") ||
    (category === "offre" || category === "tableau");
  if (isPdf && (category === "offre" || category === "tableau")) {
    try {
      const { analyzeLoanPdf } = await import("./documentPdfSignals");
      const sig = await analyzeLoanPdf(doc.localPath, category as "offre" | "tableau");
      (doc as any).loanSignal = sig;
      if (!(doc as any).quality) {
        (doc as any).quality = { ok: sig.ok, reasons: sig.reasons || [] };
      } else if (!sig.ok) {
        (doc as any).quality.ok = false;
        (doc as any).quality.reasons = [
          ...new Set([...((doc as any).quality.reasons || []), ...(sig.reasons || [])]),
        ];
      }
    } catch {
      // ignore analysis errors
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
