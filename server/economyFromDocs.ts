import fs from "fs";
import * as pdfParse from "pdf-parse";

export type EconomyReliability = "HIGH" | "MEDIUM" | "LOW";

export type EconomyComputation = {
  ok: boolean;
  reliability: EconomyReliability;
  reasons: string[];
  extracted: {
    currentMonthlyInsurance?: number;
    remainingMonths?: number;
    currentTotalRemaining?: number;
    proposedTotalRemaining?: number;
    proposedMonthlyByYear?: Array<{ year: number; monthly: number }>;
    proposedEffectiveDate?: string;
  };
  result?: {
    grossSavings?: number;
    currentTotalRemaining?: number;
    proposedTotalRemaining?: number;
    table?: Array<{ label: string; currentMonthly: number | null; proposedMonthly: number | null; gainMonthly: number | null }>;
  };
};

function toNumberFR(s: string) {
  const v = s.replace(/\s/g, "").replace(",", ".").replace(/[^\d.]/g, "");
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function norm(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

async function extractPdfText(localPath?: string): Promise<string> {
  if (!localPath || !fs.existsSync(localPath)) return "";
  const buf = fs.readFileSync(localPath);
  const fn = (pdfParse as any).default || (pdfParse as any);
  const data = await fn(buf);
  return String(data.text || "");
}

function pickDoc(docs: any[], category: string): any | null {
  const cands = docs.filter((d) => String(d?.category || "") === category);
  // prefer PDFs with a loanSignal ok
  const okSig = cands.find((d) => d?.loanSignal?.ok);
  if (okSig) return okSig;
  // else any pdf
  const pdfCand = cands.find((d) => String(d?.type || "").includes("pdf") || String(d?.name || "").toLowerCase().endsWith(".pdf"));
  return pdfCand || cands[0] || null;
}

export async function computeEconomyFromDossierDocs(dossier: any): Promise<EconomyComputation> {
  const reasons: string[] = [];
  const docs = (dossier?.formData?.documents || []) as any[];

  const offre = pickDoc(docs, "offre");
  const tableau = pickDoc(docs, "tableau");
  const devis = pickDoc(docs, "devis"); // we'll add later, for now allow any "devis" category if user uploads as such

  // If devis not categorized, fallback to "autre" with filename containing devis
  const devisFallback =
    devis ||
    docs.find((d) => /devis/i.test(String(d?.name || ""))) ||
    null;

  let offerText = "";
  let tableauText = "";
  let devisText = "";
  try {
    offerText = await extractPdfText(offre?.localPath);
  } catch {
    reasons.push("Offre de prêt: lecture PDF impossible");
  }
  try {
    tableauText = await extractPdfText(tableau?.localPath);
  } catch {
    reasons.push("Tableau d'amortissement: lecture PDF impossible");
  }
  try {
    devisText = await extractPdfText(devisFallback?.localPath);
  } catch {
    reasons.push("Devis: lecture PDF impossible");
  }

  const offerN = norm(offerText);
  const devisN = norm(devisText);
  const tableauN = norm(tableauText);

  // Extract current insurance monthly from offer (pattern "... + assurance 90,28")
  let currentMonthlyInsurance: number | null = null;
  const mAss = offerN.match(/assurance\s+(\d{1,3}(?:[\s.]\d{3})*,\d{2})/i);
  if (mAss?.[1]) currentMonthlyInsurance = toNumberFR(mAss[1]);
  if (!currentMonthlyInsurance) {
    // fallback from tableau: column "dont assurance" e.g. 90,18
    const mTabAss = tableauN.match(/\b(\d{1,3},\d{2})\b/g);
    if (mTabAss?.length) {
      const cand = mTabAss.map(toNumberFR).filter((x): x is number => typeof x === "number");
      // choose median-ish around 90 if present
      const around90 = cand.find((x) => x > 30 && x < 200);
      if (around90) currentMonthlyInsurance = around90;
    }
  }
  if (!currentMonthlyInsurance) reasons.push("Assurance actuelle mensuelle introuvable");

  // Extract remaining months from offer ("pendant 296 mois")
  let remainingMonths: number | null = null;
  const mMonths = offerN.match(/pendant\s+(\d{2,4})\s+mois/);
  if (mMonths?.[1]) remainingMonths = Number(mMonths[1]);
  if (!remainingMonths || !Number.isFinite(remainingMonths)) reasons.push("Durée restante introuvable dans l'offre");

  // Proposed total from devis ("Total des cotisations ... 10 393,48 €")
  let proposedTotalRemaining: number | null = null;
  const mTot = devisN.match(/total des cotisations[^\\d]{0,40}(\d{1,3}(?:[\s.]\d{3})*,\d{2})\s*€/i);
  if (mTot?.[1]) proposedTotalRemaining = toNumberFR(mTot[1]);
  if (!proposedTotalRemaining) reasons.push("Total cotisations devis introuvable");

  // Proposed monthly by year table: "1 307 687,64 € 19,56 €" pattern; we only want the last number per line
  const proposedMonthlyByYear: Array<{ year: number; monthly: number }> = [];
  const yearLines = devisText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of yearLines) {
    const m = line.match(/^(\d{1,2})\s+[\d\s.,]+€\s+([\d\s.,]+)\s*€$/);
    if (!m) continue;
    const y = Number(m[1]);
    const monthly = toNumberFR(m[2]);
    if (Number.isFinite(y) && monthly != null) proposedMonthlyByYear.push({ year: y, monthly });
  }
  if (proposedMonthlyByYear.length === 0) {
    // fallback: try looser
    const rx = /(\d{1,2})\s+[\d\s.,]+€\s+(\d{1,3},\d{2})\s*€/g;
    let mm;
    while ((mm = rx.exec(devisN))) {
      const y = Number(mm[1]);
      const monthly = toNumberFR(mm[2]);
      if (Number.isFinite(y) && monthly != null) proposedMonthlyByYear.push({ year: y, monthly });
    }
  }

  // Effective date in devis: "Date d'effet ... 17 août 2026"
  let proposedEffectiveDate: string | undefined;
  const mDate = devisText.match(/Date d'effet des garanties\s*\n?\s*([0-9]{1,2}\s+[^\n]+\s+[0-9]{4})/i);
  if (mDate?.[1]) proposedEffectiveDate = mDate[1].trim();

  const extracted = {
    currentMonthlyInsurance: currentMonthlyInsurance ?? undefined,
    remainingMonths: remainingMonths ?? undefined,
    currentTotalRemaining:
      currentMonthlyInsurance != null && remainingMonths != null ? currentMonthlyInsurance * remainingMonths : undefined,
    proposedTotalRemaining: proposedTotalRemaining ?? undefined,
    proposedMonthlyByYear: proposedMonthlyByYear.length ? proposedMonthlyByYear.slice(0, 30) : undefined,
    proposedEffectiveDate,
  };

  // Reliability
  let reliability: EconomyReliability = "LOW";
  if (currentMonthlyInsurance != null && remainingMonths != null && proposedTotalRemaining != null) {
    reliability = proposedMonthlyByYear.length ? "HIGH" : "MEDIUM";
  } else if ((currentMonthlyInsurance != null && remainingMonths != null) || proposedTotalRemaining != null) {
    reliability = "MEDIUM";
  }

  if (reliability === "LOW") {
    return { ok: false, reliability, reasons, extracted };
  }

  const currentTotalRemaining = extracted.currentTotalRemaining!;
  const grossSavings = currentTotalRemaining - (proposedTotalRemaining ?? 0);

  // Build evolution table (grouped bands)
  const currentMonthly = currentMonthlyInsurance!;
  const proposedByYear = new Map<number, number>();
  for (const row of proposedMonthlyByYear) proposedByYear.set(row.year, row.monthly);

  const bands: Array<{ label: string; years: number[] }> = [
    { label: "Année 1", years: [1] },
    { label: "Année 2", years: [2] },
    { label: "Année 3", years: [3] },
    { label: "Années 4–8", years: [4, 5, 6, 7, 8] },
    { label: "Années 9–15", years: [9, 10, 11, 12, 13, 14, 15] },
    { label: "Années 16–fin", years: Array.from({ length: 15 }, (_, i) => 16 + i) },
  ];

  const table = bands.map((b) => {
    const vals = b.years.map((y) => proposedByYear.get(y)).filter((v): v is number => typeof v === "number");
    const proposedMonthly = vals.length ? vals.reduce((a, c) => a + c, 0) / vals.length : null;
    const gainMonthly = proposedMonthly != null ? currentMonthly - proposedMonthly : null;
    return {
      label: b.label,
      currentMonthly,
      proposedMonthly: proposedMonthly != null ? Math.round(proposedMonthly * 100) / 100 : null,
      gainMonthly: gainMonthly != null ? Math.round(gainMonthly * 100) / 100 : null,
    };
  });

  return {
    ok: true,
    reliability,
    reasons,
    extracted: {
      ...extracted,
      currentTotalRemaining,
      proposedTotalRemaining: proposedTotalRemaining ?? undefined,
    },
    result: {
      grossSavings,
      currentTotalRemaining,
      proposedTotalRemaining: proposedTotalRemaining ?? currentTotalRemaining,
      table,
    },
  };
}

