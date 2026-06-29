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

export function generateApporteurContractPdfBuffer(params: {
  document: ApporteurContractDocument;
  apporteur: Apporteur;
  signature: NonNullable<Apporteur["contractSignature"]>;
}): Promise<Buffer> {
  const { document, apporteur, signature } = params;
  const signedLabel = new Date(signature.signedAt).toLocaleString("fr-FR", {
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
      doc.fontSize(11).fillColor("#111827").text(section.heading, { continued: false });
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor("#374151").text(section.body, {
        align: "left",
        lineGap: 3,
      });
      doc.moveDown(0.8);
      if (doc.y > 700) {
        doc.addPage();
      }
    }

    doc.moveDown(0.5);
    doc.fontSize(11).fillColor("#111827").text("Signature électronique", { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor("#374151");
    doc.text(`Signataire : ${signature.signerName}`);
    doc.text(`Société / raison sociale : ${signature.companyName || apporteur.companyName}`);
    doc.text(`Email : ${signature.signerEmail}`);
    doc.text(`Date : ${signedLabel}`);
    doc.text(`Version du contrat : ${signature.version}`);
    if (signature.ipAddress) {
      doc.text(`Adresse IP (audit) : ${signature.ipAddress}`);
    }

    doc.moveDown(1);
    doc.fontSize(8).fillColor("#9CA3AF").text(
      "Document généré automatiquement par Le Club Immobilier Français — copie archivée pour le partenaire et LCIF.",
      { align: "center" },
    );

    doc.end();
  });
}
