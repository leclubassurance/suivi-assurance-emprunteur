/** Patch ciblé de la ligne « Frais de courtage » dans un HTML d'étude. */

export function formatEuroFr(amount: number): string {
  const n = Math.round(Number(amount) * 100) / 100;
  const [whole, frac] = n.toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
  return `${grouped},${frac}\u00a0€`;
}

/**
 * Remplace le montant après « Frais de courtage : » sans laisser l'ancien montant
 * (bug fréquent : « 190,00 € 190 € » quand le template a déjà un <strong>190&nbsp;€</strong>).
 */
const BROKERAGE_AMOUNT_RES: Array<{ re: RegExp; wrap: (formatted: string) => string }> = [
  // Template brandé PDF : « Frais de courtage :</span> <strong>190&nbsp;€</strong> »
  {
    re: /(Frais de courtage\s*:\s*<\/span>\s*)<strong>[^<]*<\/strong>/i,
    wrap: (f) => `$1<strong>${f}</strong>`,
  },
  // « Frais de courtage : <strong>…</strong> »
  {
    re: /(Frais de courtage\s*:\s*)<strong>[^<]*<\/strong>/i,
    wrap: (f) => `$1<strong>${f}</strong>`,
  },
  // Draft économies : « Frais de courtage :</span> <span>…</span> »
  {
    re: /(Frais de courtage\s*:\s*<\/span>\s*)<span[^>]*>[^<]*<\/span>/i,
    wrap: (f) => `$1<span>${f}</span>`,
  },
  {
    re: /(Frais de courtage\s*:\s*)<\/span>\s*<span[^>]*>[^<]*<\/span>/i,
    wrap: (f) => `$1</span> <span>${f}</span>`,
  },
  {
    re: /(Frais de courtage\s*:\s*)<b>[^<]*<\/b>/i,
    wrap: (f) => `$1<strong>${f}</strong>`,
  },
  // Plain text / table cell amount after the label
  {
    re: /(Frais de courtage\s*:?\s*)(\d{1,3}(?:[\s\u00a0.]\d{3})*(?:[,.]\d{2})?\s*(?:&nbsp;|\u00a0)?€)/i,
    wrap: (f) => `$1${f}`,
  },
];

export function hasBrokerageFeeLine(html: string): boolean {
  const h = String(html || "");
  return /Frais de courtage/i.test(h);
}

export function patchStudyHtmlBrokerageFee(
  html: string,
  totalEur: number,
): { html: string; patched: boolean } {
  const formatted = formatEuroFr(totalEur);
  const source = String(html || "");
  for (const { re, wrap } of BROKERAGE_AMOUNT_RES) {
    if (re.test(source)) {
      return { html: source.replace(re, wrap(formatted)), patched: true };
    }
  }
  return { html: source, patched: false };
}

const MONTHS_FR = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

export function formatPlannedChangeDateFr(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return `${d} ${MONTHS_FR[m - 1] || m} ${y}`;
}

const PLANNED_DATE_RES = [
  /(Date de changement prévue\s*:\s*)<strong>[^<]*<\/strong>/i,
  /(Date de changement prévue\s*:\s*)(?:<strong>)?[^<\n]{4,48}(?:<\/strong>)?/i,
  /(Changement prévu\s*(?:le|:)\s*)<strong>[^<]*<\/strong>/i,
  /(Changement prévu\s*(?:le|:)\s*)(?:<strong>)?[^<\n]{4,48}(?:<\/strong>)?/i,
  /(changement\s+prévu\s*(?:le|:)\s*)<strong>[^<]*<\/strong>/i,
  /(changement\s+prévu\s*(?:le|:)\s*)(?:<strong>)?[^<\n]{4,48}(?:<\/strong>)?/i,
  /((?:effectif|à partir)\s+(?:le|du)\s*)<strong>[^<]*<\/strong>/i,
  /((?:effectif|à partir)\s+(?:le|du)\s*)(?:<strong>)?[^<\n]{4,48}(?:<\/strong>)?/i,
];

const FRENCH_DATE_IN_CHANGE_LINE =
  /((?:date\s+(?:de\s+)?changement|changement\s+pr[ée]vu|effectif|à partir)[^<\n]{0,80}?)(\d{1,2}\s+(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+\d{4})/i;

function buildPlannedDateBlock(label: string): string {
  return `<p style="font-size:14px;margin:0 0 16px 0;color:#1F2937;">Date de changement prévue : <strong>${label}</strong></p>`;
}

/** Ligne habituelle des études manuelles — seul point d'insertion automatique. */
const BANK_DEADLINE_LINE_RE =
  /(<(?:p|li)[^>]*>[\s\S]*?10\s+jours\s+ouvr[\s\S]*?r[ée]silie[\s\S]*?<\/(?:p|li)>)/i;

function insertPlannedDateBlock(html: string, block: string): { html: string; patched: boolean } {
  if (BANK_DEADLINE_LINE_RE.test(html)) {
    return { html: html.replace(BANK_DEADLINE_LINE_RE, `$1\n${block}`), patched: true };
  }
  return { html, patched: false };
}

export function patchStudyHtmlPlannedDate(
  html: string,
  isoDate: string,
): { html: string; patched: boolean } {
  const label = formatPlannedChangeDateFr(isoDate);
  for (const re of PLANNED_DATE_RES) {
    if (re.test(html)) {
      return { html: html.replace(re, `$1<strong>${label}</strong>`), patched: true };
    }
  }

  if (FRENCH_DATE_IN_CHANGE_LINE.test(html)) {
    return {
      html: html.replace(FRENCH_DATE_IN_CHANGE_LINE, `$1<strong>${label}</strong>`),
      patched: true,
    };
  }

  return insertPlannedDateBlock(html, buildPlannedDateBlock(label));
}
