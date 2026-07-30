/**
 * Extraction des montants depuis le texte d'un PDF d'étude LCIF.
 * Couvre l'ancien modèle (TEST-ADE-Martin), le modèle personnalisé v2,
 * et le modèle « mensualités » (labels souvent sans accents après extraction PDF).
 */

export type ParsedStudyPdfEconomics = {
  grossSavingsEur: number | null;
  netSavingsEur: number | null;
  feesAssureurEur: number | null;
  currentInsuranceTotalEur: number | null;
  /**
   * Cotisation annuelle proposée.
   * Nouveau template : colonne « Nouvelle assurance » année 1 (déjà annuelle).
   * Ancien template : mensuel année 1 × 12.
   */
  annualPremiumEur: number | null;
  proposedInsuranceTotalEur: number | null;
  proposedMonthlyYear1Eur: number | null;
  /** Montant année 1 « Nouvelle assurance » tel qu'affiché (annuel ou mensuel selon template). */
  proposedYear1RawEur: number | null;
  year1ValuesAreAnnual: boolean;
  loanCapitalEur: number | null;
  plannedChangeDate: string | null;
  savingsPercent: number | null;
  confidence: "high" | "partial" | "low";
  templateVersion: "v1_legacy" | "v2_personnalisee" | "v3_mensualites" | "unknown";
};

const MONTHS_FR: Record<string, number> = {
  janvier: 1,
  fevrier: 2,
  février: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  août: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
  décembre: 12,
};

/** Les extracteurs PDF retirent souvent les accents (Économie → Economie). */
function foldAccents(s: string): string {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function parseEuroToken(raw: string): number | null {
  const s = String(raw || "")
    .replace(/\u00a0/g, " ")
    .replace(/[^\d,.\s]/g, "")
    .trim();
  if (!s) return null;
  const m = s.match(/(\d{1,3}(?:[\s.]\d{3})+|\d+)(?:[,.](\d{2}))?/);
  if (!m) return null;
  const whole = m[1].replace(/[\s.]/g, "");
  const cents = m[2] ?? "00";
  const n = Number(`${whole}.${cents}`);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function amountAfterLabel(text: string, labelRe: RegExp, windowChars = 120): number | null {
  const m = text.match(labelRe);
  if (!m || m.index == null) return null;
  const tail = text.slice(m.index + m[0].length, m.index + m[0].length + windowChars);
  const amt = tail.match(/((?:\d{1,3}(?:[\s\u00a0.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€/);
  return amt ? parseEuroToken(amt[1]) : null;
}

function amountsNearLabel(text: string, labelRe: RegExp, windowChars = 160): number[] {
  const m = text.match(labelRe);
  if (!m || m.index == null) return [];
  const tail = text.slice(m.index + m[0].length, m.index + m[0].length + windowChars);
  const out: number[] = [];
  const re = /((?:\d{1,3}(?:[\s\u00a0.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€/g;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(tail))) {
    const n = parseEuroToken(hit[1]);
    if (n != null) out.push(n);
  }
  return out;
}

function parseFrDateToIso(raw: string): string | null {
  const s = String(raw || "").trim();
  const numeric = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (numeric) {
    const d = Number(numeric[1]);
    const mo = Number(numeric[2]);
    const y = Number(numeric[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const named = s.match(
    /(\d{1,2})\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\s+(\d{4})/i,
  );
  if (!named) return null;
  const d = Number(named[1]);
  const moKey = named[2]
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const mo =
    MONTHS_FR[named[2].toLowerCase()] ||
    MONTHS_FR[moKey] ||
    MONTHS_FR[moKey.replace("fevrier", "février")] ||
    null;
  const y = Number(named[3]);
  if (!mo || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function detectTemplateVersion(text: string): ParsedStudyPdfEconomics["templateVersion"] {
  // Ancien ADE en premier (évite un faux positif « NOUVELLE ASSURANCE »).
  if (/COUT\s+ACTUEL\s+RESTANT/i.test(text) && /ECONOMIE\s+BRUTE/i.test(text)) {
    return "v1_legacy";
  }
  // Modèle personnalisé v2 (cotisations annuelles / tableau frais).
  if (/NOUVELLES\s+COTISATIONS/i.test(text) && /ETUDE\s+PERSONNALISEE/i.test(text)) {
    return "v2_personnalisee";
  }
  // Modèle « mensualités » / synthèse en un regard.
  if (
    /Votre\s+economie\s+en\s+un\s+regard/i.test(text) ||
    /Votre\s+comparaison\s+en\s+un\s+regard/i.test(text) ||
    /Mensualite\s+actuelle\s+Mensualite\s+proposee/i.test(text) ||
    (/Financement\s+Capital\s+assure/i.test(text) && /NOUVELLE\s+ASSURANCE\b/i.test(text)) ||
    (/ECART\s+BRUT\b/i.test(text) && /ASSURANCE\s+ACTUELLE\b/i.test(text) && /NOUVELLE\s+ASSURANCE\b/i.test(text))
  ) {
    return "v3_mensualites";
  }
  if (/Evolution\s+annuelle/i.test(text) || /Prise\s+d['']effet\s+etudiee/i.test(text)) {
    return "v2_personnalisee";
  }
  return "unknown";
}

function parseTotalsRow(text: string): {
  current: number | null;
  proposed: number | null;
  fees: number | null;
  economy: number | null;
  capital: number | null;
} {
  // Tableau détaillé « Assuré / Cotisations / Frais / Total » :
  // TOTAL = cotisations + frais (PAS l'économie). Ex. Lorin : 2 771 + 220 = 2 991.
  const isCotisationsFraisTotalTable =
    /Assuree?\s+Cotisations\s+Frais\s+Total/i.test(text) ||
    /Cotisations\s+Frais\s+Total/i.test(text);

  const hasFeesColumn =
    !isCotisationsFraisTotalTable &&
    /Assuree?\s+Actuelle.*Cotisations.*Frais.*Economie/i.test(text);
  if (hasFeesColumn) {
    const v2 = text.match(
      /TOTAL\s+((?:\d{1,3}(?:[\s\u00a0.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€\s+((?:\d{1,3}(?:[\s\u00a0.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€\s+((?:\d{1,3}(?:[\s\u00a0.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€\s+((?:\d{1,3}(?:[\s\u00a0.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€/i,
    );
    if (v2) {
      return {
        current: parseEuroToken(v2[1]),
        proposed: parseEuroToken(v2[2]),
        fees: parseEuroToken(v2[3]),
        economy: parseEuroToken(v2[4]),
        capital: null,
      };
    }
  }

  const hasCapitalColumn =
    /Financement\s+Capital\s+assure/i.test(text) ||
    /Capital\s+assure\s+Actuelle\s+Proposee\s+Economie/i.test(text) ||
    /Pret\s+immobilier\s+amortissable/i.test(text);
  const fourCols = text.match(
    /TOTAL\s+((?:\d{1,3}(?:[\s\u00a0.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€\s+((?:\d{1,3}(?:[\s\u00a0.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€\s+((?:\d{1,3}(?:[\s\u00a0.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€\s+((?:\d{1,3}(?:[\s\u00a0.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€/i,
  );
  if (fourCols && hasCapitalColumn) {
    return {
      capital: parseEuroToken(fourCols[1]),
      current: parseEuroToken(fourCols[2]),
      proposed: parseEuroToken(fourCols[3]),
      economy: parseEuroToken(fourCols[4]),
      fees: null,
    };
  }

  // Ne pas interpréter « TOTAL cotisations | frais | total TTC » comme économie.
  if (!isCotisationsFraisTotalTable) {
    const v1 = text.match(
      /Total\s+((?:\d{1,3}(?:[\s\u00a0.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€\s+((?:\d{1,3}(?:[\s\u00a0.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€\s+((?:\d{1,3}(?:[\s\u00a0.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€/i,
    );
    if (v1) {
      return {
        current: parseEuroToken(v1[1]),
        proposed: parseEuroToken(v1[2]),
        fees: null,
        economy: parseEuroToken(v1[3]),
        capital: null,
      };
    }
  } else {
    // Extraire au moins les frais depuis ce tableau (2e colonne du TOTAL).
    const feesRow = text.match(
      /TOTAL\s+((?:\d{1,3}(?:[\s\u00a0.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€\s+((?:\d{1,3}(?:[\s\u00a0.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€\s+((?:\d{1,3}(?:[\s\u00a0.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€/i,
    );
    if (feesRow) {
      return {
        current: null,
        proposed: parseEuroToken(feesRow[1]),
        fees: parseEuroToken(feesRow[2]),
        economy: null,
        capital: null,
      };
    }
  }
  return { current: null, proposed: null, fees: null, economy: null, capital: null };
}

function parseYear1Row(text: string): { current: number | null; proposed: number | null } {
  // Année 1 1 348,29 € 443,16 € …  (v2 annuel / v1)
  const m = text.match(
    /Annee\s*1\s+((?:\d{1,3}(?:[\s.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€\s+((?:\d{1,3}(?:[\s.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€/i,
  );
  if (m) return { current: parseEuroToken(m[1]), proposed: parseEuroToken(m[2]) };

  // Modèle mensualités : tableau « 1 10,73 € 6,05 € 4,68 € 56,22 € »
  const m2 = text.match(
    /(?:^|\n)\s*1\s+((?:\d{1,3}(?:[\s.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€\s+((?:\d{1,3}(?:[\s.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€/m,
  );
  if (m2 && /Mensualite\s+actuelle\s+Mensualite\s+proposee/i.test(text)) {
    return { current: parseEuroToken(m2[1]), proposed: parseEuroToken(m2[2]) };
  }
  return { current: null, proposed: null };
}

function year1LooksAnnual(text: string, year1Proposed: number | null, template: string): boolean {
  // Tableau explicitement en mensualités.
  if (
    /Tableau\s+comparatif\s+mensuel/i.test(text) ||
    /Eco\.\s*nette\s*\/\s*mois/i.test(text) ||
    /Actuelle\s*\/\s*mois/i.test(text) ||
    /Nouvelle\s*\/\s*mois/i.test(text) ||
    /cotisations\s*\/\s*mois|proposee\s*\/\s*mois|par\s+mois/i.test(text) ||
    /Mensualite\s+actuelle\s+Mensualite\s+proposee/i.test(text)
  ) {
    return false;
  }
  if (template === "v3_mensualites") return false;
  if (template === "v2_personnalisee") return true;
  if (template === "v1_legacy") {
    return /Evolution\s+annuelle|annee\s+contractuelle/i.test(text);
  }
  if (/Evolution\s+annuelle/i.test(text) || /annee\s+contractuelle/i.test(text)) return true;
  if (year1Proposed != null && year1Proposed > 400) return true;
  return false;
}

function nearlyEqual(a: number, b: number, tol = 1.5): boolean {
  return Math.abs(a - b) <= tol;
}

/** Parse le texte brut extrait du PDF d'étude. */
export function parseStudyEconomicsFromPdfText(rawText: string): ParsedStudyPdfEconomics {
  const text = foldAccents(String(rawText || ""))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");

  const templateVersion = detectTemplateVersion(text);
  const totals = parseTotalsRow(text);
  const year1 = parseYear1Row(text);

  let gross =
    amountAfterLabel(text, /Economie\s+brute\s*:/i) ??
    amountAfterLabel(text, /ECONOMIE\s+BRUTE\b/i, 60) ??
    amountAfterLabel(text, /Economie\s+brute\b/i, 60) ??
    // Nouveau template comparative : « Écart brut » (souvent sans « économie brute »).
    amountAfterLabel(text, /Ecart\s+brut\s*:/i, 40) ??
    amountAfterLabel(text, /ECART\s+BRUT\b/i, 40) ??
    amountAfterLabel(text, /TOTAL\s+SUR\s+LA\s+DUREE\b/i, 40);

  if (gross == null) {
    const near = amountsNearLabel(text, /ECONOMIE\s+BRUTE\b/i, 80);
    if (near[0] != null) gross = near[0];
  }
  if (gross == null) {
    const nearEcart = amountsNearLabel(text, /ECART\s+BRUT\b/i, 60);
    if (nearEcart[0] != null) gross = nearEcart[0];
  }
  if (gross == null && totals.economy != null) {
    gross = totals.economy;
  }

  let net =
    amountAfterLabel(text, /ECONOMIE\s+NETTE\s+TOTALE\b/i) ??
    amountAfterLabel(text, /VOTRE\s+ECONOMIE\s+NETTE\s+ESTIMEE\b/i, 80) ??
    amountAfterLabel(text, /Economie\s+nette\b/i, 60) ??
    amountAfterLabel(text, /ECONOMIE\s+NETTE(?:\s+ESTIMEE)?\b/i, 60);

  if (net == null) {
    const near = amountsNearLabel(text, /VOTRE\s+ECONOMIE\s+NETTE\s+ESTIMEE\b/i, 100);
    if (near[0] != null) net = near[0];
  }

  let labeledCurrent =
    amountAfterLabel(text, /ASSURANCE\s+ACTUELLE\b/i, 60) ??
    amountAfterLabel(text, /COUT\s+ACTUEL\s+RESTANT\b/i) ??
    amountAfterLabel(text, /Assurance\s+actuelle\b/i, 50);
  if (labeledCurrent == null) {
    labeledCurrent = amountsNearLabel(text, /ASSURANCE\s+ACTUELLE\b/i, 80)[0] ?? null;
  }

  let labeledProposed =
    amountAfterLabel(text, /NOUVELLES\s+COTISATIONS\b/i, 60) ??
    amountAfterLabel(text, /NOUVELLE\s+ASSURANCE\b/i, 60) ??
    amountAfterLabel(text, /NOUVELLE\s+SOLUTION\b/i, 60) ??
    amountAfterLabel(text, /Nouvelle\s+solution\b/i, 60);
  if (labeledProposed == null) {
    labeledProposed =
      amountsNearLabel(text, /NOUVELLES\s+COTISATIONS\b/i, 80)[0] ??
      amountsNearLabel(text, /NOUVELLE\s+ASSURANCE\b/i, 80)[0] ??
      null;
  }

  // v1 : le TOTAL est fiable. v2/v3 : les blocs labelés évitent de prendre le capital.
  let currentTotal: number | null;
  let proposedTotal: number | null;
  if (templateVersion === "v1_legacy") {
    currentTotal = totals.current ?? labeledCurrent;
    proposedTotal = totals.proposed ?? labeledProposed;
  } else {
    currentTotal = labeledCurrent ?? totals.current;
    proposedTotal = labeledProposed ?? totals.proposed;
  }

  let feesAssureur =
    amountAfterLabel(text, /Frais\s+retenus\s+deduits\s*:/i, 40) ??
    amountAfterLabel(text, /frais\s+retenus\s+de\s+la\s+nouvelle\s+assurance\s*:/i, 40) ??
    amountAfterLabel(text, /Frais\s+de\s+dossier\s+inclus\s+dans\s+le\s+calcul\s*:/i, 40) ??
    amountAfterLabel(
      text,
      /Apres\s+deduction\s+des\s+frais\s+de\s+dossier\s+appliques\s+par\s+la\s+nouvelle\s+assurance\s*:/i,
      40,
    ) ??
    null;

  if (feesAssureur == null) {
    const m = text.match(
      /(\d{1,3}(?:[\s\u00a0.]\d{3})*(?:[,.]\d{2})?)\s*€\s+de\s+frais\s+de\s+dossier/i,
    );
    if (m) feesAssureur = parseEuroToken(m[1]);
  }

  if (
    feesAssureur == null &&
    totals.fees != null &&
    (gross == null || totals.fees < gross * 0.5) &&
    (currentTotal == null || totals.fees < currentTotal * 0.25)
  ) {
    feesAssureur = totals.fees;
  }

  if (feesAssureur == null && templateVersion !== "v2_personnalisee") {
    const m = text.match(/Frais\s+de\s+dossier\s+(\d{1,3}(?:[\s.]\d{3})*(?:[,.]\d{2})?)\s*€/i);
    if (m) feesAssureur = parseEuroToken(m[1]);
  }

  const proposedWithFees = amountAfterLabel(
    text,
    /Nouvelle\s+assurance,\s*frais\s+inclus\b/i,
    50,
  );
  if (
    proposedTotal == null &&
    proposedWithFees != null &&
    feesAssureur != null &&
    proposedWithFees > feesAssureur
  ) {
    proposedTotal = Math.round((proposedWithFees - feesAssureur) * 100) / 100;
  }

  if (currentTotal != null && proposedTotal != null && currentTotal >= proposedTotal) {
    const derivedGross = Math.round((currentTotal - proposedTotal) * 100) / 100;
    if (gross == null) {
      gross = derivedGross;
    } else if (!nearlyEqual(gross, derivedGross) && nearlyEqual(gross, proposedTotal)) {
      // Bug classique : économie = colonne « nouvelle assurance » (ex. 1 430 au lieu de 710).
      gross = derivedGross;
    } else if (
      !nearlyEqual(gross, derivedGross) &&
      feesAssureur != null &&
      nearlyEqual(gross, proposedTotal + feesAssureur)
    ) {
      // Bug Lorin / tableau Cotisations+Frais=Total : 2 771 + 220 = 2 991 pris pour l'économie.
      gross = derivedGross;
    } else if (
      !nearlyEqual(gross, derivedGross) &&
      totals.capital != null &&
      nearlyEqual(currentTotal, totals.capital)
    ) {
      if (totals.current != null && totals.proposed != null && totals.economy != null) {
        currentTotal = totals.current;
        proposedTotal = totals.proposed;
        gross = totals.economy;
      }
    } else if (
      !nearlyEqual(gross, derivedGross) &&
      derivedGross > 0 &&
      gross > derivedGross * 2 &&
      (templateVersion === "v3_mensualites" || templateVersion === "v2_personnalisee")
    ) {
      // Écart labelé / actuelle−proposée fiable : ne pas garder un gross aberrant (souvent total TTC).
      gross = derivedGross;
    }
  }

  if (
    proposedTotal == null &&
    currentTotal != null &&
    gross != null &&
    currentTotal >= gross
  ) {
    proposedTotal = Math.round((currentTotal - gross) * 100) / 100;
  }

  const year1IsAnnual = year1LooksAnnual(text, year1.proposed, templateVersion);
  const proposedYear1RawEur = year1.proposed;
  let proposedMonthlyYear1: number | null = null;
  let annualPremiumEur: number | null = null;
  if (year1.proposed != null) {
    if (year1IsAnnual) {
      annualPremiumEur = year1.proposed;
      proposedMonthlyYear1 = Math.round((year1.proposed / 12) * 100) / 100;
    } else {
      proposedMonthlyYear1 = year1.proposed;
      annualPremiumEur = Math.round(year1.proposed * 12 * 100) / 100;
    }
  }

  let loanCapitalEur: number | null = totals.capital;
  const capital =
    text.match(/Part\s+assuree\s+retenue\s*:\s*((?:\d{1,3}(?:[\s.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€/i) ||
    text.match(/Capital\s+assure\s*:\s*((?:\d{1,3}(?:[\s.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€/i) ||
    text.match(/Pret\s+immobilier\s+amortissable\s+((?:\d{1,3}(?:[\s.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€/i) ||
    text.match(/Pret\s+immobilier\s*[—–\-]\s*(\d{1,3}(?:[\s.]\d{3})+|\d+)\s*€/i) ||
    text.match(/capital\s+(?:initial|emprunte|restant)\s*[:=]?\s*(\d{1,3}(?:[\s.]\d{3})+|\d+)\s*€/i) ||
    text.match(/montant\s+(?:du\s+)?pret\s*[:=]?\s*(\d{1,3}(?:[\s.]\d{3})+|\d+)\s*€/i);
  if (capital?.[1]) {
    const n = parseEuroToken(capital[1]) ?? Number(String(capital[1]).replace(/[\s.]/g, ""));
    if (Number.isFinite(n) && n > 0) loanCapitalEur = n;
  }

  let plannedChangeDate: string | null = null;
  const datePatterns = [
    /Prise\s+d['']effet\s+etudiee\s*:\s*(\d{1,2}\s+[a-zeuo]+\s+\d{4})/i,
    /date\s+d['']effet\s+du\s+(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i,
    /a\s+compter\s+de\s+la\s+date\s+d['']effet\s+du\s+(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i,
    /prise\s+d['']effet\s*[:=]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4}|\d{1,2}\s+[a-zeuo]+\s+\d{4})/i,
    /a\s+compter\s+du\s+(\d{1,2}\s+[a-zeuo]+\s+\d{4})/i,
    /Les\s+montants\s+sont\s+regroupes\s+par\s+annee\s+contractuelle\s+a\s+compter\s+du\s+(\d{1,2}\s+[a-zeuo]+\s+\d{4})/i,
    /du\s+(\d{1,2}\s+[a-zeuo]+\s+\d{4})\s+au\s+\d{1,2}\s+[a-zeuo]+\s+\d{4}/i,
  ];
  for (const re of datePatterns) {
    const dateM = text.match(re);
    if (dateM?.[1]) {
      plannedChangeDate = parseFrDateToIso(dateM[1]);
      if (plannedChangeDate) break;
    }
  }

  let savingsPercent: number | null = null;
  const pct =
    text.match(/(\d+(?:[,.]\d+)?)\s*%\s*D['']?ECONOMIE/i) ||
    text.match(/soit\s+(-?\d+(?:[,.]\d+)?)\s*%/i);
  if (pct?.[1]) {
    const n = Number(pct[1].replace(",", "."));
    if (Number.isFinite(n)) savingsPercent = Math.abs(n);
  } else if (gross != null && currentTotal != null && currentTotal > 0) {
    savingsPercent = Math.round((gross / currentTotal) * 1000) / 10;
  }

  const filled = [gross, feesAssureur, currentTotal, proposedTotal, annualPremiumEur].filter(
    (v) => v != null,
  ).length;
  const confidence: ParsedStudyPdfEconomics["confidence"] =
    gross != null && filled >= 4 ? "high" : gross != null ? "partial" : "low";

  return {
    grossSavingsEur: gross,
    netSavingsEur: net,
    feesAssureurEur: feesAssureur,
    currentInsuranceTotalEur: currentTotal,
    proposedInsuranceTotalEur: proposedTotal,
    annualPremiumEur,
    proposedMonthlyYear1Eur: proposedMonthlyYear1,
    proposedYear1RawEur,
    year1ValuesAreAnnual: year1IsAnnual,
    loanCapitalEur,
    plannedChangeDate,
    savingsPercent,
    confidence,
    templateVersion,
  };
}
