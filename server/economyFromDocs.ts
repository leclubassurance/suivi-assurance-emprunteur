import fs from "fs";
import { extractPdfTextFromBuffer } from "./pdfTextExtract";

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
  return extractPdfTextFromBuffer(buf);
}

type AmortRow = { idx: number; date: string; payment: number; insuranceAndFees: number; raw: string };

function parseAmortizationRowsFromText(tableauText: string): AmortRow[] {
  const rows: AmortRow[] = [];
  const lines = tableauText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Strategy:
  // 1) Try strict known layout (idx + date + many € columns)
  // 2) Caisse d'Épargne / sans date : Rang | Montant | Capital amorti | Intérêt | Assurance | Autres | CRD
  // 3) Fallback: detect idx+date, then extract amounts from the line and take amount[1] as insurance+fees
  const strictRx =
    /^(\d{1,4})\s+(\d{2}[./-]\d{2}[./-]\d{4})\s+(\d{1,3}(?:[\s.]\d{3})*,\d{2})\s+(\d{1,3}(?:[\s.]\d{3})*,\d{2})\s+(\d{1,3}(?:[\s.]\d{3})*,\d{2})\s+(\d{1,3}(?:[\s.]\d{3})*,\d{2})\s+(\d{1,3}(?:[\s.]\d{3})*,\d{2})/;

  // Ex: 13 723,74 256,62 355,09 112,03 0,00 129 261,32
  const ceNoDateRx =
    /^(\d{1,4})\s+(\d{1,3}(?:[\s.]\d{3})*,\d{2})\s+(\d{1,3}(?:[\s.]\d{3})*,\d{2})\s+(\d{1,3}(?:[\s.]\d{3})*,\d{2})\s+(\d{1,3}(?:[\s.]\d{3})*,\d{2})\s+(\d{1,3}(?:[\s.]\d{3})*,\d{2})\s+(\d{1,3}(?:[\s.]\d{3})+,\d{2}|\d+,\d{2})\s*$/;

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

    const mCe = line.match(ceNoDateRx);
    if (mCe) {
      const idx = Number(mCe[1]);
      const payment = toNumberFR(mCe[2]);
      const insuranceAndFees = toNumberFR(mCe[5]); // COUT ASSURANCES
      if (
        Number.isFinite(idx) &&
        payment != null &&
        insuranceAndFees != null &&
        payment > 50 &&
        payment < 30_000 &&
        insuranceAndFees >= 0 &&
        insuranceAndFees < 5_000
      ) {
        rows.push({ idx, date: "", payment, insuranceAndFees, raw: line });
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
    // Si 5+ montants (layout CE aplati), assurance = 4e montant (index 3)
    const insuranceAndFees = amounts.length >= 5 ? amounts[3] : amounts[1];
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

function pickDocs(docs: any[], category: string): any[] {
  return docs.filter((d) => String(d?.category || "") === category);
}

function pickDoc(docs: any[], category: string): any | null {
  const cands = pickDocs(docs, category);
  const okSig = cands.find((d) => d?.loanSignal?.ok);
  if (okSig) return okSig;
  const pdfCand = cands.find(
    (d) => String(d?.type || "").includes("pdf") || String(d?.name || "").toLowerCase().endsWith(".pdf"),
  );
  return pdfCand || cands[0] || null;
}

/** Montant juste AU-DESSUS d'un libellé (layout colonnes Kereis). */
function amountAboveLabel(text: string, labelRe: RegExp): number | null {
  const m = text.match(labelRe);
  if (!m || m.index == null) return null;
  const head = text.slice(Math.max(0, m.index - 80), m.index);
  const amounts = [...head.matchAll(/(\d{1,3}(?:[\s.]\d{3})*,\d{2})\s*€?/g)];
  if (!amounts.length) return null;
  return toNumberFR(amounts[amounts.length - 1][1]);
}

function dedupeYearMonthlies(
  rows: Array<{ year: number; monthly: number }>,
): Array<{ year: number; monthly: number }> {
  const map = new Map<number, number>();
  for (const r of rows) {
    if (!map.has(r.year)) map.set(r.year, r.monthly);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, monthly]) => ({ year, monthly }));
}

function sumProposedFromYearTable(
  yearMonthlies: Array<{ year: number; monthly: number }>,
  remainingMonths: number,
): number {
  let left = remainingMonths;
  let total = 0;
  for (const row of yearMonthlies) {
    if (left <= 0) break;
    const months = Math.min(12, left);
    total += row.monthly * months;
    left -= months;
  }
  // Si la table est plus courte que la durée, prolonger le dernier taux
  if (left > 0 && yearMonthlies.length) {
    total += yearMonthlies[yearMonthlies.length - 1].monthly * left;
  }
  return Math.round(total * 100) / 100;
}

export async function computeEconomyFromDossierDocs(dossier: any): Promise<EconomyComputation> {
  const reasons: string[] = [];
  const docs = (dossier?.formData?.documents || []) as any[];

  const offre = pickDoc(docs, "offre");
  const tableau = pickDoc(docs, "tableau");
  const devisList = [
    ...pickDocs(docs, "devis"),
    ...docs.filter(
      (d) =>
        String(d?.category || "") !== "devis" &&
        /devis/i.test(String(d?.name || "")) &&
        String(d?.category || "") !== "cni",
    ),
  ].filter((d, i, arr) => arr.findIndex((x) => x === d || x?.localPath === d?.localPath) === i);

  let offerText = "";
  let tableauText = "";
  const devisTexts: string[] = [];
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
  for (const devis of devisList) {
    try {
      const t = await extractPdfText(devis?.localPath);
      if (t.trim()) devisTexts.push(t);
    } catch {
      reasons.push(`Devis (${devis?.name || "?"}): lecture PDF impossible`);
    }
  }
  const devisText = devisTexts.join("\n\n---\n\n");
  const devisN = norm(devisText);

  if (tableau?.localPath && tableauText.trim().length < 40) {
    reasons.push("Tableau d'amortissement: contenu PDF vide (probable scan image)");
  }
  if (devisList.length && devisText.trim().length < 40) {
    reasons.push("Devis: contenu PDF vide (probable scan image)");
  }
  if (!devisList.length) {
    reasons.push("Aucun devis (catégorie devis) sur le dossier");
  }

  const offerN = norm(offerText);
  const tableauN = norm(tableauText);

  // ÉTAPE 2.A : assurance actuelle = colonne assurance de l'échéancier
  let amortRows = parseAmortizationRowsFromText(tableauText);
  let amortValues = amortRows.map((r) => r.insuranceAndFees).filter((v) => Number.isFinite(v) && v >= 0);

  // Durée restante annoncée sur le devis (ex. 295 mois) → garder les dernières N lignes
  const mDuree = devisText.match(/(\d{2,3})\s*mois\s+Dur[ée]e/i) || devisText.match(/Dur[ée]e\s*[:=]?\s*(\d{2,3})\s*mois/i);
  const devisRemainingMonths = mDuree?.[1] ? Number(mDuree[1]) : null;
  if (
    devisRemainingMonths &&
    amortValues.length > devisRemainingMonths &&
    devisRemainingMonths >= 12
  ) {
    const skip = amortValues.length - devisRemainingMonths;
    amortValues = amortValues.slice(skip);
    amortRows = amortRows.slice(skip);
    reasons.push(
      `Échéancier aligné sur la durée devis (${devisRemainingMonths} mois, ${skip} échéance(s) antérieures écartées).`,
    );
  }

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
  if (!currentTotalRemaining && currentMonthlyInsurance == null) {
    reasons.push("Assurance actuelle introuvable (échéancier requis)");
  }

  // --- Devis : totaux (montant souvent AU-DESSUS du libellé Kereis) ---
  let proposedTotalRemaining =
    amountAboveLabel(devisText, /Total\s+des\s+cotisations\s+pour/i) ||
    amountAboveLabel(devisText, /Total\s+des\s+cotisations/i);
  if (proposedTotalRemaining == null) {
    const mTot =
      devisN.match(/total\s+(?:des\s+)?cotisations[\s\S]{0,200}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})\s*(?:€|eur)?/i) ||
      devisN.match(/cout\s+total[\s\S]{0,80}cotisations[\s\S]{0,200}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})\s*(?:€|eur)?/i);
    if (mTot?.[1]) proposedTotalRemaining = toNumberFR(mTot[1]);
  }

  let proposedTotal8y =
    amountAboveLabel(devisText, /Co[uû]t\s+sur\s+les\s+8\s+premi[eè]res\s+ann[ée]es/i) || null;
  if (proposedTotal8y == null) {
    const mTot8y =
      devisN.match(/cotisations[\s\S]{0,60}(?:8\s+ans|huit\s+ans)[\s\S]{0,60}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})/i) ||
      devisN.match(/sur\s+8\s+ans[\s\S]{0,60}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})/i);
    if (mTot8y?.[1]) proposedTotal8y = toNumberFR(mTot8y[1]);
  }

  // Table annuelle : « 1 131 288,66 € 15,03 € »
  let proposedMonthlyByYear: Array<{ year: number; monthly: number }> = [];
  const yearLines = devisText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of yearLines) {
    const m = line.match(
      /^(\d{1,2})\s+(\d{1,3}(?:[\s.]\d{3})+,\d{2}|\d+,\d{2})\s*€?\s+(\d{1,3}(?:[\s.]\d{3})*,\d{2}|\d+,\d{2})\s*€?\s*$/i,
    );
    if (!m) continue;
    const y = Number(m[1]);
    const monthly = toNumberFR(m[3]);
    if (Number.isFinite(y) && monthly != null && monthly < 5000) {
      proposedMonthlyByYear.push({ year: y, monthly });
    }
  }
  proposedMonthlyByYear = dedupeYearMonthlies(proposedMonthlyByYear);

  // Si plusieurs devis (co-emprunteurs), sommer les tables / totaux
  if (devisTexts.length > 1) {
    // Totaux déjà lus sur devisText concaténé peuvent sous-compter :
    // recalculer somme des montants au-dessus de chaque bloc.
    let sumTot = 0;
    let found = 0;
    for (const block of devisTexts) {
      const t =
        amountAboveLabel(block, /Total\s+des\s+cotisations\s+pour/i) ||
        amountAboveLabel(block, /Total\s+des\s+cotisations/i);
      if (t != null) {
        sumTot += t;
        found += 1;
      }
    }
    if (found >= 2) {
      proposedTotalRemaining = Math.round(sumTot * 100) / 100;
      reasons.push(`${found} devis cumulés pour le total proposé.`);
    }
  }

  // Recalcul proposé depuis table annuelle × durée restante (plus fiable que le mauvais total 8 ans)
  if (proposedMonthlyByYear.length >= 5 && remainingMonths) {
    const fromTable = sumProposedFromYearTable(proposedMonthlyByYear, remainingMonths);
    if (
      proposedTotalRemaining == null ||
      // Si le "total" collé est en fait le coût 8 ans (très inférieur à la table)
      (proposedTotal8y != null && Math.abs(proposedTotalRemaining - proposedTotal8y) < 0.02) ||
      fromTable > (proposedTotalRemaining || 0) * 1.15
    ) {
      if (proposedTotalRemaining != null && proposedTotal8y == null) {
        proposedTotal8y = proposedTotalRemaining;
      }
      proposedTotalRemaining = fromTable;
      reasons.push("Total proposé recalculé depuis le tableau annuel du devis × durée restante.");
    }
  }

  if (!proposedTotalRemaining) reasons.push("Total cotisations devis introuvable");

  // Date d'effet (souvent au-dessus du libellé)
  let proposedEffectiveDate: string | undefined;
  const mDateAbove = devisText.match(
    /(\d{1,2}\s+(?:janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\s+\d{4})\s*\n+\s*Date d['']effet des garanties/i,
  );
  if (mDateAbove?.[1]) proposedEffectiveDate = mDateAbove[1].trim();
  if (!proposedEffectiveDate) {
    const mDate = devisText.match(/Date d'effet des garanties\s*\n?\s*([0-9]{1,2}\s+[^\n]+\s+[0-9]{4})/i);
    if (mDate?.[1]) proposedEffectiveDate = mDate[1].trim();
  }

  // Fees
  let feesAssureurTotal: number | null = null;
  let feesCourtierTotal: number | null = null;

  const mFeesAssureur =
    devisN.match(/total\s+frais\s+assureur[\s\S]{0,80}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})/i) ||
    devisN.match(/frais\s+assureur[\s\S]{0,80}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})/i) ||
    devisN.match(/frais\s+de\s+dossier[\s\S]{0,40}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})/i) ||
    devisN.match(/frais\s+retenus[\s\S]{0,40}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})/i);
  if (mFeesAssureur?.[1]) feesAssureurTotal = toNumberFR(mFeesAssureur[1]);

  if (feesAssureurTotal == null) {
    const mAdhesion = [...devisN.matchAll(/adhesion[^\d]{0,40}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})/gi)];
    const mDossier = [...devisN.matchAll(/frais\s+de\s+dossier[^\d]{0,40}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})/gi)];
    const parts = [...mAdhesion, ...mDossier]
      .map((m) => toNumberFR(m[1]))
      .filter((n): n is number => n != null && n > 0 && n < 2000);
    if (parts.length) feesAssureurTotal = Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100;
  }

  const mFeesCourtier =
    devisN.match(/frais\s+(?:de\s+distribution|de\s+courtage|courtage)[\s\S]{0,80}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})/i) ||
    devisN.match(/total\s+frais\s+(?:lcif|distribution|courtage)[\s\S]{0,80}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})/i);
  if (mFeesCourtier?.[1]) feesCourtierTotal = toNumberFR(mFeesCourtier[1]);

  const assuresCount = Array.isArray(dossier?.formData?.assures) ? dossier.formData.assures.length : 1;
  if (assuresCount > 1 && devisTexts.length < assuresCount) {
    reasons.push(
      `Attention: ${assuresCount} assurés mais ${devisTexts.length} devis — uploadez un devis par assuré pour un total complet.`,
    );
  }

  const extracted = {
    currentMonthlyInsurance: currentMonthlyInsurance ?? undefined,
    currentMonthlyByYear: currentMonthlyByYear.length ? currentMonthlyByYear : undefined,
    remainingMonths: remainingMonths ?? undefined,
    currentTotalRemaining:
      currentTotalRemaining ??
      (currentMonthlyInsurance != null && remainingMonths != null
        ? currentMonthlyInsurance * remainingMonths
        : undefined),
    currentTotal8y: currentTotal8y ?? undefined,
    proposedTotalRemaining: proposedTotalRemaining ?? undefined,
    proposedTotal8y: proposedTotal8y ?? undefined,
    proposedMonthlyByYear: proposedMonthlyByYear.length ? proposedMonthlyByYear.slice(0, 40) : undefined,
    proposedEffectiveDate,
    feesAssureurTotal: feesAssureurTotal ?? undefined,
    feesCourtierTotal: feesCourtierTotal ?? undefined,
  };

  // Reliability — il faut les DEUX côtés (actuelle + proposée)
  let reliability: EconomyReliability = "LOW";
  if (
    extracted.currentTotalRemaining != null &&
    extracted.currentTotalRemaining > 0 &&
    remainingMonths != null &&
    proposedTotalRemaining != null &&
    proposedTotalRemaining > 0
  ) {
    reliability = proposedMonthlyByYear.length ? "HIGH" : "MEDIUM";
  } else if (
    (extracted.currentTotalRemaining != null && remainingMonths != null) ||
    proposedTotalRemaining != null
  ) {
    reliability = "MEDIUM";
  }

  if (reliability === "LOW" || !(extracted.currentTotalRemaining != null && proposedTotalRemaining != null)) {
    return { ok: false, reliability: "LOW", reasons, extracted };
  }

  const curTotal = extracted.currentTotalRemaining ?? 0;
  const grossSavings = curTotal - (proposedTotalRemaining ?? 0);
  const grossSavings8y =
    extracted.currentTotal8y != null && proposedTotal8y != null ? extracted.currentTotal8y - proposedTotal8y : undefined;

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

