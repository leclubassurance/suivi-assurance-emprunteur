import fs from "fs";
import path from "path";
import { addEvent, type Dossier } from "./dossierModel";
import { inferDocumentCategory } from "../shared/documentClassifier";
import { assessDocumentQuality } from "../shared/documentQuality";
import { analyzeLoanPdf, isLoanPdfOrImage } from "./documentPdfSignals";
import { ensureDocumentLocalFile } from "./documentFileResolve";
import { RAILWAY_BUILD_ID } from "./buildInfo";

export type ReanalyzeDocResult = {
  docId: string;
  name: string;
  category: string;
  analyzed: boolean;
  ocrUsed?: boolean;
  ok?: boolean;
  skipReason?: string;
  fileSource?: string;
};

export type ReanalyzeDossierResult = {
  dossierId: string;
  documents: ReanalyzeDocResult[];
  analyzedCount: number;
  ocrCount: number;
  driveFetchedCount: number;
};

export async function reanalyzeDossierLoanDocuments(
  dossier: Dossier,
  uploadsDir: string,
): Promise<ReanalyzeDossierResult> {
  const docs = (dossier.formData?.documents || []) as any[];
  const results: ReanalyzeDocResult[] = [];
  let analyzedCount = 0;
  let ocrCount = 0;
  let driveFetchedCount = 0;

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

    const resolved = await ensureDocumentLocalFile(dossier, doc, uploadsDir);
    if (!resolved.localPath) {
      results.push({
        docId: String(doc?.id || doc?.name || "?"),
        name: String(doc?.name || "?"),
        category: cat,
        analyzed: false,
        skipReason: resolved.skipReason || "file_missing_on_server",
      });
      continue;
    }

    if (resolved.source === "drive_id" || resolved.source === "drive_folder") {
      driveFetchedCount += 1;
    }

    doc.localPath = resolved.localPath;
    doc.category = cat;

    try {
      const sig = await analyzeLoanPdf(resolved.localPath, cat as "offre" | "tableau", {
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
        const reasons = [...new Set([...(q.reasons || []), ...(sig.reasons || [])])];
        if (sig.ocrUsed && reasons.some((r) => /sans texte exploitable/i.test(r))) {
          q.reasons = reasons.filter((r) => !/sans texte exploitable/i.test(r));
          if (!q.reasons.length) q.reasons.push("Contenu lu par OCR — type de document à confirmer");
        } else {
          q.reasons = reasons;
        }
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
        fileSource: resolved.source,
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
      message: `Réanalyse documents : ${analyzedCount} fichier(s), ${ocrCount} OCR, ${driveFetchedCount} depuis Drive.`,
      meta: { template: "LOAN_DOC_REANALYZE", analyzedCount, ocrCount, driveFetchedCount },
    });
    dossier.updatedAt = new Date().toISOString();
  }

  return {
    dossierId: dossier.id,
    documents: results,
    analyzedCount,
    ocrCount,
    driveFetchedCount,
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
  totalDriveFetched: number;
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
  let totalDriveFetched = 0;
  let missingFiles = 0;

  for (const d of list) {
    const r = await reanalyzeDossierLoanDocuments(d, uploadsDir);
    results.push(r);
    totalAnalyzed += r.analyzedCount;
    totalOcr += r.ocrCount;
    totalDriveFetched += r.driveFetchedCount;
    const miss = r.documents.filter((x) => !x.analyzed && x.skipReason?.includes("missing"));
    missingFiles += miss.length;
    if (r.analyzedCount === 0 && r.documents.some((x) => x.category === "offre" || x.category === "tableau")) {
      const reasons = r.documents
        .filter((x) => !x.analyzed)
        .map((x) => `${x.name}:${x.skipReason}`)
        .join("; ");
      console.warn(`[OCR hybride] ${d.id} : aucun doc analysé (${reasons || "?"})`);
    }
  }

  return {
    dossiersProcessed: list.length,
    totalAnalyzed,
    totalOcr,
    totalDriveFetched,
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
    `[OCR hybride] Backfill terminé : ${summary.dossiersProcessed} dossiers, ${summary.totalAnalyzed} docs analysés, ${summary.totalOcr} OCR, ${summary.totalDriveFetched} depuis Drive, ${summary.missingFiles} sans fichier.`,
  );
  return { ran: true, summary };
}
