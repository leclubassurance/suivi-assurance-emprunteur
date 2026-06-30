import PDFDocument from "pdfkit";
import type { Apporteur } from "../shared/apporteurTypes";
import type { ApporteurContractDocument } from "../shared/apporteurContract";
import { LCIF_LEGAL } from "../shared/lcifLegalIdentity";

function sanitizeFilePart(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function buildApporteurContractPdfFilename(apporteur: Pick<Apporteur, "id">, signedAt: string): string {
  const date = signedAt.slice(0, 10);
  return `Contrat_${sanitizeFilePart(apporteur.id)}_${date}.pdf`;
}

function resolveMandantSignature(signature: NonNullable<Apporteur["contractSignature"]>) {
  return (
    signature.mandantSignature || {
      signedAt: signature.signedAt,
      signerName: LCIF_LEGAL.legalRepresentative,
      signerTitle: LCIF_LEGAL.legalRepresentativeTitle,
      companyName: LCIF_LEGAL.companyName,
    }
  );
}

export function generateApporteurContractPdfBuffer(params: {
  document: ApporteurContractDocument;
  apporteur: Apporteur;
  signature: NonNullable<Apporteur["contractSignature"]>;
}): Promise<Buffer> {
  const { document, apporteur, signature } = params;
  const mandant = resolveMandantSignature(signature);
  const partnerSignedLabel = new Date(signature.signedAt).toLocaleString("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
  });
  const mandantSignedLabel = new Date(mandant.signedAt).toLocaleString("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
  });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).fillColor("#1E3A8A").text(document.title, { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#374151").text(document.preamble, { align: "center" });
    doc.moveDown(1);

    doc.fontSize(9).fillColor("#6B7280").text(
      `${LCIF_LEGAL.companyName} · ORIAS ${LCIF_LEGAL.oriasNumber} · ${LCIF_LEGAL.registeredOffice}`,
      { align: "center" },
    );
    doc.moveDown(1.2);

    for (const section of document.sections) {
      if (doc.y > 680) doc.addPage();
      doc.fontSize(11).fillColor("#111827").text(section.heading, { continued: false });
      doc.moveDown(0.3);
      doc.fontSize(9.5).fillColor("#374151").text(section.body, {
        align: "left",
        lineGap: 2,
      });
      doc.moveDown(0.6);
    }

    if (doc.y > 620) doc.addPage();

    doc.moveDown(0.5);
    doc.fontSize(11).fillColor("#111827").text("Signatures électroniques", { underline: true });
    doc.moveDown(0.6);

    const leftX = 50;
    const rightX = 310;
    const blockTop = doc.y;

    doc.fontSize(10).fillColor("#1E3A8A").text("Le Partenaire", leftX, blockTop, { width: 230 });
    doc.fontSize(10).fillColor("#1E3A8A").text("Le Club Immobilier Français", rightX, blockTop, { width: 230 });

    doc.moveDown(0.8);
    const contentTop = doc.y;

    doc.fontSize(10).fillColor("#111827");
    doc.text(signature.signerName, leftX, contentTop, { width: 230 });
    doc.text(mandant.signerName, rightX, contentTop, { width: 230 });

    doc.fontSize(9).fillColor("#374151");
    doc.text(signature.companyName || apporteur.companyName || "—", leftX, doc.y + 2, { width: 230 });
    const afterPartnerCompany = doc.y;
    doc.text(mandant.companyName, rightX, contentTop + 14, { width: 230 });
    doc.text(mandant.signerTitle, rightX, contentTop + 28, { width: 230 });

    const partnerDetailsTop = Math.max(afterPartnerCompany + 4, contentTop + 42);
    doc.text(`Email : ${signature.signerEmail}`, leftX, partnerDetailsTop, { width: 230 });
    doc.text(`Signé le ${partnerSignedLabel}`, leftX, partnerDetailsTop + 14, { width: 230 });
    doc.text(`Signé le ${mandantSignedLabel}`, rightX, partnerDetailsTop + 14, { width: 230 });

    doc.text(`Version : ${signature.version}`, leftX, partnerDetailsTop + 28, { width: 230 });
    if (signature.ipAddress) {
      doc.text(`IP (audit) : ${signature.ipAddress}`, leftX, partnerDetailsTop + 42, { width: 230 });
    }

    doc.moveDown(4);
    doc.fontSize(8).fillColor("#9CA3AF").text(
      "Document généré automatiquement par Le Club Immobilier Français — copie archivée pour le Partenaire et la Société.",
      { align: "center" },
    );

    doc.end();
  });
}
