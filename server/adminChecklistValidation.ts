import { inferDocumentCategory } from "../shared/documentClassifier";
import { enrichLoanDocSignal } from "../shared/loanDocAnalysis";
import { addEvent, type Dossier } from "./dossierModel";
import type { AdminChecklistOverride } from "../shared/adminDocValidation";

const VALID_KEYS = new Set(["cni", "rib", "offre", "amort"]);

export function isValidChecklistKey(key: string): boolean {
  return VALID_KEYS.has(key);
}

function loanCategoryForKey(key: string): "offre" | "tableau" | null {
  if (key === "offre") return "offre";
  if (key === "amort") return "tableau";
  return null;
}

/** Met à jour les signaux OCR pour que l'admin et Camille voient le document comme validé. */
export function patchDocumentsAfterAdminValidation(dossier: Dossier, key: string) {
  const docs = (dossier.formData?.documents || []) as any[];
  const loanCat = loanCategoryForKey(key);
  const identityCat = key === "cni" ? "cni" : key === "rib" ? "rib" : null;

  for (const doc of docs) {
    const cat = inferDocumentCategory(doc);
    const matches =
      (loanCat && (cat === loanCat || (loanCat === "offre" && cat === "fiche"))) ||
      (identityCat && cat === identityCat);
    if (!matches) continue;

    if (loanCat) {
      doc.loanSignal = enrichLoanDocSignal(
        {
          ok: true,
          kind: loanCat,
          reasons: ["Validé manuellement par l'équipe"],
          keywords: doc.loanSignal?.keywords || [],
          textSource: doc.loanSignal?.textSource || "pdf_native",
          extractedChars: doc.loanSignal?.extractedChars ?? 200,
          ocrUsed: doc.loanSignal?.ocrUsed,
        },
        loanCat,
        { fileName: doc.name },
      );
    }
    if (!doc.quality) doc.quality = { ok: true, reasons: [] };
    else doc.quality = { ...doc.quality, ok: true, reasons: [] };
  }
}

export function setAdminChecklistOverride(
  dossier: Dossier,
  key: string,
  override: AdminChecklistOverride | null,
  meta?: { author?: string },
) {
  if (!isValidChecklistKey(key)) {
    throw new Error(`Clé checklist invalide: ${key}`);
  }

  if (!dossier.adminChecklistOverrides) {
    dossier.adminChecklistOverrides = {};
  }

  if (!override) {
    delete dossier.adminChecklistOverrides[key];
  } else {
    dossier.adminChecklistOverrides[key] = override;
  }

  if (override?.status === "ok") {
    patchDocumentsAfterAdminValidation(dossier, key);
    addEvent(dossier, {
      type: "AI_DECISION",
      actor: { kind: "ADMIN", label: meta?.author || "Admin" },
      message: `Document « ${key} » validé manuellement.`,
      meta: { checklistKey: key, validatedAt: override.validatedAt },
    });
  } else if (override === null) {
    addEvent(dossier, {
      type: "AI_DECISION",
      actor: { kind: "ADMIN", label: meta?.author || "Admin" },
      message: `Validation manuelle retirée pour « ${key} ».`,
      meta: { checklistKey: key },
    });
  }

  dossier.updatedAt = new Date().toISOString();
}
