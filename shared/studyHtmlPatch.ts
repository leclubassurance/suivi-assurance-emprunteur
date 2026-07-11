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
