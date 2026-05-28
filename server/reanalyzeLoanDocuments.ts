import fs from "fs";
import path from "path";
import { addEvent, type Dossier } from "./dossierModel";
import { inferDocumentCategory } from "../shared/documentClassifier";
import { assessDocumentQuality } from "../shared/documentQuality";
import { analyzeLoanPdf, isLoanPdfOrImage } from "./documentPdfSignals";
import { RAILWAY_BUILD_ID } from "./buildInfo";

export type ReanalyzeDocResult = {
  docId: string;
  name: string;
  category: string;
  analyzed: boolean;
  ocrUsed?: boolean;
  ok?: boolean;
  skipReason?: string;
};

export type ReanalyzeDossierResult = {
  dossierId: string;
  documents: ReanalyzeDocResult[];
  analyzedCount: number;
  ocrCount: number;
};

function resolveDocLocalPath(
  dossier: Dossier,
  doc: any,
  uploadsDir: string,
): string | null {
  const candidates: string[] = [];
  if (doc?.localPath && typeof doc.localPath === "string") {
    candidates.push(doc.localPath);
  }
  const base = path.basename(String(doc?.localPath || doc?.name || ""));
  if (base) {
    candidates.push(path.join(uploadsDir, dossier.id, base));
    candidates.push(path.join(uploadsDir, base));
  }
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

export async function reanalyzeDossierLoanDocuments(
  dossier: Dossier,
  uploadsDir: string,
): Promise<ReanalyzeDossierResult> {
  const docs = (dossier.formData?.documents || []) as any[];
  const results: ReanalyzeDocResult[] = [];
  let analyzedCount = 0;
  let ocrCount = 0;

  for (const doc of docs) {
    const category =
      String(doc?.category || "").toLowerCase() ||
      String(inferDocumentCategory(doc) || "");
    const cat =
      category === "fiche" ? "offre" : category === "offre" || category === "tableau" ? category : null;

    if (!cat) {
      results.push({
        docId: String(doc?.id || doc?.name || "?"),
        name: String(doc?.name || "?"),
        category: category || "?",
        analyzed: false,
        skipReason: "not_loan_doc",
      });
      continue;
    }

    if (!isLoanPdfOrImage(doc?.name, doc?.type)) {
      results.push({
        docId: String(doc?.id || doc?.name || "?"),
        name: String(doc?.name || "?"),
        category: cat,
        analyzed: false,
        skipReason: "not_pdf_or_image",
      });
      continue;
    }

    const localPath = resolveDocLocalPath(dossier, doc, uploadsDir);
    if (!localPath) {
      results.push({
        docId: String(doc?.id || doc?.name || "?"),
        name: String(doc?.name || "?"),
        category: cat,
        analyzed: false,
        skipReason: "file_missing_on_server",
      });
      continue;
    }

    doc.localPath = localPath;
    doc.category = cat;

    try {
      const sig = await analyzeLoanPdf(localPath, cat as "offre" | "tableau", {
        mimeType: doc.type,
      });
      doc.loanSignal = sig;
      const q = assessDocumentQuality({
        name: doc.name,
        size: doc.size,
        type: doc.type,
        category: cat,
      });
      if (!sig.ok) {
        q.ok = false;
        q.reasons = [...new Set([...(q.reasons || []), ...(sig.reasons || [])])];
      } else if (sig.ocrUsed) {
        q.reasons = (q.reasons || []).filter(
          (r) => !/capture|photo|inexploitable|sans texte/i.test(r),
        );
        q.ok = q.reasons.length === 0;
        q.confidence = q.ok ? "high" : "medium";
      }
      doc.quality = q;

      analyzedCount += 1;
      if (sig.ocrUsed) ocrCount += 1;

      results.push({
        docId: String(doc?.id || doc?.name || "?"),
        name: String(doc?.name || "?"),
        category: cat,
        analyzed: true,
        ocrUsed: sig.ocrUsed,
        ok: sig.ok,
      });
    } catch (e: any) {
      results.push({
        docId: String(doc?.id || doc?.name || "?"),
        name: String(doc?.name || "?"),
        category: cat,
        analyzed: false,
        skipReason: e?.message || "analyze_error",
      });
    }
  }

  if (analyzedCount > 0) {
    addEvent(dossier, {
      type: "AI_DECISION",
      actor: { kind: "SYSTEM", label: "OCR hybride" },
      message: `Réanalyse documents : ${analyzedCount} fichier(s), dont ${ocrCount} via OCR.`,
      meta: { template: "LOAN_DOC_REANALYZE", analyzedCount, ocrCount },
    });
    dossier.updatedAt = new Date().toISOString();
  }

  return {
    dossierId: dossier.id,
    documents: results,
    analyzedCount,
    ocrCount,
  };
}

export async function reanalyzeAllDossiersLoanDocuments(
  dossiers: Dossier[],
  uploadsDir: string,
  options?: { dossierIds?: string[]; limit?: number },
): Promise<{
  dossiersProcessed: number;
  totalAnalyzed: number;
  totalOcr: number;
  missingFiles: number;
  results: ReanalyzeDossierResult[];
}> {
  let list = dossiers;
  if (options?.dossierIds?.length) {
    const ids = new Set(options.dossierIds);
    list = list.filter((d) => ids.has(d.id));
  }
  const limit = options?.limit && options.limit > 0 ? options.limit : list.length;
  list = list.slice(0, limit);

  const results: ReanalyzeDossierResult[] = [];
  let totalAnalyzed = 0;
  let totalOcr = 0;
  let missingFiles = 0;

  for (const d of list) {
    const r = await reanalyzeDossierLoanDocuments(d, uploadsDir);
    results.push(r);
    totalAnalyzed += r.analyzedCount;
    totalOcr += r.ocrCount;
    missingFiles += r.documents.filter((x) => x.skipReason === "file_missing_on_server").length;
  }

  return {
    dossiersProcessed: list.length,
    totalAnalyzed,
    totalOcr,
    missingFiles,
    results,
  };
}

/** Une fois par build Railway : réanalyse tous les dossiers (OCR hybride). */
export async function runOcrHybridBackfillIfNeeded(
  db: { dossiers: Dossier[] },
  uploadsDir: string,
  dataDir: string,
): Promise<{ ran: boolean; summary?: Awaited<ReturnType<typeof reanalyzeAllDossiersLoanDocuments>> }> {
  const enabled =
    (process.env.OCR_HYBRID_BACKFILL_ON_START || "true").toLowerCase() !== "false";
  if (!enabled) return { ran: false };

  const markerPath = path.join(dataDir, "ocr-hybrid-backfill.json");
  let marker: { buildId?: string } = {};
  try {
    if (fs.existsSync(markerPath)) {
      marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    }
  } catch {
    marker = {};
  }

  if (marker.buildId === RAILWAY_BUILD_ID) {
    return { ran: false };
  }

  console.log(`[OCR hybride] Backfill dossiers existants (build ${RAILWAY_BUILD_ID})…`);
  const summary = await reanalyzeAllDossiersLoanDocuments(db.dossiers || [], uploadsDir);
  try {
    fs.writeFileSync(
      markerPath,
      JSON.stringify({ buildId: RAILWAY_BUILD_ID, at: new Date().toISOString(), summary }),
      "utf8",
    );
  } catch (e: any) {
    console.warn(`[OCR hybride] Impossible d'écrire le marqueur backfill: ${e?.message || e}`);
  }
  console.log(
    `[OCR hybride] Backfill terminé : ${summary.dossiersProcessed} dossiers, ${summary.totalAnalyzed} docs, ${summary.totalOcr} OCR.`,
  );
  return { ran: true, summary };
}
