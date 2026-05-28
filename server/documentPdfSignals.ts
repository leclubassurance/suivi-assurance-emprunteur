import fs from "fs";
import * as pdfParse from "pdf-parse";

export type LoanDocSignal = {
  ok: boolean;
  kind: "offre" | "tableau" | "unknown";
  reasons: string[];
  keywords: string[];
};

function norm(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // strip accents
}

function findKeywords(text: string, words: string[]) {
  const t = norm(text);
  return words.filter((w) => t.includes(norm(w)));
}

export async function analyzeLoanPdf(localPath: string, expected: "offre" | "tableau"): Promise<LoanDocSignal> {
  const reasons: string[] = [];
  const keywords: string[] = [];

  if (!localPath || !fs.existsSync(localPath)) {
    return { ok: false, kind: "unknown", reasons: ["Fichier introuvable sur le serveur"], keywords };
  }

  const buf = fs.readFileSync(localPath);
  if (buf.length < 40_000) reasons.push("PDF très léger (qualité possiblement insuffisante)");

  let text = "";
  try {
    const fn = (pdfParse as any).default || (pdfParse as any);
    const data = await fn(buf);
    text = String(data.text || "");
  } catch (e: any) {
    return { ok: false, kind: "unknown", reasons: ["Impossible de lire le contenu PDF"], keywords };
  }

  const baseWords = ["pret", "taux", "capital", "mensualite", "echeance"];
  keywords.push(...findKeywords(text, baseWords));

  const offerWords = ["offre de pret", "conditions particulieres", "taux nominal", "taeg", "frais de dossier"];
  const tableWords = ["tableau d'amortissement", "amortissement", "capital restant du", "interets", "assurance"];

  const offerHits = findKeywords(text, offerWords);
  const tableHits = findKeywords(text, tableWords);

  if (offerHits.length) keywords.push(...offerHits);
  if (tableHits.length) keywords.push(...tableHits);

  // Decide kind
  let kind: LoanDocSignal["kind"] = "unknown";
  if (offerHits.length >= 2 && tableHits.length < 2) kind = "offre";
  else if (tableHits.length >= 2) kind = "tableau";
  else if (offerHits.length > 0) kind = "offre";

  // Validate expected
  if (expected === "offre") {
    if (offerHits.length < 1) reasons.push("Mots-clés 'offre de prêt' non détectés");
    if (tableHits.length >= 2) reasons.push("Ressemble plutôt à un tableau d'amortissement");
  } else {
    if (tableHits.length < 1) reasons.push("Mots-clés 'tableau d’amortissement' non détectés");
  }

  // If too little text, likely scanned image-only PDF
  if (text.trim().length < 80) reasons.push("PDF sans texte exploitable (scan/image) — risque d'extraction faible");

  const ok = reasons.length === 0;
  return { ok, kind, reasons, keywords: [...new Set(keywords)].slice(0, 12) };
}

