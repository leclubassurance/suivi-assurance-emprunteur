/**
 * Extraction des montants depuis le texte d'un PDF d'étude LCIF.
 * Couvre l'ancien modèle (TEST-ADE-Martin) et le nouveau
 * (Étude personnalisée — ASSURANCE ACTUELLE / NOUVELLES COTISATIONS).
 */

export type ParsedStudyPdfEconomics = {
  grossSavingsEur: number | null;
  netSavingsEur: number | null;
  feesAssureurEur: number | null;
  currentInsuranceTotalEur: number | null;
  proposedInsuranceTotalEur: number | null;
  /**
   * Cotisation annuelle proposée.
   * Nouveau template : colonne « Nouvelle assurance » année 1 (déjà annuelle).
   * Ancien template : mensuel année 1 × 12.
   */
  annualPremiumEur: number | null;
  proposedMonthlyYear1Eur: number | null;
  /** Montant année 1 « Nouvelle assurance » tel qu'affiché (annuel ou mensuel selon template). */
  proposedYear1RawEur: number | null;
  year1ValuesAreAnnual: boolean;
  loanCapitalEur: number | null;
  plannedChangeDate: string | null;
  savingsPercent: number | null;
  confidence: "high" | "partial" | "low";
  templateVersion: "v1_legacy" | "v2_personnalisee" | "unknown";
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

function parseEuroToken(raw: string): number | null {
  const s = String(raw || "")
    .replace(/\u00a0/g, " ")
    .replace(/[^\d,.\s]/g, "")
    .trim();
  if (!s) return null;
  // Préférer « 7 883,32 » (groupes de milliers) OU « 7883,32 » (entier libre).
  // Évite le piège \d{1,3} qui matchait « 883 » dans « 7883,32 ».
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

/** Tous les montants € immédiatement après un label (utile pour blocs multi-lignes). */
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
  if (/NOUVELLES\s+COTISATIONS/i.test(text) && /ÉTUDE\s+PERSONNALIS[ÉE]E/i.test(text)) {
    return "v2_personnalisee";
  }
  if (/CO[ÛU]T\s+ACTUEL\s+RESTANT/i.test(text) && /ÉCONOMIE\s+BRUTE/i.test(text)) {
    return "v1_legacy";
  }
  if (/Évolution\s+annuelle/i.test(text) || /Prise\s+d['’]effet\s+[ée]tudi[ée]e/i.test(text)) {
    return "v2_personnalisee";
  }
  return "unknown";
}

/** Ligne Total / ventilation : actuelle | nouvelle | (frais) | économie. */
function parseTotalsRow(text: string): {
  current: number | null;
  proposed: number | null;
  fees: number | null;
  economy: number | null;
} {
  // Nouveau (4 cols) uniquement si l'en-tête contient Frais — évite Total…économie…économie en v1.
  const hasFeesColumn = /Assur[ée]e?\s+Actuelle.*Cotisations.*Frais.*Économie/i.test(text);
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
      };
    }
  }
  // Ancien : Total 16 503,39 € 8 235,02 € 8 268,37 €
  const v1 = text.match(
    /Total\s+((?:\d{1,3}(?:[\s\u00a0.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€\s+((?:\d{1,3}(?:[\s\u00a0.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€\s+((?:\d{1,3}(?:[\s\u00a0.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€/i,
  );
  if (v1) {
    return {
      current: parseEuroToken(v1[1]),
      proposed: parseEuroToken(v1[2]),
      fees: null,
      economy: parseEuroToken(v1[3]),
    };
  }
  return { current: null, proposed: null, fees: null, economy: null };
}

function parseYear1Row(text: string): { current: number | null; proposed: number | null } {
  // Année 1 1 348,29 € 443,16 € 735,13 € 735,13 €  (v2 annuel)
  // Année 1 849,96 € 790,42 € 59,54 € 59,54 €     (v1 mensuel possible)
  const m = text.match(
    /Ann[ée]e\s*1\s+((?:\d{1,3}(?:[\s.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€\s+((?:\d{1,3}(?:[\s.]\d{3})+|\d+)(?:[,.]\d{2})?)\s*€/i,
  );
  if (!m) return { current: null, proposed: null };
  return { current: parseEuroToken(m[1]), proposed: parseEuroToken(m[2]) };
}

function year1LooksAnnual(text: string, year1Proposed: number | null, template: string): boolean {
  // Nouveau tableau comparatif : colonnes « / mois »
  if (
    /Tableau\s+comparatif\s+mensuel/i.test(text) ||
    /Éco\.\s*nette\s*\/\s*mois/i.test(text) ||
    /Actuelle\s*\/\s*mois/i.test(text) ||
    /Nouvelle\s*\/\s*mois/i.test(text) ||
    /cotisations\s*\/\s*mois|propos[ée]e\s*\/\s*mois|par\s+mois/i.test(text)
  ) {
    return false;
  }
  if (template === "v2_personnalisee") return true;
  if (template === "v1_legacy") {
    // Ancien modèle ADE : cotisations mensuelles dans le tableau.
    return /Évolution\s+annuelle|année\s+contractuelle/i.test(text);
  }
  if (/Évolution\s+annuelle/i.test(text) || /année\s+contractuelle/i.test(text)) return true;
  // Inconnu : > 400 € en année 1 → plutôt annuel.
  if (year1Proposed != null && year1Proposed > 400) return true;
  return false;
}

/** Parse le texte brut extrait du PDF d'étude. */
export function parseStudyEconomicsFromPdfText(rawText: string): ParsedStudyPdfEconomics {
  const text = String(rawText || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");

  const templateVersion = detectTemplateVersion(text);
  const totals = parseTotalsRow(text);
  const year1 = parseYear1Row(text);

  // --- Économie brute ---
  let gross =
    amountAfterLabel(text, /Économie\s+brute\s*:/i) ??
    amountAfterLabel(text, /ÉCONOMIE\s+BRUTE\b/i, 60) ??
    amountAfterLabel(text, /Économie\s+brute\b/i, 60) ??
    totals.economy;

  // Bloc hero v2 : « ÉCONOMIE BRUTE\n7 883,32 € »
  if (gross == null) {
    const near = amountsNearLabel(text, /ÉCONOMIE\s+BRUTE\b/i, 80);
    if (near[0] != null) gross = near[0];
  }

  // --- Économie nette ---
  let net =
    amountAfterLabel(text, /ÉCONOMIE\s+NETTE\s+TOTALE\b/i) ??
    amountAfterLabel(text, /VOTRE\s+ÉCONOMIE\s+NETTE\s+ESTIM[ÉE]E\b/i, 80) ??
    amountAfterLabel(text, /Économie\s+nette\b/i, 60) ??
    amountAfterLabel(text, /ÉCONOMIE\s+NETTE(?:\s+ESTIM[ÉE]E)?\b/i, 60);

  if (net == null) {
    const near = amountsNearLabel(text, /VOTRE\s+ÉCONOMIE\s+NETTE\s+ESTIM[ÉE]E\b/i, 100);
    if (near[0] != null) net = near[0];
  }

  // --- Coûts restants (avant frais : utile pour valider totals.fees) ---
  let currentTotal =
    totals.current ??
    amountAfterLabel(text, /ASSURANCE\s+ACTUELLE\b/i, 60) ??
    amountAfterLabel(text, /CO[ÛU]T\s+ACTUEL\s+RESTANT\b/i) ??
    amountAfterLabel(text, /Assurance\s+actuelle\b/i, 50);

  if (currentTotal == null) {
    const near = amountsNearLabel(text, /ASSURANCE\s+ACTUELLE\b/i, 80);
    if (near[0] != null) currentTotal = near[0];
  }

  // --- Frais dossier / frais retenus (PAS le coût actuel ni l'économie) ---
  let feesAssureur =
    amountAfterLabel(text, /Frais\s+retenus\s+d[ée]duits\s*:/i, 40) ??
    amountAfterLabel(text, /frais\s+retenus\s+de\s+la\s+nouvelle\s+assurance\s*:/i, 40) ??
    null;

  if (feesAssureur == null) {
    const m = text.match(
      /(\d{1,3}(?:[\s\u00a0.]\d{3})*(?:[,.]\d{2})?)\s*€\s+de\s+frais\s+de\s+dossier/i,
    );
    if (m) feesAssureur = parseEuroToken(m[1]);
  }

  // Totaux v2 « Frais » — uniquement si plausible (<< économie / coût actuel).
  if (
    feesAssureur == null &&
    totals.fees != null &&
    (gross == null || totals.fees < gross * 0.5) &&
    (currentTotal == null || totals.fees < currentTotal * 0.25)
  ) {
    feesAssureur = totals.fees;
  }

  // Ancien template : « Frais de dossier 0,00 € » collé au label.
  if (feesAssureur == null && templateVersion !== "v2_personnalisee") {
    const m = text.match(/Frais\s+de\s+dossier\s+(\d{1,3}(?:[\s.]\d{3})*(?:[,.]\d{2})?)\s*€/i);
    if (m) feesAssureur = parseEuroToken(m[1]);
  }

  let proposedTotal =
    totals.proposed ??
    amountAfterLabel(text, /NOUVELLES\s+COTISATIONS\b/i, 60) ??
    amountAfterLabel(text, /NOUVELLE\s+SOLUTION\b/i, 60) ??
    amountAfterLabel(text, /Nouvelle\s+solution\b/i, 60) ??
    amountAfterLabel(text, /Nouvelle\s+assurance(?:,\s*frais\s+inclus)?\b/i, 50);

  if (proposedTotal == null) {
    const near = amountsNearLabel(text, /NOUVELLES\s+COTISATIONS\b/i, 80);
    if (near[0] != null) proposedTotal = near[0];
  }

  // « Nouvelle assurance, frais inclus » = cotisations + frais — si on a frais, préférer cotisations seules.
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

  if (
    proposedTotal == null &&
    currentTotal != null &&
    gross != null &&
    currentTotal >= gross
  ) {
    proposedTotal = Math.round((currentTotal - gross) * 100) / 100;
  }
  if (
    gross == null &&
    currentTotal != null &&
    proposedTotal != null &&
    currentTotal >= proposedTotal
  ) {
    gross = Math.round((currentTotal - proposedTotal) * 100) / 100;
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

  let loanCapitalEur: number | null = null;
  const capital =
    text.match(/Prêt\s+immobilier\s*[—–\-]\s*(\d{1,3}(?:[\s.]\d{3})+|\d+)\s*€/i) ||
    text.match(/capital\s+(?:initial|emprunté|restant)\s*[:=]?\s*(\d{1,3}(?:[\s.]\d{3})+|\d+)\s*€/i) ||
    text.match(/montant\s+(?:du\s+)?prêt\s*[:=]?\s*(\d{1,3}(?:[\s.]\d{3})+|\d+)\s*€/i) ||
    text.match(/part\s+assur[ée]e[^\d]{0,40}?(\d{1,3}(?:[\s.]\d{3})+)\s*€/i);
  if (capital?.[1]) {
    const n = Number(capital[1].replace(/[\s.]/g, ""));
    if (Number.isFinite(n) && n > 0) loanCapitalEur = n;
  }

  let plannedChangeDate: string | null = null;
  const datePatterns = [
    /Prise\s+d['’]effet\s+[ée]tudi[ée]e\s*:\s*(\d{1,2}\s+[a-zéûô]+\s+\d{4})/i,
    /date\s+d['’]effet\s+du\s+(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i,
    /à\s+compter\s+de\s+la\s+date\s+d['’]effet\s+du\s+(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})/i,
    /prise\s+d['’]effet\s*[:=]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4}|\d{1,2}\s+[a-zéûô]+\s+\d{4})/i,
    /à\s+compter\s+du\s+(\d{1,2}\s+[a-zéûô]+\s+\d{4})/i,
    /du\s+(\d{1,2}\s+[a-zéûô]+\s+\d{4})\s+au\s+\d{1,2}\s+[a-zéûô]+\s+\d{4}/i,
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
    text.match(/(\d+(?:[,.]\d+)?)\s*%\s*D['’]?ÉCONOMIE/i) ||
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
