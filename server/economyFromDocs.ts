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
    /** Totaux individuels avant somme (un par assuré / bloc devis), ex. [3420.92, 8413.97]. */
    proposedInsuredTotals?: number[];
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
  const all = amountsAboveAllLabels(text, labelRe);
  return all.length ? all[0] : null;
}

/** Tous les montants au-dessus de chaque occurrence du libellé (couple = 2 blocs dans 1 PDF). */
function amountsAboveAllLabels(text: string, labelRe: RegExp): number[] {
  const flags = labelRe.flags.includes("g") ? labelRe.flags : `${labelRe.flags}g`;
  const re = new RegExp(labelRe.source, flags);
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const head = text.slice(Math.max(0, m.index - 100), m.index);
    const amounts = [...head.matchAll(/(\d{1,3}(?:[\s.]\d{3})*,\d{2})\s*€?/g)];
    if (!amounts.length) continue;
    const n = toNumberFR(amounts[amounts.length - 1][1]);
    if (n != null && n > 0) out.push(n);
  }
  return out;
}

/** Montants sur la même ligne que le libellé (pas la ligne suivante = autre indicateur). */
function amountsInlineAfterLabel(text: string, labelRe: RegExp): number[] {
  const flags = labelRe.flags.includes("g") ? labelRe.flags : `${labelRe.flags}g`;
  const re = new RegExp(labelRe.source, flags);
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const lineEnd = text.indexOf("\n", m.index);
    const tail = text.slice(m.index, lineEnd === -1 ? m.index + 100 : lineEnd);
    const amounts = [...tail.matchAll(/(\d{1,3}(?:[\s.]\d{3})*,\d{2})\s*€?/g)];
    for (const a of amounts) {
      const n = toNumberFR(a[1]);
      if (n != null && n > 0) out.push(n);
    }
  }
  return out;
}

/** « Total des cotisations du prêt 3 420,92 € » — un par prêt / assuré. */
function totalsInlinePret(text: string): number[] {
  const out: number[] = [];
  const re = /Total\s+des\s+cotisations\s+du\s+pr[eê]t\s+(\d{1,3}(?:[\s.]\d{3})*,\d{2})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = toNumberFR(m[1]);
    if (n != null && n > 0) out.push(n);
  }
  return out;
}

/**
 * Choisit le total proposé devis sans double-compter :
 * - bruit amountAbove (ex. 1,20 € d'une ligne annuelle)
 * - totaux « ensemble » répétés
 * - multi-prêts d'un même assuré (somme des « du prêt » = ensemble)
 */
function resolveProposedTotals(
  pourAbove: number[],
  pourInline: number[],
  pret: number[],
): { total: number | null; parts: number[]; note: string } {
  const round = (n: number) => Math.round(n * 100) / 100;
  const pretClean = pret.map(round).filter((n) => n >= 20);
  const pretSum = round(pretClean.reduce((a, b) => a + b, 0));

  const ensembleRaw = [...pourAbove, ...pourInline].map(round).filter((n) => n >= 50);
  const ensembleUnique = [...new Set(ensembleRaw)];

  if (ensembleUnique.length) {
    const matchPret = ensembleUnique.find((e) => pretSum > 0 && Math.abs(e - pretSum) <= 1);
    if (matchPret != null) {
      return {
        total: matchPret,
        parts: pretClean.length >= 2 ? pretClean : [matchPret],
        note:
          pretClean.length >= 2
            ? `Total devis ${matchPret} € (= somme ${pretClean.length} prêts).`
            : `Total devis ensemble ${matchPret} €.`,
      };
    }
    if (ensembleUnique.length === 1) {
      return {
        total: ensembleUnique[0],
        parts: [ensembleUnique[0]],
        note: `Total devis ensemble ${ensembleUnique[0]} €.`,
      };
    }
    // Plusieurs totaux ensemble distincts → co-emprunteurs
    const sum = round(ensembleUnique.reduce((a, b) => a + b, 0));
    return {
      total: sum,
      parts: ensembleUnique,
      note: `${ensembleUnique.length} totaux « ensemble » cumulés (${ensembleUnique.join(" + ")}).`,
    };
  }

  if (pretClean.length >= 1) {
    return {
      total: pretSum,
      parts: pretClean,
      note: `${pretClean.length} totaux « cotisations du prêt » cumulés.`,
    };
  }
  return { total: null, parts: [], note: "" };
}

type YearPremiumRow = { year: number; capital: number; monthly: number };

/**
 * Fusionne les grilles annuelles multi-prêts / multi-assurés.
 * Exclut la ligne récap Cardif dont le capital = somme des autres capitaux de l'année
 * (sinon on double-compte les cotisations → totaux absurdes).
 */
function mergeYearMonthlies(rows: YearPremiumRow[]): Array<{ year: number; monthly: number }> {
  const byYear = new Map<number, YearPremiumRow[]>();
  for (const r of rows) {
    const list = byYear.get(r.year) || [];
    list.push(r);
    byYear.set(r.year, list);
  }
  const out: Array<{ year: number; monthly: number }> = [];
  for (const [year, list] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    let kept = list;
    if (list.length >= 2) {
      kept = list.filter((row) => {
        const others = list.filter((o) => o !== row);
        const sumCap = others.reduce((a, o) => a + o.capital, 0);
        // Ligne agrégée : capital ≈ somme des autres
        if (others.length >= 2 && Math.abs(row.capital - sumCap) <= 1) return false;
        return true;
      });
      // Si tout a été filtré (cas pathologique), garder les non-agrégés via mensuelles
      if (!kept.length) kept = list;
    }
    // Si une mensuelle ≈ somme des autres, l'écarter aussi (agrégat cotisations)
    if (kept.length >= 2) {
      kept = kept.filter((row) => {
        const others = kept.filter((o) => o !== row);
        const sumM = others.reduce((a, o) => a + o.monthly, 0);
        if (others.length >= 1 && Math.abs(row.monthly - sumM) <= 0.05) return false;
        return true;
      });
      if (!kept.length) kept = list;
    }
    const monthly = Math.round(kept.reduce((a, r) => a + r.monthly, 0) * 100) / 100;
    out.push({ year, monthly });
  }
  return out;
}

function countKereisInsuredBlocks(text: string): number {
  // « Référence dossier » = 1 par assuré. « PROJET D'ASSURANCE » peut se répéter
  // sur les pages d'équivalence → moins fiable.
  const refs = (text.match(/R[ée]f[ée]rence\s+dossier/gi) || []).length;
  if (refs >= 1) return refs;
  const projets = (text.match(/PROJET\s+D['\u2019']ASSURANCE/gi) || []).length;
  return Math.max(1, projets);
}

/**
 * Frais retenus étude : adhésion (10 €) + constitution dossier (75 €) par assuré.
 * Exclut explicitement les frais de distribution (250 €) — courtage séparé.
 */
function extractKereisAssureurFees(text: string): number | null {
  const n = norm(text);
  const parseEuroInt = (raw: string): number | null => {
    const cleaned = raw.replace(/\s/g, "").replace(",", ".");
    const v = Number(cleaned);
    return Number.isFinite(v) ? v : null;
  };

  const adhesions = [
    ...n.matchAll(
      /frais\s+d['']?adhesion[^\d]{0,90}?(\d+(?:[.,]\d{2})?)\s*(?:euros?|€)?/gi,
    ),
  ]
    .map((m) => parseEuroInt(m[1]))
    .filter((v): v is number => v != null && v > 0 && v <= 50);

  const dossiers = [
    ...n.matchAll(
      /(?:frais\s+de\s+)?constitution\s+de\s+dossier[^\d]{0,40}?(\d+(?:[.,]\d{2})?)\s*(?:euros?|€)?/gi,
    ),
  ]
    .map((m) => parseEuroInt(m[1]))
    .filter((v): v is number => v != null && v >= 20 && v <= 200);

  // Fallback libellé court « frais de dossier de 75 euros »
  if (!dossiers.length) {
    dossiers.push(
      ...[
        ...n.matchAll(/frais\s+de\s+dossier[^\d]{0,40}?(\d+(?:[.,]\d{2})?)\s*(?:euros?|€)?/gi),
      ]
        .map((m) => parseEuroInt(m[1]))
        .filter((v): v is number => v != null && v >= 20 && v <= 200),
    );
  }

  const parts = [...adhesions, ...dossiers];
  if (!parts.length) return null;
  return Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100;
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
  const currentTotalRemaining = amortValues.length
    ? Math.round(amortValues.reduce((a, c) => a + c, 0) * 100) / 100
    : null;
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
  // Un seul PDF Kereis peut contenir plusieurs assurés OU plusieurs prêts.
  const pourAbove = amountsAboveAllLabels(devisText, /Total\s+des\s+cotisations\s+pour/i);
  const pourInline = amountsInlineAfterLabel(devisText, /Total\s+des\s+cotisations\s+pour/i);
  const pretTotals = totalsInlinePret(devisText);
  const insuredBlocks = countKereisInsuredBlocks(devisText);

  const resolvedProposed = resolveProposedTotals(pourAbove, pourInline, pretTotals);
  let proposedInsuredTotals: number[] = resolvedProposed.parts;
  let proposedTotalRemaining: number | null = resolvedProposed.total;
  if (resolvedProposed.note) reasons.push(resolvedProposed.note);

  if (proposedTotalRemaining == null) {
    proposedTotalRemaining =
      amountAboveLabel(devisText, /Total\s+des\s+cotisations\s+pour/i) ||
      amountAboveLabel(devisText, /Total\s+des\s+cotisations/i);
    if (proposedTotalRemaining == null) {
      const mTot =
        devisN.match(/total\s+(?:des\s+)?cotisations[\s\S]{0,200}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})\s*(?:€|eur)?/i) ||
        devisN.match(/cout\s+total[\s\S]{0,80}cotisations[\s\S]{0,200}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})\s*(?:€|eur)?/i);
      if (mTot?.[1]) proposedTotalRemaining = toNumberFR(mTot[1]);
    }
  }

  const eightYAbove = amountsAboveAllLabels(
    devisText,
    /Co[uû]t\s+sur\s+les\s+8\s+premi[eè]res\s+ann[ée]es/i,
  );
  const eightYInline = amountsInlineAfterLabel(
    devisText,
    /Co[uû]t\s+sur\s+les\s+8\s+premi[eè]res\s+ann[ée]es|Total\s+des\s+cotisations\s+les\s+8/i,
  );
  const eightYUnique = [...new Set([...eightYAbove, ...eightYInline].filter((n) => n >= 20))];
  let proposedTotal8y: number | null =
    eightYUnique.length === 1
      ? eightYUnique[0]
      : eightYUnique.length > 1
        ? Math.round(eightYUnique.reduce((a, b) => a + b, 0) * 100) / 100
        : null;
  if (proposedTotal8y == null) {
    const mTot8y =
      devisN.match(/cotisations[\s\S]{0,60}(?:8\s+ans|huit\s+ans)[\s\S]{0,60}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})/i) ||
      devisN.match(/sur\s+8\s+ans[\s\S]{0,60}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})/i);
    if (mTot8y?.[1]) proposedTotal8y = toNumberFR(mTot8y[1]);
  }

  // Table annuelle : « 1 58 538,92 € 4,59 € » — multi-prêts + éventuelle ligne récap
  const yearPremiumRows: YearPremiumRow[] = [];
  const yearLines = devisText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of yearLines) {
    const m = line.match(
      /^(\d{1,2})\s+(\d{1,3}(?:[\s.]\d{3})+,\d{2}|\d+,\d{2})\s*€?\s+(\d{1,3}(?:[\s.]\d{3})*,\d{2}|\d+,\d{2})\s*€?\s*$/i,
    );
    if (!m) continue;
    const y = Number(m[1]);
    const capital = toNumberFR(m[2]);
    const monthly = toNumberFR(m[3]);
    if (Number.isFinite(y) && capital != null && monthly != null && monthly < 5000) {
      yearPremiumRows.push({ year: y, capital, monthly });
    }
  }
  let proposedMonthlyByYear = mergeYearMonthlies(yearPremiumRows);

  // Si plusieurs fichiers devis (upload séparés), sommer aussi leurs totaux
  if (devisTexts.length > 1) {
    let sumTot = 0;
    let found = 0;
    const perFileTotals: number[] = [];
    for (const block of devisTexts) {
      const resolved = resolveProposedTotals(
        amountsAboveAllLabels(block, /Total\s+des\s+cotisations\s+pour/i),
        amountsInlineAfterLabel(block, /Total\s+des\s+cotisations\s+pour/i),
        totalsInlinePret(block),
      );
      if (resolved.total != null && resolved.total > 0) {
        sumTot += resolved.total;
        found += 1;
        perFileTotals.push(resolved.total);
      }
    }
    if (found >= 2) {
      proposedTotalRemaining = Math.round(sumTot * 100) / 100;
      proposedInsuredTotals = perFileTotals;
      reasons.push(`${found} fichiers devis cumulés pour le total proposé.`);
    }
  }

  // Recalcul depuis table annuelle UNIQUEMENT si total officiel absent ou confondu avec le coût 8 ans.
  // Ne jamais remplacer un total officiel par une estimation beaucoup plus haute (double-comptage grilles).
  if (proposedMonthlyByYear.length >= 5 && remainingMonths) {
    const fromTable = sumProposedFromYearTable(proposedMonthlyByYear, remainingMonths);
    const official = proposedTotalRemaining;
    const looksLike8yOnly =
      official != null &&
      proposedTotal8y != null &&
      Math.abs(official - proposedTotal8y) < 0.02;
    if (official == null || looksLike8yOnly) {
      if (official != null && proposedTotal8y == null) proposedTotal8y = official;
      proposedTotalRemaining = fromTable;
      reasons.push("Total proposé recalculé depuis le tableau annuel du devis × durée restante.");
    } else if (
      fromTable > 0 &&
      Math.abs(fromTable - official) / official > 0.25
    ) {
      reasons.push(
        `Table annuelle devis écartée pour le total (table ${fromTable} € vs officiel ${official} €) — risque de double-comptage multi-prêts.`,
      );
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

  // Fees — adhésion + constitution dossier ; jamais les frais de distribution
  let feesAssureurTotal: number | null = extractKereisAssureurFees(devisText);
  let feesCourtierTotal: number | null = null;

  if (feesAssureurTotal == null) {
    const mFeesAssureur =
      devisN.match(/total\s+frais\s+assureur[\s\S]{0,80}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})/i) ||
      devisN.match(/frais\s+assureur[\s\S]{0,80}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})/i) ||
      devisN.match(/frais\s+retenus[\s\S]{0,40}?(\d{1,3}(?:[\s.]\d{3})*,\d{2})/i);
    if (mFeesAssureur?.[1]) feesAssureurTotal = toNumberFR(mFeesAssureur[1]);
  }

  const mFeesCourtier =
    devisN.match(/frais\s+(?:de\s+distribution|de\s+courtage|courtage)[\s\S]{0,80}?(\d{1,3}(?:[\s.]\d{3})*,\d{2}|\d+)\s*(?:euros?|€)?/i) ||
    devisN.match(/total\s+frais\s+(?:lcif|distribution|courtage)[\s\S]{0,80}?(\d{1,3}(?:[\s.]\d{3})*,\d{2}|\d+)/i);
  if (mFeesCourtier?.[1]) {
    const raw = mFeesCourtier[1];
    feesCourtierTotal = toNumberFR(raw.includes(",") ? raw : `${raw},00`);
  }

  const assuresCount = Array.isArray(dossier?.formData?.assures) ? dossier.formData.assures.length : 1;
  const proposedInsuredCount = Math.max(
    proposedInsuredTotals.length,
    insuredBlocks,
    devisTexts.length > 1 ? devisTexts.length : 0,
  ) || 1;
  if (assuresCount > 1 && proposedInsuredCount < assuresCount) {
    reasons.push(
      `Attention: ${assuresCount} assurés sur le dossier mais seulement ${proposedInsuredCount} profil(s) trouvé(s) dans le devis — vérifiez que le PDF Kereis contient bien tous les co-emprunteurs.`,
    );
  } else if (proposedInsuredTotals.length >= 2 && insuredBlocks >= 2) {
    reasons.push(`${proposedInsuredTotals.length} assurés détectés dans le devis Kereis.`);
  } else if (pretTotals.length >= 2 && insuredBlocks <= 1) {
    reasons.push(`${pretTotals.length} prêts détectés sur le devis (même assuré).`);
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
    proposedInsuredTotals: proposedInsuredTotals.length ? proposedInsuredTotals : undefined,
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

