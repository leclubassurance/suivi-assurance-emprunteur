/** Extrait le texte réellement écrit par le client (sans citation du fil Gmail). */
export function extractNewClientMessageText(raw: string): string {
  let text = String(raw || "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";

  const cutPatterns = [
    /\n-{2,}\s*Original Message\s*-+/i,
    /\n-{2,}\s*Message d'origine\s*-+/i,
    /\nOn .+ wrote:\s*\n/i,
    /\nLe\s+.+\s+a\s+[eé]crit\s*:\s*\n/i,
    /\nLe\s+.+\s+a\s+[eé]crit\s*:\s*$/im,
    /\n_{3,}\n/,
    /\n>{1,}\s/,
    /\n\[image:/i,
  ];

  for (const re of cutPatterns) {
    const m = text.match(re);
    if (m?.index != null && m.index > 0) {
      text = text.slice(0, m.index).trim();
      break;
    }
  }

  text = text
    .split("\n")
    .filter((line) => !/^>/.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text || String(raw || "").trim().slice(0, 2000);
}
