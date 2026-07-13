/** Patch ciblé de la ligne « Frais de courtage » dans un HTML d'étude manuel. */

export function formatEuroFr(amount: number): string {
  const n = Math.round(Number(amount) * 100) / 100;
  const [whole, frac] = n.toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${grouped},${frac} €`;
}

const BROKERAGE_LINE_RES = [
  /(Frais de courtage\s*:\s*)<strong>[^<]*<\/strong>/i,
  /(Frais de courtage\s*:\s*)<\/span>\s*<span[^>]*>[^<]*<\/span>/i,
  /(Frais de courtage\s*:\s*)<b>[^<]*<\/b>/i,
];

export function hasBrokerageFeeLine(html: string): boolean {
  const h = String(html || "");
  return BROKERAGE_LINE_RES.some((re) => re.test(h)) || /Frais de courtage/i.test(h);
}

export function patchStudyHtmlBrokerageFee(
  html: string,
  totalEur: number,
): { html: string; patched: boolean } {
  const formatted = formatEuroFr(totalEur);
  const replacement = `$1<strong>${formatted}</strong>`;
  for (const re of BROKERAGE_LINE_RES) {
    if (re.test(html)) {
      return { html: html.replace(re, replacement), patched: true };
    }
  }
  const fallback = html.replace(
    /(Frais de courtage\s*:\s*)(?:<strong>)?[^<\n]{0,40}(?:<\/strong>)?/i,
    `$1<strong>${formatted}</strong>`,
  );
  return { html: fallback, patched: fallback !== html };
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
  /(Changement prévu\s*(?:le|:)\s*)<strong>[^<]*<\/strong>/i,
  /(changement\s+prévu\s*(?:le|:)\s*)<strong>[^<]*<\/strong>/i,
];

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

  const block = `<p style="font-size:14px;margin:0 0 16px 0;color:#1F2937;">Date de changement prévue : <strong>${label}</strong></p>`;
  const anchor = /(<p style="font-size:16px;margin:0 0 16px 0;color:#1F2937;">Bonjour[^<]*<\/p>)/i;
  if (anchor.test(html)) {
    return { html: html.replace(anchor, `$1\n${block}`), patched: true };
  }
  return { html: `${block}\n${html}`, patched: true };
}
