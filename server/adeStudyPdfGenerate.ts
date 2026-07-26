import PDFDocument from "pdfkit";
import type { AdeStudyComputation } from "./adeStudyCompute";

const BLUE = "#1E3A8A";
const GREY = "#64748B";
const BLACK = "#0F172A";
const LINE = "#D7E1EF";
const LIGHT = "#F8FAFC";
const GREEN = "#15803D";

function eur(n: number): string {
  return `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/** Format sans espace milliers — fiable pour pdf-parse + studyPdfEconomicsParse. */
function eurParseable(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} €`;
}

function pct(n: number): string {
  return `${n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

function formatFrLong(iso: string): string {
  try {
    return new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function header(doc: PDFKit.PDFDocument, title: string, page: number, total: number) {
  doc.rect(0, 0, doc.page.width, 72).fill(BLUE);
  doc.fillColor("#FFFFFF").fontSize(14).font("Helvetica-Bold").text(title, 42, 28, { width: 400 });
  doc.fontSize(8).font("Helvetica").text("Étude personnalisée d'assurance emprunteur", 42, 48);
  doc.fontSize(8).text(`${page}/${total}`, doc.page.width - 70, 40, { width: 40, align: "right" });
  doc.fillColor(BLACK);
}

function footer(doc: PDFKit.PDFDocument) {
  const y = doc.page.height - 48;
  doc.strokeColor(LINE).moveTo(42, y).lineTo(doc.page.width - 42, y).stroke();
  doc.fillColor(GREY).fontSize(6.5).font("Helvetica");
  doc.text("Cette étude est établie à titre indicatif et n'a pas de valeur contractuelle.", 42, y + 6, {
    width: doc.page.width - 84,
    align: "center",
  });
  doc.text("Le Club Immobilier Français - 17 Passage Leroy, 44000 Nantes", 42, y + 18);
  doc.text("ORIAS 24002253 - Courtier indépendant", doc.page.width - 220, y + 18, {
    width: 178,
    align: "right",
  });
}

/** Génère le PDF comparatif ADE (pdfkit) à partir du calcul. */
export function generateAdeStudyPdfBuffer(comp: AdeStudyComputation): Promise<Buffer> {
  const totalPages = 7;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(Buffer.from(c)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // --- 1 Couverture ---
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(BLUE);
    doc.fillColor("#FFFFFF").fontSize(11).font("Helvetica").text("Le Club Immobilier Français", 42, 60);
    doc.fontSize(12).font("Helvetica").text("ÉTUDE PERSONNALISÉE", 42, 88);
    doc.fontSize(28).font("Helvetica-Bold").text("Votre étude\nd'économies", 42, 120, { width: 320 });
    doc.fontSize(12).font("Helvetica").text(comp.clientName || "Client", 42, 220);
    doc.fontSize(10).text(`Prise d'effet étudiée : ${formatFrLong(comp.effectDateIso)}`, 42, 245);
    doc.fontSize(36).font("Helvetica-Bold").text(eur(comp.netSavingsEur), 42, 320);
    doc.fontSize(12).font("Helvetica").text(`économie nette estimée · ${pct(comp.savingsPercent)}`, 42, 370);
    doc.fontSize(9).text("Document confidentiel — à titre indicatif", 42, doc.page.height - 80);

    // --- 2 Synthèse ---
    doc.addPage();
    header(doc, "Synthèse financière", 2, totalPages);
    let y = 100;
    const row = (label: string, value: string, bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(BLACK);
      doc.text(label, 50, y, { width: 280 });
      doc.text(value, 340, y, { width: 200, align: "right" });
      y += 22;
    };
    doc.roundedRect(42, y - 8, doc.page.width - 84, 160, 8).fill(LIGHT);
    y += 8;
    // Libellés alignés sur le parseur studyPdfEconomicsParse (template v2).
    row("ASSURANCE ACTUELLE", eurParseable(comp.currentTotalEur));
    row("NOUVELLES COTISATIONS", eurParseable(comp.proposedTotalEur));
    row("ÉCONOMIE BRUTE", eurParseable(comp.grossSavingsEur), true);
    row("Frais retenus déduits :", eurParseable(comp.feesAssureurEur));
    row("ÉCONOMIE NETTE TOTALE", eurParseable(comp.netSavingsEur), true);
    y += 6;
    doc.font("Helvetica").fontSize(8).fillColor(GREY).text(
      `Prise d'effet étudiée : ${formatFrLong(comp.effectDateIso)}`,
      50,
      y,
    );
    y += 14;
    doc.text(
      `Année 1 ${eurParseable(comp.years[0]?.currentEur || 0)} ${eurParseable(comp.year1ProposedEur)}`,
      50,
      y,
    );
    y += 12;
    const savPct = pct(comp.savingsPercent).replace(" %", "");
    doc.text(`${savPct} % D'ÉCONOMIE`, 50, y);
    y += 8;
    y += 20;
    doc.fillColor(GREY).fontSize(8).font("Helvetica").text(
      "La colonne « Frais » correspond aux frais de dossier appliqués par la nouvelle assurance sélectionnée.",
      50,
      y,
      { width: 480 },
    );
    y += 40;
    doc.fillColor(BLACK).fontSize(10).font("Helvetica-Bold").text("Hypothèses", 50, y);
    y += 16;
    doc.font("Helvetica").fontSize(8).fillColor(GREY);
    for (const a of comp.assumptions.slice(0, 6)) {
      doc.text(`• ${a}`, 50, y, { width: 480 });
      y += 12;
    }
    footer(doc);

    // --- 3 Évolution (8 premières années) ---
    doc.addPage();
    header(doc, "Évolution annuelle", 3, totalPages);
    y = 100;
    doc.fillColor(BLACK).fontSize(10).font("Helvetica-Bold");
    doc.text("Année", 50, y);
    doc.text("Actuelle", 120, y);
    doc.text("Nouvelle", 220, y);
    doc.text("Éco. nette", 320, y);
    doc.text("Cumul", 420, y);
    y += 18;
    doc.strokeColor(LINE).moveTo(50, y).lineTo(540, y).stroke();
    y += 8;
    doc.font("Helvetica").fontSize(9);
    for (const r of comp.years.slice(0, 8)) {
      doc.fillColor(BLACK).text(String(r.year), 50, y);
      doc.text(eur(r.currentEur), 120, y);
      doc.text(eur(r.proposedEur), 220, y);
      doc.fillColor(GREEN).text(eur(r.netSavingEur), 320, y);
      doc.fillColor(BLACK).text(eur(r.cumulNetEur), 420, y);
      y += 16;
    }
    y += 12;
    doc.fillColor(GREY).fontSize(8).text("Détail complet sur la page suivante.", 50, y);
    footer(doc);

    // --- 4 Détail annuel ---
    doc.addPage();
    header(doc, "Détail annuel complet", 4, totalPages);
    y = 96;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(BLACK);
    doc.text("Année", 50, y);
    doc.text("Actuelle", 110, y);
    doc.text("Nouvelle", 200, y);
    doc.text("Éco. nette", 290, y);
    doc.text("Cumul net", 390, y);
    y += 14;
    doc.font("Helvetica").fontSize(8);
    for (const r of comp.years) {
      if (y > 740) {
        footer(doc);
        doc.addPage();
        header(doc, "Détail annuel (suite)", 4, totalPages);
        y = 96;
      }
      doc.fillColor(BLACK).text(String(r.year), 50, y);
      doc.text(eur(r.currentEur), 110, y);
      doc.text(eur(r.proposedEur), 200, y);
      doc.text(eur(r.netSavingEur), 290, y);
      doc.text(eur(r.cumulNetEur), 390, y);
      y += 12;
    }
    footer(doc);

    // --- 5 Garanties ---
    doc.addPage();
    header(doc, "Garanties et accompagnement", 5, totalPages);
    y = 100;
    doc.font("Helvetica").fontSize(9).fillColor(BLACK);
    doc.text(
      "Notre rôle est de rechercher une solution adaptée à votre situation, en toute indépendance, tout en vous faisant bénéficier de conditions négociées et d'une étude rigoureuse.",
      50,
      y,
      { width: 480 },
    );
    y += 50;
    doc.font("Helvetica-Bold").fontSize(9);
    doc.text("Garantie", 50, y);
    doc.text("Assurance actuelle", 180, y);
    doc.text("Nouvelle solution", 360, y);
    y += 16;
    doc.font("Helvetica").fontSize(9);
    for (const g of comp.guarantees) {
      doc.text(g.label, 50, y, { width: 120 });
      doc.text(g.current, 180, y, { width: 160 });
      doc.text(g.proposed, 360, y, { width: 160 });
      y += 18;
    }
    footer(doc);

    // --- 6 Loi Lemoine ---
    doc.addPage();
    header(doc, "Loi Lemoine", 6, totalPages);
    y = 100;
    doc.font("Helvetica").fontSize(9).fillColor(BLACK);
    const lemoine = [
      "Depuis la loi Lemoine, vous pouvez changer d'assurance emprunteur à tout moment, sous réserve d'équivalence de garanties acceptée par votre banque.",
      "Selon votre encours et votre profil, un questionnaire de santé peut être demandé par le nouvel assureur. Aucune démarche médicale n'est à anticiper tant qu'aucune demande n'est adressée : l'assureur indiquera lui-même les justificatifs éventuels.",
      "La mise en place intervient généralement sous un délai de deux à trois mois.",
      `Prise d'effet étudiée pour ce dossier : ${formatFrLong(comp.effectDateIso)}.`,
    ];
    for (const p of lemoine) {
      doc.text(p, 50, y, { width: 480, lineGap: 2 });
      y += 48;
    }
    footer(doc);

    // --- 7 Next steps ---
    doc.addPage();
    header(doc, "Prochaines étapes", 7, totalPages);
    y = 110;
    doc.font("Helvetica-Bold").fontSize(12).fillColor(BLUE).text("Comment procéder ?", 50, y);
    y += 28;
    doc.font("Helvetica").fontSize(10).fillColor(BLACK);
    const steps = [
      "Répondez à cet e-mail pour confirmer votre souhait d'avancer.",
      "Joignez la copie recto-verso de votre pièce d'identité et votre RIB.",
      "Nous constituons le dossier de substitution auprès de l'assureur et de votre banque.",
      "Vous êtes informé à chaque étape jusqu'à la prise d'effet.",
    ];
    steps.forEach((s, i) => {
      doc.circle(58, y + 4, 8).fill(BLUE);
      doc.fillColor("#FFF").fontSize(9).text(String(i + 1), 54, y - 1);
      doc.fillColor(BLACK).fontSize(10).text(s, 78, y, { width: 430 });
      y += 36;
    });
    y += 30;
    doc.font("Helvetica-Bold").fontSize(11).text("Charles Victor", 50, y);
    y += 16;
    doc.font("Helvetica").fontSize(9).fillColor(GREY).text("Conseiller en assurance emprunteur", 50, y);
    y += 14;
    doc.text("Le Club Immobilier Français", 50, y);
    if (comp.warnings.length) {
      y += 40;
      doc.fillColor("#B45309").fontSize(8).text("Points de vigilance : " + comp.warnings.slice(0, 3).join(" · "), 50, y, {
        width: 480,
      });
    }
    footer(doc);

    doc.end();
  });
}
