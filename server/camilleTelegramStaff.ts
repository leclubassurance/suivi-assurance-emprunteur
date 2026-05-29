import path from "path";
import { readDB, writeDB } from "./db";
import type { Dossier } from "./dossierModel";
import { buildCamilleContextBlock } from "./camilleMail";
import { assessCertainLoanDocProblems } from "./loanDocCertainty";

/** Demande d'extraction OCR / contenu document (équipe Telegram). */
export function looksLikeStaffDocExtractionRequest(text: string): boolean {
  const lower = text.toLowerCase();
  if (
    /\b(extraction|extraire|ocr|données|donnees|informations|contenu|exactement|analys|lire)\b/i.test(
      lower,
    ) &&
    /\b(document|pdf|pi[eè]ce|envoy|fichier|offre|tableau|amortissement|client)\b/i.test(lower)
  ) {
    return true;
  }
  if (
    /\b(quelles? sont les|dis-moi ce qu'il y a|que contient|qu'est-ce qu'il y a)\b/i.test(lower) &&
    /\b(document|pdf|offre|tableau)\b/i.test(lower)
  ) {
    return true;
  }
  return false;
}

function formatMime(doc: any): string {
  const type = String(doc?.type || "").toLowerCase();
  const name = String(doc?.name || "").toLowerCase();
  if (type.includes("pdf") || /\.pdf$/i.test(name)) return "PDF";
  if (type.startsWith("image/") || /\.(png|jpe?g|webp|heic)$/i.test(name)) return "Image";
  return type || "fichier";
}

export async function refreshLoanAnalysisIfNeeded(dossier: Dossier): Promise<Dossier> {
  const docs = (dossier.formData?.documents || []) as any[];
  const loanDocs = docs.filter((d) =>
    ["offre", "tableau", "fiche"].includes(String(d?.category || "").toLowerCase()),
  );
  const needsRefresh = loanDocs.some(
    (d) => !d?.loanSignal || d.loanSignal.extractedChars == null,
  );
  if (!needsRefresh || loanDocs.length === 0) return dossier;

  const uploadsDir = path.join(process.cwd(), "uploads");
  const { reanalyzeDossierLoanDocuments } = await import("./reanalyzeLoanDocuments");
  await reanalyzeDossierLoanDocuments(dossier, uploadsDir);

  const db = await readDB();
  const stored = db.dossiers.find((d) => d.id === dossier.id);
  if (stored) {
    stored.updatedAt = new Date().toISOString();
    await writeDB(db, stored);
    return stored;
  }
  return dossier;
}

/** Réponse factuelle basée sur loanSignal / rapport OCR (pas de LLM). */
export function buildStaffDocExtractionReply(dossier: Dossier): string {
  const ctx = buildCamilleContextBlock(dossier);
  const docProb = assessCertainLoanDocProblems(dossier);
  const docs = (dossier.formData?.documents || []) as any[];
  const loanDocs = docs.filter((d) =>
    ["offre", "tableau", "fiche"].includes(String(d?.category || "").toLowerCase()),
  );

  const lines: string[] = [
    `Extraction OCR — ${dossier.id}`,
    "",
    ctx.documentAnalysisReport || "Aucun rapport OCR enregistré pour ce dossier.",
    "",
    "Détail par fichier :",
  ];

  if (loanDocs.length === 0) {
    lines.push("• Aucune pièce prêt (offre / tableau) enregistrée.");
  }

  for (const doc of loanDocs) {
    const sig = doc.loanSignal;
    const cat = String(doc.category || "?");
    const format = formatMime(doc);
    lines.push("");
    lines.push(`• ${doc.name || doc.id} (${cat}, ${format})`);
    if (sig?.adminLabel) lines.push(`  ${sig.adminLabel}`);
    if (sig?.summary) lines.push(`  ${sig.summary}`);
    if (sig?.extractedChars != null) {
      lines.push(
        `  Lecture : ${sig.extractedChars} caractères — source ${sig.textSource || "?"}${
          sig.ocrUsed ? " (OCR)" : ""
        }`,
      );
    }
    if (sig?.keywords?.length) {
      lines.push(`  Mots-clés : ${sig.keywords.slice(0, 8).join(", ")}`);
    }
    if (!sig) lines.push("  Pas encore analysé (relancez après réception sur Drive).");
  }

  lines.push("");
  lines.push(`Docs prêt exploitables : ${ctx.loanDocsOk ? "oui" : "non"}`);
  if (docProb.certain && docProb.problems.length) {
    lines.push(
      `Points bloquants objectifs : ${docProb.problems.map((p) => `${p.kind} (${p.fileName})`).join("; ")}`,
    );
  } else if (docProb.uncertainSignals.length) {
    lines.push(`Signaux à surveiller : ${docProb.uncertainSignals.join(" | ")}`);
  }

  const pdfCount = loanDocs.filter((d) => formatMime(d) === "PDF").length;
  if (pdfCount > 0 && loanDocs.some((d) => d.loanSignal?.extractedChars)) {
    lines.push("");
    lines.push(
      "Les PDF reçus ont bien été lus (texte natif ou OCR). Ne pas demander au client de « renvoyer en image » si l'extraction ci-dessus est positive.",
    );
  }

  return lines.join("\n").slice(0, 3900);
}
