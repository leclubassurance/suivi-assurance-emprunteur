import fs from "fs";
import path from "path";
import type { Dossier } from "./dossierModel";
import { addEvent } from "./dossierModel";
import { extractDocsByCategories } from "./documentTextForAnalysis";
import { computeAdeStudyEconomics, type AdeStudyComputation } from "./adeStudyCompute";
import { generateAdeStudyPdfBuffer } from "./adeStudyPdfGenerate";
import { ingestStudyPdfForDossier } from "./studyPdfFlow";
import { defaultEffectDateIso } from "./kereisDraftBuild";

export type AdeStudyGenerateResult =
  | {
      ok: true;
      computation: AdeStudyComputation;
      studyDraft: Dossier["studyDraft"];
      studyKpi: Dossier["studyKpi"];
      studyPdf: any;
      parsed: any;
    }
  | {
      ok: false;
      error: string;
      computation?: AdeStudyComputation;
    };

function clientNameFromDossier(dossier: Dossier): string {
  const a = (dossier.formData?.assures || [])[0] || {};
  return [a.prenom, a.nom].filter(Boolean).join(" ") || dossier.id;
}

/**
 * Devis + échéancier → calcul → PDF comparatif → ingest KPI (parcours existant).
 */
export async function generateAndIngestAdeStudyForDossier(params: {
  dossier: Dossier;
  uploadsDir: string;
  actorLabel?: string;
}): Promise<AdeStudyGenerateResult> {
  const { dossier, uploadsDir } = params;
  const docs = await extractDocsByCategories(dossier, uploadsDir, ["tableau", "devis", "offre"]);
  const scheduleText = docs.filter((d) => d.category === "tableau").map((d) => d.text).join("\n\n");
  const devisText = docs.filter((d) => d.category === "devis").map((d) => d.text).join("\n\n");

  if (!devisText || devisText.length < 40) {
    return { ok: false, error: "Déposez d'abord le devis assureur (PDF) dans Documents." };
  }
  if (!scheduleText || scheduleText.length < 40) {
    return {
      ok: false,
      error: "Tableau d'amortissement illisible ou manquant — réanalysez les documents.",
    };
  }

  const effectFromKereis = String((dossier as any).kereisDraft?.effectDateIso || "");
  const effectDateIso =
    /^\d{4}-\d{2}-\d{2}$/.test(effectFromKereis) ? effectFromKereis : defaultEffectDateIso();

  const computation = await computeAdeStudyEconomics({
    clientName: clientNameFromDossier(dossier),
    effectDateIso,
    scheduleText,
    devisText,
  });

  if (computation.confidence === "low" || computation.currentTotalEur <= 0 || computation.proposedTotalEur <= 0) {
    return {
      ok: false,
      error:
        "Extraction insuffisante pour générer une étude fiable. Vérifiez le devis et l'échéancier, ou importez un PDF d'étude déjà produit.",
      computation,
    };
  }

  const pdfBuf = await generateAdeStudyPdfBuffer(computation);
  const dossierDir = path.join(uploadsDir, dossier.id);
  if (!fs.existsSync(dossierDir)) fs.mkdirSync(dossierDir, { recursive: true });
  const fileName = `Etude_economies_ADE_${dossier.id}_${Date.now()}.pdf`;
  const filePath = path.join(dossierDir, fileName);
  fs.writeFileSync(filePath, pdfBuf);

  (dossier as any).adeStudyComputation = {
    computedAt: new Date().toISOString(),
    ...computation,
  };

  const ingest = await ingestStudyPdfForDossier({
    dossier,
    filePath,
    originalName: fileName,
    mimeType: "application/pdf",
    size: pdfBuf.length,
    uploadsDir,
    actorLabel: params.actorLabel || "Génération étude ADE",
  });

  if (!ingest.ok) {
    return {
      ok: false,
      error: ingest.error || "PDF généré mais ingest KPI échoué.",
      computation,
    };
  }

  addEvent(dossier, {
    type: "AI_DECISION",
    actor: { kind: "SYSTEM", label: params.actorLabel || "ADE study" },
    message: `Étude PDF générée automatiquement — économie brute ${computation.grossSavingsEur} € (confiance ${computation.confidence}).`,
    meta: {
      template: "ADE_STUDY_GENERATE",
      gross: computation.grossSavingsEur,
      confidence: computation.confidence,
    },
  });

  return {
    ok: true,
    computation,
    studyDraft: dossier.studyDraft,
    studyKpi: dossier.studyKpi,
    studyPdf: (dossier as any).studyPdf,
    parsed: ingest.parsed,
  };
}
