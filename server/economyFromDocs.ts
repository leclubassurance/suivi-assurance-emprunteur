import fs from "fs";
import * as pdfParse from "pdf-parse";

export type EconomyReliability = "HIGH" | "MEDIUM" | "LOW";

export type EconomyComputation = {
  ok: boolean;
  reliability: EconomyReliability;
  reasons: string[];
  extracted: {
    currentMonthlyInsurance?: number; // moyenne année 1 (indicatif)
    currentMonthlyByYear?: Array<{ year: number; monthly: number; total: number }>;
    remainingMonths?: number;
    currentTotalRemaining?: number;
    currentTotal8y?: number;
    proposedTotalRemaining?: number;
    proposedTotal8y?: number;
    proposedMonthlyByYear?: Array<{ year: number; monthly: number }>;
    proposedEffectiveDate?: string;
    feesAssureurTotal?: number;
    feesCourtierTotal?: number;
  };
  result?: {
    grossSavings?: number;
    grossSavings8y?: number;
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

type AmortRow = { idx: number; date: string; payment: number; insuranceAndFees: number; raw: string };

function parseAmortizationRowsFromText(tableauText: string): AmortRow[] {
  const rows: AmortRow[] = [];
  const lines = tableauText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Strategy:
  // 1) Try strict known layout (idx + date + many € columns)
  // 2) Fallback: detect idx+date, then extract amounts from the line and take amount[1] as insurance+fees
  const strictRx =
    /^(\d{1,4})\s+(\d{2}[./-]\d{2}[./-]\d{4})\s+(\d{1,3}(?:[\s.]\d{3})*,\d{2})\s+(\d{1,3}(?:[\s.]\d{3})*,\d{2})\s+(\d{1,3}(?:[\s.]\d{3})*,\d{2})\s+(\d{1,3}(?:[\s.]\d{3})*,\d{2})\s+(\d{1,3}(?:[\s.]\d{3})*,\d{2})/;

  const looseHeadRx = /^(\d{1,4})\s+(\d{2}[./-]\d{2}[./-]\d{2,4})\b/;
  const moneyRx = /(\d{1,3}(?:[\s.]\d{3})*,\d{2})/g;

  for (const line of lines) {
    const mStrict = line.match(strictRx);
    if (mStrict) {
      const idx = Number(mStrict[1]);
      const date = mStrict[2];
      const payment = toNumberFR(mStrict[3]);
      const insuranceAndFees = toNumberFR(mStrict[4]);
      if (Number.isFinite(idx) && payment != null && insuranceAndFees != null) {
        rows.push({ idx, date, payment, insuranceAndFees, raw: line });
      }
      continue;
    }

    const mHead = line.match(looseHeadRx);
    if (!mHead) continue;
    const idx = Number(mHead[1]);
    const date = mHead[2];
    if (!Number.isFinite(idx)) continue;

    const amounts = Array.from(line.matchAll(moneyRx))
      .map((mm) => toNumberFR(mm[1]))
      .filter((v): v is number => v != null);
    // Need at least payment + insurance
    if (amounts.length < 2) continue;

    const payment = amounts[0];
    const insuranceAndFees = amounts[1];
    // basic sanity: payment should be "large" vs insurance "small-ish"
    if (!(payment > 200 && payment < 20000)) continue;
    if (!(insuranceAndFees >= 0 && insuranceAndFees < 2000)) continue;

    rows.push({ idx, date, payment, insuranceAndFees, raw: line });
  }

  // De-dup (some PDFs repeat tables per page)
  const uniq = new Map<string, AmortRow>();
  for (const r of rows) {
    const k = `${r.idx}-${r.date}-${r.payment}-${r.insuranceAndFees}`;
    if (!uniq.has(k)) uniq.set(k, r);
  }
  return Array.from(uniq.values()).sort((a, b) => a.idx - b.idx);
}

function sumFirstN(rows: number[], n: number) {
  return rows.slice(0, n).reduce((a, c) => a + c, 0);
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

  if (tableau?.localPath && tableauText.trim().length < 40) {
    reasons.push("Tableau d'amortissement: contenu PDF vide (probable scan image)");
  }
  if (devisFallback?.localPath && devisText.trim().length < 40) {
    reasons.push("Devis: contenu PDF vide (probable scan image)");
  }

  const offerN = norm(offerText);
  const devisN = norm(devisText);
  const tableauN = norm(tableauText);

  // ÉTAPE 2.A (skill): assurance actuelle = somme des échéances "Assurance groupe et frais / Autres frais (dont assurance)"
  const amortRows = parseAmortizationRowsFromText(tableauText);
  const amortValues = amortRows.map((r) => r.insuranceAndFees).filter((v) => Number.isFinite(v) && v >= 0);

  const remainingMonths = amortValues.length || null;
  const currentTotalRemaining = amortValues.length ? amortValues.reduce((a, c) => a + c, 0) : null;
  const currentTotal8y = amortValues.length ? sumFirstN(amortValues, Math.min(96, amortValues.length)) : null;

  const currentMonthlyByYear: Array<{ year: number; monthly: number; total: number }> = [];
  if (amortValues.length) {
    const years = Math.ceil(amortValues.length / 12);
    for (let y = 1; y <= years; y++) {
      const slice = amortValues.slice((y - 1) * 12, y * 12);
      if (!slice.length) continue;
      const total = slice.reduce((a, c) => a + c, 0);
      currentMonthlyByYear.push({
        year: y,
        total: Math.round(total * 100) / 100,
        monthly: Math.round((total / slice.length) * 100) / 100,
      });
    }
  }

  let currentMonthlyInsurance: number | null = currentMonthlyByYear[0]?.monthly ?? null;

  if (!amortValues.length) {
    // fallback from offer only if schedule parsing failed
    const mAss = offerN.match(/assurance\s+(\d{1,3}(?:[\s.]\d{3})*,\d{2})/i);
    if (mAss?.[1]) {
      const n = toNumberFR(mAss[1]);
      if (n != null) {
        currentMonthlyInsurance = n;
        reasons.push("Tableau d'amortissement non lisible: assurance mensuelle déduite de l'offre (moins fiable)");
      }
    } else {
      reasons.push("Tableau d'amortissement: impossible d'extraire la colonne assurance");
    }
  }
  if (!currentTotalRemaining && currentMonthlyInsurance == null) reasons.push("Assurance actuelle introuvable (échéancier requis)");

  // Proposed total from devis ("Total des cotisations ... 10 393,48 €")
  let proposedTotalRemaining: number | null = null;
  const mTot =
    devisN.match(/total\s+(?:des\s+)?cotisations[\s\S]{0,200}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})\s*(?:€|eur)?/i) ||
    devisN.match(/cout\s+total[\s\S]{0,80}cotisations[\s\S]{0,200}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})\s*(?:€|eur)?/i) ||
    devisN.match(/montant\s+total[\s\S]{0,80}cotisations[\s\S]{0,200}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})\s*(?:€|eur)?/i) ||
    devisN.match(/total[\s\S]{0,80}cotisations[\s\S]{0,200}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})/i);
  if (mTot?.[1]) proposedTotalRemaining = toNumberFR(mTot[1]);
  if (!proposedTotalRemaining) reasons.push("Total cotisations devis introuvable");

  // Proposed total on first 8y (if present in devis)
  let proposedTotal8y: number | null = null;
  const mTot8y =
    devisN.match(/cotisations[\s\S]{0,60}(?:8\s+ans|huit\s+ans)[\s\S]{0,60}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})/i) ||
    devisN.match(/sur\s+8\s+ans[\s\S]{0,60}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})/i);
  if (mTot8y?.[1]) proposedTotal8y = toNumberFR(mTot8y[1]);

  // Proposed monthly by year table: "1 307 687,64 € 19,56 €" pattern; we only want the last number per line
  const proposedMonthlyByYear: Array<{ year: number; monthly: number }> = [];
  const yearLines = devisText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of yearLines) {
    const m = line.match(/^(\d{1,2})\s+[\d\s.,]+(?:€|eur)?\s+([\d\s.,]+)\s*(?:€|eur)?$/i);
    if (!m) continue;
    const y = Number(m[1]);
    const monthly = toNumberFR(m[2]);
    if (Number.isFinite(y) && monthly != null) proposedMonthlyByYear.push({ year: y, monthly });
  }
  if (proposedMonthlyByYear.length === 0) {
    // fallback: try looser
    const rx = /(\d{1,2})\s+[\d\s.,]+(?:€|eur)?\s+(\d{1,3},\d{2})\s*(?:€|eur)?/gi;
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

  // Fees: never invent, only extract if clearly present.
  let feesAssureurTotal: number | null = null;
  let feesCourtierTotal: number | null = null;

  const mFeesAssureur =
    devisN.match(/total\s+frais\s+assureur[\s\S]{0,80}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})/i) ||
    devisN.match(/frais\s+assureur[\s\S]{0,80}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})/i);
  if (mFeesAssureur?.[1]) feesAssureurTotal = toNumberFR(mFeesAssureur[1]);

  const mFeesCourtier =
    devisN.match(/frais\s+(?:de\s+distribution|de\s+courtage|courtage)[\s\S]{0,80}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})/i) ||
    devisN.match(/total\s+frais\s+(?:lcif|distribution|courtage)[\s\S]{0,80}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})/i);
  if (mFeesCourtier?.[1]) feesCourtierTotal = toNumberFR(mFeesCourtier[1]);

  const extracted = {
    currentMonthlyInsurance: currentMonthlyInsurance ?? undefined,
    currentMonthlyByYear: currentMonthlyByYear.length ? currentMonthlyByYear : undefined,
    remainingMonths: remainingMonths ?? undefined,
    currentTotalRemaining: currentTotalRemaining ?? (currentMonthlyInsurance != null && remainingMonths != null ? currentMonthlyInsurance * remainingMonths : undefined),
    currentTotal8y: currentTotal8y ?? undefined,
    proposedTotalRemaining: proposedTotalRemaining ?? undefined,
    proposedTotal8y: proposedTotal8y ?? undefined,
    proposedMonthlyByYear: proposedMonthlyByYear.length ? proposedMonthlyByYear.slice(0, 30) : undefined,
    proposedEffectiveDate,
    feesAssureurTotal: feesAssureurTotal ?? undefined,
    feesCourtierTotal: feesCourtierTotal ?? undefined,
  };

  // Reliability
  let reliability: EconomyReliability = "LOW";
  if (extracted.currentTotalRemaining != null && remainingMonths != null && proposedTotalRemaining != null) {
    reliability = proposedMonthlyByYear.length ? "HIGH" : "MEDIUM";
  } else if ((extracted.currentTotalRemaining != null && remainingMonths != null) || proposedTotalRemaining != null) {
    reliability = "MEDIUM";
  }

  if (reliability === "LOW") {
    return { ok: false, reliability, reasons, extracted };
  }

  const curTotal = extracted.currentTotalRemaining ?? 0;
  const grossSavings = curTotal - (proposedTotalRemaining ?? 0);
  const grossSavings8y =
    extracted.currentTotal8y != null && proposedTotal8y != null ? extracted.currentTotal8y - proposedTotal8y : undefined;

  // Build evolution table (grouped bands)
  const currentByYear = new Map<number, number>();
  for (const row of extracted.currentMonthlyByYear || []) currentByYear.set(row.year, row.monthly);
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
    const curVals = b.years.map((y) => currentByYear.get(y)).filter((v): v is number => typeof v === "number");
    const currentMonthly = curVals.length ? curVals.reduce((a, c) => a + c, 0) / curVals.length : null;
    const vals = b.years.map((y) => proposedByYear.get(y)).filter((v): v is number => typeof v === "number");
    const proposedMonthly = vals.length ? vals.reduce((a, c) => a + c, 0) / vals.length : null;
    const gainMonthly = proposedMonthly != null && currentMonthly != null ? currentMonthly - proposedMonthly : null;
    return {
      label: b.label,
      currentMonthly: currentMonthly != null ? Math.round(currentMonthly * 100) / 100 : null,
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
      currentTotalRemaining: extracted.currentTotalRemaining,
      proposedTotalRemaining: proposedTotalRemaining ?? undefined,
    },
    result: {
      grossSavings,
      grossSavings8y,
      currentTotalRemaining: extracted.currentTotalRemaining,
      proposedTotalRemaining: proposedTotalRemaining ?? extracted.currentTotalRemaining ?? 0,
      table,
    },
  };
}

