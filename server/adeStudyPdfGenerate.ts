import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import type { AdeStudyComputation, AdeYearRow } from "./adeStudyCompute";

/**
 * Étude ADE — présentation client 7 pages (pdfkit).
 * Repère pdfkit : origine EN HAUT À GAUCHE. Les positions ci-dessous sont
 * exprimées en « baseline depuis le haut de page ».
 */

const W = 595.28;
const H = 841.89;
const TOTAL_PAGES = 7;
/** Ascender Helvetica (718/1000) : pdfkit place le haut de la ligne, pas la baseline. */
const ASCENDER = 0.718;

const BLUE = "#1E3A8A";
const DEEP = "#142C65";
const MID_BLUE = "#2563EB";
const LIGHT_BLUE = "#EFF6FF";
const BORDER_BLUE = "#BFDBFE";
const TRACK_BLUE = "#DBEAFE";
const GREEN = "#15803D";
const LIGHT_GREEN = "#F0FDF4";
const BORDER_GREEN = "#86EFAC";
const ORANGE = "#C2410C";
const LIGHT_ORANGE = "#FFF7ED";
const BORDER_ORANGE = "#FDBA74";
const GREY = "#64748B";
const LINE = "#D7E1EF";
const RED = "#DC2626";
const BLACK = "#0F172A";
const WHITE = "#FFFFFF";

/** Lignes de garanties par défaut (référence skill LCIF). */
export const DEFAULT_ADE_GUARANTEES: AdeStudyComputation["guarantees"] = [
  { label: "Décès / PTIA", current: "Prévue", proposed: "Prévue" },
  { label: "Incapacité temporaire de travail", current: "Prévue", proposed: "Prévue - franchise 90 jours" },
  { label: "Invalidité permanente totale", current: "Prévue", proposed: "Prévue" },
  { label: "Invalidité permanente partielle", current: "Non mentionnée", proposed: "Prévue à partir de 33 %" },
  {
    label: "Affections dorsales / psychiques",
    current: "Conditions à vérifier",
    proposed: "Prévue sans condition d'hospitalisation",
  },
  { label: "Indemnisation forfaitaire", current: "Option facultative choisie", proposed: "Prévue" },
  { label: "Quotité", current: "100 % par assuré", proposed: "100 % par assuré" },
];

const LCIF_SERVICES = [
  "Analyse objective du contrat et de l'échéancier",
  "Vérification de l'équivalence des garanties",
  "Constitution du dossier de substitution",
  "Transmission et suivi auprès de la banque",
  "Accompagnement jusqu'à la prise d'effet",
  "Un interlocuteur dédié pendant la démarche",
];

const GENERIC_LEMOINE_TEXT =
  "Les conditions d'exonération (plafond 200 000 € par personne et fin du prêt avant 60 ans) s'apprécient " +
  "sur l'ensemble des encours. Aucune démarche médicale n'est à anticiper : l'assureur indiquera lui-même " +
  "si un questionnaire est requis.";

// ---------------------------------------------------------------- formatage

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** « 7 713,32 € » — espaces NORMALES (les espaces fines cassent pdfkit / pdf-parse). */
function eur(value: number): string {
  const safe = Number.isFinite(value) ? round2(value) : 0;
  const negative = safe < 0;
  const [whole, cents] = Math.abs(safe).toFixed(2).split(".");
  return `${negative ? "-" : ""}${groupThousands(whole)},${cents} €`;
}

function eurInt(value: number): string {
  const safe = Number.isFinite(value) ? Math.round(value) : 0;
  const negative = safe < 0;
  return `${negative ? "-" : ""}${groupThousands(String(Math.abs(safe)))} €`;
}

function pct(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `${safe.toFixed(1).replace(".", ",")} %`;
}

function formatFrLong(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return String(iso || "");
  try {
    // Format « 27 octobre 2026 » — conservé tel quel (le parseur d'étude lit cette forme).
    return new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function addMonthsIso(iso: string, months: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const index = m - 1 + months;
  const year = y + Math.floor(index / 12);
  const month = ((index % 12) + 12) % 12;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const day = Math.min(d, daysInMonth);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- assets

function resolveAssetPath(fileName: string): string | null {
  const roots: string[] = [];
  if (process.env.ADE_STUDY_ASSETS_DIR) roots.push(process.env.ADE_STUDY_ASSETS_DIR);
  roots.push(path.join(process.cwd(), "assets", "ade-study"));

  const here = typeof __dirname !== "undefined" ? __dirname : moduleDirFromImportMeta();
  if (here) {
    roots.push(path.join(here, "assets", "ade-study"));
    roots.push(path.join(here, "..", "assets", "ade-study"));
    roots.push(path.join(here, "..", "..", "assets", "ade-study"));
  }

  for (const root of roots) {
    try {
      const candidate = path.join(root, fileName);
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Fallback ESM (le bundle serveur est CJS : __dirname suffit en général). */
function moduleDirFromImportMeta(): string {
  try {
    const url = new Function("return typeof import.meta === 'undefined' ? '' : import.meta.url")();
    if (typeof url === "string" && url.startsWith("file://")) {
      return path.dirname(decodeURIComponent(url.replace("file://", "")));
    }
  } catch {
    /* CJS : import.meta indisponible */
  }
  return "";
}

// ---------------------------------------------------------------- primitives

type TextStyle = {
  size?: number;
  font?: string;
  color?: string;
};

type WrapStyle = TextStyle & { leading?: number; maxLines?: number };

function applyStyle(doc: PDFKit.PDFDocument, style: TextStyle) {
  doc.font(style.font || "Helvetica");
  doc.fontSize(style.size ?? 9);
  doc.fillColor(style.color || BLACK);
}

/** Texte simple, `baseline` mesurée depuis le haut de la page. */
function drawText(doc: PDFKit.PDFDocument, text: string, x: number, baseline: number, style: TextStyle = {}) {
  const size = style.size ?? 9;
  applyStyle(doc, style);
  doc.text(String(text ?? ""), x, baseline - size * ASCENDER, { lineBreak: false });
}

function textWidth(doc: PDFKit.PDFDocument, text: string, style: TextStyle = {}): number {
  applyStyle(doc, style);
  return doc.widthOfString(String(text ?? ""));
}

function drawTextRight(
  doc: PDFKit.PDFDocument,
  text: string,
  xRight: number,
  baseline: number,
  style: TextStyle = {},
) {
  drawText(doc, text, xRight - textWidth(doc, text, style), baseline, style);
}

function drawTextCenter(
  doc: PDFKit.PDFDocument,
  text: string,
  xCenter: number,
  baseline: number,
  style: TextStyle = {},
) {
  drawText(doc, text, xCenter - textWidth(doc, text, style) / 2, baseline, style);
}

function wrapLines(doc: PDFKit.PDFDocument, text: string, width: number, style: TextStyle): string[] {
  applyStyle(doc, style);
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (doc.widthOfString(trial) <= width) {
      current = trial;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Retourne la baseline disponible après le dernier ligne écrite. */
function drawWrapped(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  baseline: number,
  width: number,
  style: WrapStyle = {},
): number {
  const size = style.size ?? 9;
  const leading = style.leading ?? size * 1.35;
  let lines = wrapLines(doc, text, width, style);
  if (style.maxLines && lines.length > style.maxLines) lines = lines.slice(0, style.maxLines);
  let y = baseline;
  for (const line of lines) {
    drawText(doc, line, x, y, style);
    y += leading;
  }
  return y;
}

function ellipsize(doc: PDFKit.PDFDocument, text: string, width: number, style: TextStyle): string {
  const raw = String(text ?? "");
  if (textWidth(doc, raw, style) <= width) return raw;
  let cut = raw;
  while (cut.length > 1 && textWidth(doc, `${cut}…`, style) > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** Réduit la taille de police jusqu'à tenir dans `width`. */
function fitSize(doc: PDFKit.PDFDocument, text: string, width: number, style: TextStyle, min = 8): number {
  let size = style.size ?? 9;
  while (size > min && textWidth(doc, text, { ...style, size }) > width) size -= 0.5;
  return size;
}

function rectFill(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, color: string) {
  doc.save();
  doc.rect(x, y, w, h).fillColor(color).fill();
  doc.restore();
}

function roundedBox(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { fill?: string; stroke?: string; radius?: number; lineWidth?: number },
) {
  const radius = opts.radius ?? 10;
  doc.save();
  doc.roundedRect(x, y, w, Math.max(1, h), radius);
  if (opts.fill && opts.stroke) {
    doc.fillColor(opts.fill).strokeColor(opts.stroke).lineWidth(opts.lineWidth ?? 0.8).fillAndStroke();
  } else if (opts.fill) {
    doc.fillColor(opts.fill).fill();
  } else if (opts.stroke) {
    doc.strokeColor(opts.stroke).lineWidth(opts.lineWidth ?? 0.8).stroke();
  }
  doc.restore();
}

function hLine(
  doc: PDFKit.PDFDocument,
  x1: number,
  y: number,
  x2: number,
  color: string,
  lineWidth = 0.7,
  opacity = 1,
) {
  doc.save();
  doc.strokeOpacity(opacity).strokeColor(color).lineWidth(lineWidth).moveTo(x1, y).lineTo(x2, y).stroke();
  doc.restore();
}

function safeImage(
  doc: PDFKit.PDFDocument,
  filePath: string | null,
  x: number,
  y: number,
  options: PDFKit.Mixins.ImageOption,
): boolean {
  if (!filePath) return false;
  try {
    doc.image(filePath, x, y, options);
    return true;
  } catch (e: any) {
    console.warn("[ade-study-pdf] image ignorée:", filePath, e?.message || e);
    return false;
  }
}

// ---------------------------------------------------------------- gabarit

function pageHeader(doc: PDFKit.PDFDocument, title: string, page: number, logoPath: string | null) {
  rectFill(doc, 0, 0, W, 88, BLUE);
  safeImage(doc, logoPath, 42, 13, { fit: [66, 66] });
  const size = fitSize(doc, title, W - 200, { size: 17, color: WHITE }, 11);
  drawText(doc, title, 128, 41, { size, color: WHITE });
  drawText(doc, "Étude personnalisée d'assurance emprunteur", 128, 60, { size: 8.5, color: WHITE });
  drawTextRight(doc, `${page}/${TOTAL_PAGES}`, W - 42, 58, { size: 8.5, color: WHITE });
}

function pageIntro(doc: PDFKit.PDFDocument, title: string, subtitle: string, titleSize = 17) {
  const size = fitSize(doc, title, W - 84, { size: titleSize, color: DEEP }, 12);
  drawText(doc, title, 42, 124, { size, color: DEEP });
  if (subtitle) drawText(doc, ellipsize(doc, subtitle, W - 84, { size: 8.5 }), 42, 143, { size: 8.5, color: GREY });
}

function pageFooter(doc: PDFKit.PDFDocument) {
  hLine(doc, 42, 799.89, W - 42, LINE);
  drawTextCenter(
    doc,
    "Cette étude est établie à titre indicatif et n'a pas de valeur contractuelle.",
    W / 2,
    786.89,
    { size: 6.8, color: GREY },
  );
  drawText(doc, "Le Club Immobilier Français - 17 Passage Leroy, 44000 Nantes", 42, 814.89, {
    size: 6.8,
    color: GREY,
  });
  drawTextRight(doc, "ORIAS 24002253 - Courtier indépendant", W - 42, 814.89, { size: 6.8, color: GREY });
}

// ---------------------------------------------------------------- données de rendu

type InsuredRow = {
  name: string;
  currentEur: number;
  proposedEur: number;
  feesEur: number;
  netEur: number;
};

type LemoineProfile = { name: string; tone: "green" | "orange"; text: string };

type StudyView = {
  clientName: string;
  studyDateLabel: string;
  effectLabel: string;
  comparisonStartLabel: string;
  comparisonEndLabel: string | null;
  monthsCompared: number;
  currentTotal: number;
  proposedTotal: number;
  fees: number;
  gross: number;
  net: number;
  netPercent: number;
  years: AdeYearRow[];
  insuredRows: InsuredRow[];
  guarantees: AdeStudyComputation["guarantees"];
  lemoineProfiles: LemoineProfile[];
  firstYearsCount: number;
  firstYearsCurrent: number;
  firstYearsProposed: number;
  loanCapitalEur: number | null;
  warnings: string[];
};

function buildView(comp: AdeStudyComputation): StudyView {
  const years = (comp.years || []).filter((r) => r && Number.isFinite(r.year));
  const currentTotal = round2(Number(comp.currentTotalEur) || 0);
  const proposedTotal = round2(Number(comp.proposedTotalEur) || 0);
  const fees = round2(Number(comp.feesAssureurEur) || 0);
  const gross = round2(Number(comp.grossSavingsEur) || currentTotal - proposedTotal);
  const net = round2(Number(comp.netSavingsEur) || gross - fees);
  const netPercent = currentTotal > 0 ? (net / currentTotal) * 100 : Number(comp.savingsPercent) || 0;

  const monthsCompared = Number(comp.monthsCompared) || years.length * 12;
  const effectLabel = formatFrLong(comp.effectDateIso);
  const comparisonStartLabel = comp.comparisonStartLabel || effectLabel;
  let comparisonEndLabel = comp.comparisonEndLabel || null;
  if (!comparisonEndLabel && monthsCompared > 1) {
    const endIso = addMonthsIso(comp.effectDateIso, monthsCompared - 1);
    comparisonEndLabel = endIso ? formatFrLong(endIso) : null;
  }

  const firstYearsCount = Math.min(8, years.length) || 0;
  const sumFirst = (key: "currentEur" | "proposedEur") =>
    round2(years.slice(0, firstYearsCount).reduce((acc, r) => acc + (Number(r[key]) || 0), 0));
  const firstYearsCurrent =
    firstYearsCount === 8 && comp.first8CurrentEur != null ? round2(comp.first8CurrentEur) : sumFirst("currentEur");
  const firstYearsProposed =
    firstYearsCount === 8 && comp.first8ProposedEur != null ? round2(comp.first8ProposedEur) : sumFirst("proposedEur");

  const breakdown = (comp.insuredBreakdown || []).filter((r) => r && (r.currentEur || r.proposedEur));
  const insuredRows: InsuredRow[] = breakdown.length >= 2
    ? breakdown.map((r) => ({
        name: String(r.name || "Assuré"),
        currentEur: round2(Number(r.currentEur) || 0),
        proposedEur: round2(Number(r.proposedEur) || 0),
        feesEur: round2(Number(r.feesEur) || 0),
        netEur: round2(
          Number(r.netEur) != null && Number.isFinite(Number(r.netEur))
            ? Number(r.netEur)
            : (Number(r.currentEur) || 0) - (Number(r.proposedEur) || 0) - (Number(r.feesEur) || 0),
        ),
      }))
    : [];

  const guarantees = comp.guarantees?.length ? comp.guarantees : DEFAULT_ADE_GUARANTEES;

  const lemoineProfiles: LemoineProfile[] = (comp.lemoineProfiles || []).length
    ? comp.lemoineProfiles!.map((p) => ({
        name: String(p.name || comp.clientName || "Assuré"),
        tone: p.tone === "orange" ? "orange" : "green",
        text: String(p.text || GENERIC_LEMOINE_TEXT),
      }))
    : [{ name: comp.clientName || "Assuré", tone: "green", text: GENERIC_LEMOINE_TEXT }];

  return {
    clientName: comp.clientName || "Client",
    studyDateLabel:
      comp.studyDateLabel ||
      new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }),
    effectLabel,
    comparisonStartLabel,
    comparisonEndLabel,
    monthsCompared,
    currentTotal,
    proposedTotal,
    fees,
    gross,
    net,
    netPercent,
    years,
    insuredRows,
    guarantees,
    lemoineProfiles,
    firstYearsCount,
    firstYearsCurrent,
    firstYearsProposed,
    loanCapitalEur: comp.loanCapitalEur != null && comp.loanCapitalEur > 0 ? Math.round(comp.loanCapitalEur) : null,
    warnings: comp.warnings || [],
  };
}

// ---------------------------------------------------------------- page 1 : couverture

function pageCover(doc: PDFKit.PDFDocument, d: StudyView, assets: { cover: string | null; logo: string | null }) {
  const hasCover = safeImage(doc, assets.cover, 0, 0, { width: W, height: H });
  if (!hasCover) rectFill(doc, 0, 0, W, H, DEEP);

  doc.save();
  doc.fillOpacity(hasCover ? 0.8 : 1);
  doc.rect(0, 0, W * 0.58, H).fillColor(DEEP).fill();
  doc.restore();

  safeImage(doc, assets.logo, 48, 45, { fit: [100, 100] });

  drawTextRight(doc, "ASSURANCE EMPRUNTEUR", W - 48, 62, { size: 9, color: WHITE });
  doc.save();
  doc.strokeColor(RED).lineWidth(2).moveTo(W - 75, 72).lineTo(W - 48, 72).stroke();
  doc.restore();

  drawText(doc, "ÉTUDE PERSONNALISÉE", 48, 205, { size: 9, color: WHITE });
  drawText(doc, "Votre assurance", 48, 245, { size: 29, font: "Helvetica-Bold", color: WHITE });
  drawText(doc, "mérite mieux.", 48, 279, { size: 29, font: "Helvetica-Bold", color: WHITE });
  drawWrapped(doc, "Une protection renforcée et un coût durablement réduit.", 48, 325, 255, {
    size: 12,
    color: WHITE,
    leading: 17,
  });

  hLine(doc, 48, 382, 316, WHITE, 0.8, 0.45);

  const nameSize = fitSize(doc, d.clientName, 268, { size: 14, color: WHITE }, 9);
  drawText(doc, d.clientName, 48, 408, { size: nameSize, color: WHITE });
  drawText(doc, `Étude comparative au ${d.studyDateLabel}`, 48, 430, { size: 8.5, color: WHITE });

  // Carte blanche « économie nette »
  roundedBox(doc, 44, 529.89, W - 88, 158, { fill: WHITE, stroke: WHITE, radius: 14 });
  drawText(doc, "VOTRE ÉCONOMIE NETTE ESTIMÉE", 66, 562.89, { size: 8.5, color: GREY });
  const netSize = fitSize(doc, eur(d.net), 250, { size: 31, font: "Helvetica-Bold" }, 18);
  drawText(doc, eur(d.net), 66, 613.89, { size: netSize, font: "Helvetica-Bold", color: BLUE });

  roundedBox(doc, W - 220, 581.89, 151, 39, { fill: LIGHT_GREEN, stroke: BORDER_GREEN, radius: 18 });
  drawTextCenter(doc, `${pct(d.netPercent)} D'ÉCONOMIE`, W - 144, 604.89, {
    size: 9,
    font: "Helvetica-Bold",
    color: GREEN,
  });

  hLine(doc, 66, 633.89, W - 66, LINE);
  drawText(doc, `Frais retenus déduits : ${eur(d.fees)}`, 66, 660.89, { size: 8, color: GREEN });
  drawTextRight(doc, `Économie brute : ${eur(d.gross)}`, W - 66, 660.89, { size: 8, color: GREY });

  drawText(doc, "Étude préparée par Charles Victor", 48, 739.89, { size: 8.5, color: WHITE });
  drawText(doc, "Conseiller en assurance emprunteur", 48, 757.89, { size: 8.5, color: WHITE });
  drawText(doc, "LE CLUB IMMOBILIER FRANÇAIS", 48, 781.89, { size: 8, font: "Helvetica-Bold", color: WHITE });
}

// ---------------------------------------------------------------- page 2 : synthèse

function pageSummary(doc: PDFKit.PDFDocument, d: StudyView, logo: string | null) {
  pageHeader(doc, "Votre économie en un regard", 2, logo);
  const monthsLabel =
    d.monthsCompared > 0
      ? `Comparaison sur les ${d.monthsCompared} mensualités restant après la prise d'effet.`
      : "Comparaison du coût de l'assurance restant après la prise d'effet.";
  pageIntro(doc, "Une réduction durable du coût de votre assurance", monthsLabel);
  if (d.loanCapitalEur) {
    drawText(doc, `Prêt immobilier — ${eurInt(d.loanCapitalEur)}`, 42, 157, { size: 7.5, color: GREY });
  }

  const cards: Array<[string, number, string]> = [
    ["ASSURANCE ACTUELLE", d.currentTotal, BLUE],
    ["NOUVELLES COTISATIONS", d.proposedTotal, MID_BLUE],
    ["ÉCONOMIE BRUTE", d.gross, GREEN],
  ];
  cards.forEach(([label, amount, accent], i) => {
    const x = 42 + i * 170;
    roundedBox(doc, x, 175, 158, 88, { fill: WHITE, stroke: LINE, radius: 10 });
    roundedBox(doc, x, 175, 5, 88, { fill: accent, radius: 3 });
    drawText(doc, label, x + 17, 197, { size: 7.5, color: GREY });
    const size = fitSize(doc, eur(amount), 124, { size: 18 }, 11);
    drawText(doc, eur(amount), x + 17, 237, { size, color: DEEP });
  });

  roundedBox(doc, 42, 286, W - 84, 58, { fill: LIGHT_GREEN, stroke: BORDER_GREEN, radius: 9 });
  drawText(doc, `Après déduction des frais retenus de la nouvelle assurance : ${eur(d.fees)}`, 58, 318, {
    size: 7.5,
    color: GREEN,
  });
  drawTextRight(doc, eur(d.net), W - 58, 323, { size: 19, font: "Helvetica-Bold", color: GREEN });

  // Tableau par assuré (+ ligne TOTAL toujours présente)
  const x0 = 42;
  const widths = [155, 98, 93, 75, 88];
  const tableWidth = widths.reduce((a, b) => a + b, 0);
  const hasBreakdown = d.insuredRows.length >= 2;
  const headers = ["Assuré", hasBreakdown ? "Actuelle*" : "Actuelle", "Cotisations", "Frais", "Économie nette"];
  roundedBox(doc, x0, 386, tableWidth, 24, { fill: BLUE, radius: 6 });
  let xx = x0;
  headers.forEach((head, i) => {
    drawText(doc, head, xx + 8, 402, { size: 7, color: WHITE });
    xx += widths[i];
  });

  const rows: Array<[string, number, number, number, number]> = [
    ...d.insuredRows.map(
      (r) => [r.name, r.currentEur, r.proposedEur, r.feesEur, r.netEur] as [string, number, number, number, number],
    ),
    ["TOTAL", d.currentTotal, d.proposedTotal, d.fees, d.net] as [string, number, number, number, number],
  ];
  const rowH = rows.length > 3 ? Math.max(20, 93 / rows.length) : 31;
  let yy = 410;
  rows.forEach((row, index) => {
    const isTotal = index === rows.length - 1;
    rectFill(doc, x0, yy, tableWidth, rowH, index % 2 ? LIGHT_BLUE : WHITE);
    const style: TextStyle = {
      size: 7.8,
      font: isTotal ? "Helvetica-Bold" : "Helvetica",
      color: isTotal ? DEEP : BLACK,
    };
    const baseline = yy + rowH * 0.61;
    let cx = x0;
    row.forEach((value, j) => {
      if (j === 0) {
        drawText(doc, ellipsize(doc, String(value), widths[j] - 16, style), cx + 8, baseline, style);
      } else {
        drawTextRight(doc, eur(Number(value)), cx + widths[j] - 8, baseline, style);
      }
      cx += widths[j];
    });
    yy += rowH;
  });

  if (hasBreakdown) {
    drawText(
      doc,
      "* Ventilation actuelle estimée selon la répartition des coûts contractuels individuels.",
      42,
      yy + 13,
      { size: 6.7, color: GREY },
    );
  }
  drawText(
    doc,
    'La colonne "Frais" correspond aux frais de dossier appliqués par la nouvelle assurance sélectionnée.',
    42,
    yy + 25,
    { size: 6.7, color: GREY },
  );

  // Barres de comparaison
  roundedBox(doc, 42, 621.89, W - 84, 105, { fill: LIGHT_BLUE, stroke: BORDER_BLUE, radius: 9 });
  drawText(doc, "COMPARAISON DU COÛT RESTANT", 58, 642.89, { size: 7.5, color: GREY });
  const maxValue = Math.max(d.currentTotal, d.proposedTotal + d.fees, d.net, 1);
  const comparisons: Array<[string, number, string]> = [
    ["Assurance actuelle", d.currentTotal, BLUE],
    ["Nouvelle assurance, frais inclus", round2(d.proposedTotal + d.fees), MID_BLUE],
    ["Économie nette", d.net, GREEN],
  ];
  comparisons.forEach(([label, value, color], i) => {
    const barTop = 660.89 + i * 25;
    drawText(doc, label, 58, barTop + 3, { size: 7.2, color: DEEP });
    roundedBox(doc, 226, barTop, 218, 7, { fill: TRACK_BLUE, radius: 4 });
    const ratio = Math.max(0, Math.min(1, value / maxValue));
    if (ratio > 0) roundedBox(doc, 226, barTop, Math.max(3, 218 * ratio), 7, { fill: color, radius: 4 });
    drawTextRight(doc, eur(value), W - 58, barTop + 5, { size: 7.2, color: DEEP });
  });

  pageFooter(doc);
}

// ---------------------------------------------------------------- page 3 : évolution

function niceScale(minValue: number, maxValue: number): { min: number; max: number; step: number } {
  const steps = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000];
  const lo = Math.min(0, minValue);
  const hi = Math.max(maxValue, lo + 1);
  for (const step of steps) {
    const min = Math.floor(lo / step) * step;
    if (min + step * 4 >= hi) return { min, max: min + step * 4, step };
  }
  const step = Math.ceil((hi - lo) / 4);
  const min = Math.floor(lo / step) * step;
  return { min, max: min + step * 4, step };
}

function pageEvolution(doc: PDFKit.PDFDocument, d: StudyView, logo: string | null) {
  pageHeader(doc, "Une économie qui se construit dans le temps", 3, logo);
  pageIntro(
    doc,
    "Évolution annuelle",
    `Les coûts sont regroupés par année contractuelle à compter du ${d.comparisonStartLabel}.`,
  );

  const chartX = 42;
  const chartTop = 210;
  const chartW = W - 84;
  const chartH = 315;
  roundedBox(doc, chartX, chartTop, chartW, chartH, { fill: WHITE, stroke: LINE, radius: 10 });
  drawTextCenter(doc, "Économie nette cumulée", chartX + chartW / 2, 228, { size: 10, color: DEEP });

  const plotX = chartX + 42;
  const plotW = chartW - 62;
  const plotBottom = 487;
  const plotH = 247;

  const cumuls = d.years.map((r) => Number(r.cumulNetEur) || 0);
  const scale = niceScale(Math.min(0, ...cumuls), Math.max(1, ...cumuls));
  const yFor = (value: number) => plotBottom - (plotH * (value - scale.min)) / (scale.max - scale.min);

  for (let i = 0; i <= 4; i++) {
    const tick = scale.min + scale.step * i;
    const y = yFor(tick);
    hLine(doc, plotX, y, plotX + plotW, LINE, 0.6);
    drawTextRight(doc, eurInt(tick), plotX - 6, y + 2, { size: 6.5, color: GREY });
  }
  if (scale.min < 0) hLine(doc, plotX, yFor(0), plotX + plotW, GREY, 0.8);

  const count = d.years.length;
  const points = d.years.map((r, i) => ({
    x: plotX + (count > 1 ? (plotW * i) / (count - 1) : plotW / 2),
    y: yFor(Number(r.cumulNetEur) || 0),
    year: r.year,
  }));

  if (points.length >= 2) {
    doc.save();
    doc.strokeColor(GREEN).lineWidth(2.2);
    doc.moveTo(points[0].x, points[0].y);
    for (const p of points.slice(1)) doc.lineTo(p.x, p.y);
    doc.stroke();
    doc.restore();
  }

  const markerIdx = Array.from(
    new Set([0, ...[1, 2, 3, 4, 5].map((k) => Math.round((k * (count - 1)) / 6)), count - 1]),
  ).filter((i) => i >= 0 && i < count);
  for (const i of markerIdx) {
    const p = points[i];
    doc.save();
    doc.circle(p.x, p.y, 2.8).fillColor(GREEN).fill();
    doc.restore();
    drawTextCenter(doc, String(p.year), p.x, 503, { size: 6.5, color: GREY });
  }

  roundedBox(doc, 42, 547, W - 84, 48, { fill: LIGHT_BLUE, stroke: BORDER_BLUE, radius: 8 });
  const firstYearsText =
    d.firstYearsCount > 0
      ? `Sur les ${d.firstYearsCount} premières années : ${eur(d.firstYearsCurrent)} actuellement, contre ${eur(
          d.firstYearsProposed,
        )} proposé.`
      : `Coût actuel restant : ${eur(d.currentTotal)} — nouvelles cotisations : ${eur(d.proposedTotal)}.`;
  drawWrapped(doc, firstYearsText, 58, 567, W - 116, { size: 8.5, color: DEEP, leading: 11, maxLines: 2 });

  roundedBox(doc, 42, 617, W - 84, 48, { fill: LIGHT_GREEN, stroke: BORDER_GREEN, radius: 8 });
  drawText(
    doc,
    `Retrouvez le détail complet des ${count} années sur la page suivante.`,
    58,
    637,
    { size: 8.5, font: "Helvetica-Bold", color: GREEN },
  );

  pageFooter(doc);
}

// ---------------------------------------------------------------- page 4 : détail (gains mensuels moyens)

function monthsInContractYear(year: number, totalMonths: number): number {
  if (!(totalMonths > 0)) return 12;
  const full = Math.floor(totalMonths / 12);
  const rem = totalMonths % 12;
  if (year <= full) return 12;
  if (rem > 0 && year === full + 1) return rem;
  return 12;
}

function pageAnnualDetail(doc: PDFKit.PDFDocument, d: StudyView, logo: string | null) {
  pageHeader(doc, "Le détail de votre économie", 4, logo);
  const count = d.years.length;
  const period = d.comparisonEndLabel
    ? `du ${d.comparisonStartLabel} au ${d.comparisonEndLabel}`
    : `à compter du ${d.comparisonStartLabel}`;
  pageIntro(
    doc,
    `Tableau comparatif mensuel sur ${count} années`,
    `Montants mensuels moyens par année contractuelle, ${period}.`,
    16,
  );

  const x0 = 42;
  const widths = [72, 108, 108, 108, 114];
  const tableWidth = widths.reduce((a, b) => a + b, 0);
  const headers = ["Année", "Actuelle / mois", "Nouvelle / mois", "Éco. nette / mois", "Cumul net"];
  roundedBox(doc, x0, 168, tableWidth, 24, { fill: BLUE, radius: 6 });
  let hx = x0;
  headers.forEach((label, i) => {
    if (i === 0) drawText(doc, label, hx + 8, 184, { size: 6.5, color: WHITE });
    else drawTextRight(doc, label, hx + widths[i] - 8, 184, { size: 6.5, color: WHITE });
    hx += widths[i];
  });

  const bodyTop = 192;
  const bodyMaxBottom = 688;
  const available = bodyMaxBottom - bodyTop;
  const maxRows = Math.floor(available / 9);
  const shown = d.years.slice(0, maxRows);
  const rowH = Math.max(9, Math.min(19, available / Math.max(1, shown.length)));
  const size = Math.max(5.6, Math.min(6.7, rowH * 0.42));
  const totalMonths = Math.max(1, Number(d.monthsCompared) || count * 12);

  let yy = bodyTop;
  shown.forEach((row, index) => {
    rectFill(doc, x0, yy, tableWidth, rowH, index % 2 ? LIGHT_BLUE : WHITE);
    const baseline = yy + rowH * 0.68;
    const m = monthsInContractYear(row.year, totalMonths);
    const curM = round2(row.currentEur / m);
    const propM = round2(row.proposedEur / m);
    // Éco. nette mensuelle hors lissage des frais : (actuelle - nouvelle) / mois
    // Les frais restent visibles en note année 1 ; le cumul conserve l'économie nette totale.
    const gainM = round2((row.currentEur - row.proposedEur) / m);
    const values = [
      `Année ${row.year}`,
      eur(curM),
      eur(propM),
      eur(gainM),
      eur(row.cumulNetEur),
    ];
    let cx = x0;
    values.forEach((value, j) => {
      const color = j === 3 && gainM < 0 ? RED : j === 4 ? GREEN : BLACK;
      if (j === 0) drawText(doc, value, cx + 8, baseline, { size, color: BLACK });
      else drawTextRight(doc, value, cx + widths[j] - 8, baseline, { size, color });
      cx += widths[j];
    });
    yy += rowH;
  });

  if (shown.length < count) {
    drawText(doc, `Années ${shown.length + 1} à ${count} détaillées sur demande.`, 42, yy + 12, {
      size: 6.7,
      color: GREY,
    });
  }
  drawText(
    doc,
    d.fees > 0
      ? `Gains mensuels moyens (hors frais). Les frais de dossier ${eur(d.fees)} sont déduits une fois dans le cumul / total net.`
      : `Gains mensuels moyens par année contractuelle. Le cumul net reste l'économie totale.`,
    42,
    696.89,
    { size: 6.5, color: GREY },
  );

  roundedBox(doc, 42, 711.89, W - 84, 34, { fill: LIGHT_GREEN, stroke: BORDER_GREEN, radius: 7 });
  drawText(doc, "ÉCONOMIE NETTE TOTALE", 58, 732.89, { size: 8.5, font: "Helvetica-Bold", color: GREEN });
  drawTextRight(doc, eur(d.net), W - 58, 735.89, { size: 13, font: "Helvetica-Bold", color: GREEN });

  pageFooter(doc);
}

// ---------------------------------------------------------------- page 5 : garanties

function pageGuarantees(doc: PDFKit.PDFDocument, d: StudyView, logo: string | null) {
  pageHeader(doc, "Votre couverture et notre accompagnement", 5, logo);
  pageIntro(
    doc,
    "Une protection complète du crédit",
    "Comparatif synthétique des garanties figurant dans les documents analysés.",
  );

  const x0 = 42;
  const widths = [205, 145, 159];
  const tableWidth = widths.reduce((a, b) => a + b, 0);
  roundedBox(doc, x0, 180, tableWidth, 25, { fill: BLUE, radius: 6 });
  let hx = x0;
  ["Garantie", "Assurance actuelle", "Nouvelle solution"].forEach((head, i) => {
    drawText(doc, head, hx + 8, 196, { size: 7.2, color: WHITE });
    hx += widths[i];
  });

  const rows = d.guarantees.slice(0, 16);
  const rowH = Math.max(14, Math.min(38, 231 / Math.max(1, rows.length)));
  const maxLines = rowH >= 24 ? 2 : 1;
  let yy = 205;
  rows.forEach((row, index) => {
    rectFill(doc, x0, yy, tableWidth, rowH, index % 2 ? LIGHT_BLUE : WHITE);
    const cells = [row.label, row.current, row.proposed];
    let cx = x0;
    cells.forEach((value, j) => {
      drawWrapped(doc, String(value || "—"), cx + 8, yy + 13, widths[j] - 16, {
        size: 7.1,
        color: BLACK,
        leading: 9,
        maxLines,
      });
      cx += widths[j];
    });
    yy += rowH;
  });

  drawText(doc, "La banque conserve la décision définitive sur l'équivalence des garanties.", 42, yy + 14, {
    size: 7.2,
    color: GREY,
  });

  drawText(doc, "Le service du Club Immobilier Français", 42, yy + 52, { size: 14, color: DEEP });
  const servicesBaseline = yy + 89;
  LCIF_SERVICES.forEach((service, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 42 + col * 260;
    const baseline = servicesBaseline + row * 37;
    drawText(doc, String(i + 1).padStart(2, "0"), x, baseline, {
      size: 7.5,
      font: "Helvetica-Bold",
      color: MID_BLUE,
    });
    drawWrapped(doc, service, x + 28, baseline, 210, { size: 7.5, color: DEEP, leading: 10, maxLines: 2 });
  });

  roundedBox(doc, 42, 678.89, W - 84, 72, { fill: LIGHT_GREEN, stroke: BORDER_GREEN, radius: 9 });
  drawText(doc, "COURTAGE INDÉPENDANT", 58, 702.89, { size: 7.5, color: GREEN });
  drawWrapped(
    doc,
    "Notre rôle est de rechercher une solution adaptée à votre situation, en toute indépendance, tout en vous " +
      "faisant bénéficier de conditions négociées et d'une étude rigoureuse.",
    58,
    722.89,
    W - 116,
    { size: 8, color: DEEP, leading: 11, maxLines: 3 },
  );

  pageFooter(doc);
}

// ---------------------------------------------------------------- page 6 : loi Lemoine

function pageLemoine(doc: PDFKit.PDFDocument, d: StudyView, logo: string | null) {
  pageHeader(doc, "La loi Lemoine en pratique", 6, logo);
  pageIntro(
    doc,
    "Changer d'assurance, simplement",
    "Vos droits lors d'une substitution et les éventuelles démarches de santé.",
  );

  roundedBox(doc, 42, 172, W - 84, 72, { fill: LIGHT_BLUE, stroke: BORDER_BLUE, radius: 9 });
  drawText(doc, "Une substitution possible à tout moment", 58, 195, {
    size: 10,
    font: "Helvetica-Bold",
    color: DEEP,
  });
  drawWrapped(
    doc,
    "La loi Lemoine permet de changer d'assurance emprunteur à tout moment. Le nouveau contrat doit respecter " +
      "l'équivalence des garanties exigées par la banque, qui dispose de 10 jours pour répondre après réception " +
      "d'un dossier complet.",
    58,
    215,
    W - 116,
    { size: 8.1, color: DEEP, leading: 11, maxLines: 3 },
  );

  const cardW = (W - 96) / 2;
  roundedBox(doc, 42, 270, cardW, 140, { fill: LIGHT_GREEN, stroke: BORDER_GREEN, radius: 9 });
  drawText(doc, "SANS QUESTIONNAIRE DE SANTÉ", 58, 297, { size: 9.5, font: "Helvetica-Bold", color: GREEN });
  drawWrapped(
    doc,
    "Aucun questionnaire ni examen médical ne peut être demandé si les deux conditions sont réunies : part " +
      "assurée sur l'encours cumulé inférieure ou égale à 200 000 € par personne, et fin du prêt avant le 60e " +
      "anniversaire.",
    58,
    319,
    cardW - 32,
    { size: 7.7, color: DEEP, leading: 10.5, maxLines: 7 },
  );

  const rightX = 54 + cardW;
  roundedBox(doc, rightX, 270, cardW, 140, { fill: LIGHT_ORANGE, stroke: BORDER_ORANGE, radius: 9 });
  drawText(doc, "FORMALITÉS MÉDICALES POSSIBLES", rightX + 16, 297, {
    size: 9.5,
    font: "Helvetica-Bold",
    color: ORANGE,
  });
  drawWrapped(
    doc,
    "Si l'une de ces conditions n'est pas remplie, l'assureur peut demander un questionnaire de santé. Selon les " +
      "réponses, il peut ensuite solliciter des comptes rendus, analyses ou examens médicaux complémentaires.",
    rightX + 16,
    319,
    cardW - 32,
    { size: 7.7, color: DEEP, leading: 10.5, maxLines: 7 },
  );

  roundedBox(doc, 42, 430, W - 84, 100, { fill: WHITE, stroke: LINE, radius: 9 });
  drawText(doc, "À retenir pour votre substitution", 58, 455, {
    size: 11,
    font: "Helvetica-Bold",
    color: DEEP,
  });
  drawWrapped(
    doc,
    "Ces règles s'appliquent de la même façon à tous les emprunteurs. L'exonération de questionnaire dépend de " +
      "votre part assurée sur l'encours cumulé (plafond 200 000 € par personne) et de l'âge à la fin du prêt " +
      "(avant 60 ans). Aucune démarche médicale n'est à anticiper : si un questionnaire est nécessaire, " +
      "l'assureur vous le demandera explicitement lors de l'adhésion.",
    58,
    478,
    W - 116,
    { size: 8, color: DEEP, leading: 11, maxLines: 5 },
  );

  roundedBox(doc, 42, 548, W - 84, 100, { fill: LIGHT_BLUE, stroke: BORDER_BLUE, radius: 9 });
  drawText(doc, "Droit de résiliation", 58, 573, {
    size: 11,
    font: "Helvetica-Bold",
    color: DEEP,
  });
  drawWrapped(
    doc,
    "Depuis la loi Lemoine, vous pouvez résilier votre assurance emprunteur à tout moment, sans attendre " +
      "l'échéance annuelle. Nous préparons le dossier d'équivalence de garanties et accompagnons l'échange " +
      "avec votre banque jusqu'à la prise d'effet du nouveau contrat.",
    58,
    596,
    W - 116,
    { size: 8, color: DEEP, leading: 11, maxLines: 5 },
  );

  roundedBox(doc, 42, 668, W - 84, 72, { fill: LIGHT_GREEN, stroke: BORDER_GREEN, radius: 9 });
  drawText(doc, "SI UN QUESTIONNAIRE EST DEMANDÉ", 58, 690, {
    size: 8.5,
    font: "Helvetica-Bold",
    color: GREEN,
  });
  drawWrapped(
    doc,
    "Répondez personnellement, complètement et avec exactitude. Les informations médicales sont confidentielles " +
      "et adressées uniquement au service médical de l'assureur. Aucune pièce n'est à anticiper tant qu'aucune " +
      "demande ne vous est adressée.",
    58,
    708,
    W - 116,
    { size: 7.4, color: DEEP, leading: 9.4, maxLines: 4 },
  );

  pageFooter(doc);
}

// ---------------------------------------------------------------- page 7 : prochaines étapes

function pageSteps(doc: PDFKit.PDFDocument, d: StudyView, logo: string | null) {
  pageHeader(doc, "Les prochaines étapes", TOTAL_PAGES, logo);
  pageIntro(
    doc,
    "Un changement accompagné de bout en bout",
    "Vous restez libre de donner suite à cette étude, sans modification de votre crédit immobilier.",
  );

  const steps: Array<[string, string]> = [
    ["Validation de l'étude", "Vous confirmez par écrit que vous souhaitez engager la substitution."],
    ["Transmission des pièces", "Copie recto-verso de la pièce d'identité et RIB pour les cotisations."],
    ["Constitution du dossier", "Notre équipe prépare et transmet la demande à l'assureur."],
    [
      "Demande auprès de la banque",
      "La banque vérifie l'équivalence des garanties dans le délai applicable.",
    ],
    [
      "Prise d'effet",
      "Après acceptation, la nouvelle couverture remplace l'assurance actuelle. La mise en place intervient " +
        "généralement sous un délai de deux à trois mois.",
    ],
  ];

  steps.forEach(([title, desc], i) => {
    const circleCenter = 189 + i * 77;
    doc.save();
    doc.circle(64, circleCenter, 17).fillColor(BLUE).fill();
    doc.restore();
    drawTextCenter(doc, String(i + 1), 64, circleCenter + 4, { size: 10, font: "Helvetica-Bold", color: WHITE });
    if (i < steps.length - 1) {
      doc.save();
      doc.strokeColor(LINE).lineWidth(1).moveTo(64, circleCenter + 18).lineTo(64, circleCenter + 61).stroke();
      doc.restore();
    }
    drawText(doc, title, 94, 182 + i * 77, { size: 10, color: DEEP });
    drawWrapped(doc, desc, 94, 201 + i * 77, W - 140, { size: 7.8, color: GREY, leading: 11, maxLines: 3 });
  });

  roundedBox(doc, 42, 613.89, W - 84, 105, { fill: BLUE, stroke: BLUE, radius: 10 });
  drawText(doc, "VOUS SOUHAITEZ METTRE EN PLACE CETTE SOLUTION ?", 60, 642.89, { size: 7.5, color: WHITE });
  drawWrapped(
    doc,
    "Répondez simplement au courriel en joignant la copie recto-verso de votre pièce d'identité et votre RIB. " +
      "Notre équipe se charge ensuite de constituer et de suivre la demande de substitution.",
    60,
    664.89,
    W - 120,
    { size: 9.5, color: WHITE, leading: 14, maxLines: 4 },
  );

  drawText(doc, "Charles Victor", 42, 745.89, { size: 10, color: DEEP });
  drawText(doc, "Conseiller en assurance emprunteur - Le Club Immobilier Français", 42, 761.89, {
    size: 7.5,
    color: GREY,
  });
  drawTextRight(doc, `Prise d'effet étudiée : ${d.effectLabel}`, W - 42, 761.89, { size: 6.5, color: GREY });

  pageFooter(doc);
}

// ---------------------------------------------------------------- entrée publique

/** Génère la présentation client ADE (7 pages) à partir du calcul. */
export function generateAdeStudyPdfBuffer(comp: AdeStudyComputation): Promise<Buffer> {
  const view = buildView(comp);
  const assets = {
    cover: resolveAssetPath("cover-background.png"),
    logo: resolveAssetPath("logo-lcif.png"),
  };
  if (!assets.cover) console.warn("[ade-study-pdf] cover-background.png introuvable — fond bleu de repli.");

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 0,
        bufferPages: true,
        info: {
          Title: `Étude économies assurance emprunteur - ${view.clientName}`,
          Author: "Le Club Immobilier Français",
        },
      });
      const chunks: Buffer[] = [];
      doc.on("data", (c) => chunks.push(Buffer.from(c)));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      pageCover(doc, view, assets);
      doc.addPage();
      pageSummary(doc, view, assets.logo);
      doc.addPage();
      pageEvolution(doc, view, assets.logo);
      doc.addPage();
      pageAnnualDetail(doc, view, assets.logo);
      doc.addPage();
      pageGuarantees(doc, view, assets.logo);
      doc.addPage();
      pageLemoine(doc, view, assets.logo);
      doc.addPage();
      pageSteps(doc, view, assets.logo);

      doc.end();
    } catch (e) {
      reject(e as Error);
    }
  });
}
