import type { Apporteur } from "../shared/apporteurTypes";
import { APPORTEUR_CONTRACT_VERSION } from "../shared/apporteurContract";
import { APPORTEUR_TYPE_LABELS } from "../shared/apporteurTypes";
import { buildApporteurContractDocument } from "../shared/apporteurContract";
import { buildApporteurContractPdfFilename, generateApporteurContractPdfBuffer } from "./apporteurContractPdf";
import { uploadApporteurContractPdfToDrive } from "./apporteurDriveArchive";
import { sendApporteurContractSignedEmail } from "./apporteurNotify";
import { resolvePublicAppBaseUrl } from "./clientPortal";

export function isApporteurContractSigned(apporteur: Pick<Apporteur, "contractStatus">): boolean {
  return (apporteur.contractStatus || "none") === "signed";
}

export function getApporteurContractPayload(
  apporteur: Apporteur,
  sponsorName?: string | null,
) {
  return buildApporteurContractDocument({
    contactName: apporteur.contactName,
    companyName: apporteur.companyName,
    email: apporteur.email,
    typeLabel: APPORTEUR_TYPE_LABELS[apporteur.type] || apporteur.type,
    sponsorName,
  });
}

function normalizeName(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function validateSignerName(apporteur: Apporteur, signerName: string): void {
  const declared = normalizeName(signerName);
  if (declared.length < 3) {
    throw new Error("Indiquez votre nom complet pour signer.");
  }
  const contact = normalizeName(apporteur.contactName);
  const parts = contact.split(" ").filter(Boolean);
  const declaredParts = declared.split(" ").filter(Boolean);
  const matchesContact =
    declared === contact ||
    (parts.length >= 2 &&
      declaredParts.some((p) => p.length >= 3 && parts.some((c) => c === p || c.startsWith(p))));
  if (!matchesContact) {
    throw new Error(
      `Le nom saisi doit correspondre au contact du dossier (${apporteur.contactName}).`,
    );
  }
}

export async function buildSignedApporteurContractPdf(
  apporteur: Apporteur,
  sponsorName?: string | null,
): Promise<{ buffer: Buffer; filename: string; signature: NonNullable<Apporteur["contractSignature"]> } | null> {
  const signature = apporteur.contractSignature;
  if (!signature?.signedAt || !signature.signerName) return null;
  const document = getApporteurContractPayload(apporteur, sponsorName);
  const filename = signature.pdfFileName || buildApporteurContractPdfFilename(apporteur, signature.signedAt);
  const buffer = await generateApporteurContractPdfBuffer({ document, apporteur, signature });
  return { buffer, filename, signature };
}

async function archiveAndNotifySignedContract(
  apporteur: Apporteur,
  signature: NonNullable<Apporteur["contractSignature"]>,
  sponsorName?: string | null,
  portalBaseUrl?: string,
): Promise<Apporteur> {
  const document = getApporteurContractPayload(apporteur, sponsorName);
  const pdfFilename = buildApporteurContractPdfFilename(apporteur, signature.signedAt);
  const pdfBuffer = await generateApporteurContractPdfBuffer({ document, apporteur, signature });

  let driveFolderId = apporteur.driveFolderId;
  let driveFileId: string | undefined;
  let driveLink: string | undefined;

  try {
    const uploaded = await uploadApporteurContractPdfToDrive({
      apporteur,
      pdfBuffer,
      filename: pdfFilename,
    });
    if (uploaded) {
      driveFolderId = uploaded.folderId;
      driveFileId = uploaded.fileId;
      driveLink = uploaded.webViewLink || undefined;
    }
  } catch (err: any) {
    console.warn("[Apporteur] Archivage Drive contrat:", err?.message || err);
  }

  const enrichedSignature = {
    ...signature,
    pdfFileName: pdfFilename,
    driveFileId,
    driveLink,
  };

  const { updateApporteur } = await import("./apporteurStore");
  const updated = await updateApporteur(apporteur.id, {
    driveFolderId,
    contractSignature: enrichedSignature,
  });

  try {
    await sendApporteurContractSignedEmail(
      updated,
      pdfBuffer,
      pdfFilename,
      portalBaseUrl || resolvePublicAppBaseUrl(),
      driveLink,
    );
  } catch (err: any) {
    console.warn("[Apporteur] Email copie PDF contrat:", err?.message || err);
  }

  return updated;
}

export async function signApporteurContractOnline(params: {
  apporteur: Apporteur;
  signerName: string;
  acceptTerms: boolean;
  ipAddress?: string;
  userAgent?: string;
  portalBaseUrl?: string;
  sponsorName?: string | null;
}): Promise<Apporteur> {
  if (!params.acceptTerms) {
    throw new Error("Vous devez accepter le contrat pour continuer.");
  }
  if (isApporteurContractSigned(params.apporteur)) {
    return params.apporteur;
  }
  validateSignerName(params.apporteur, params.signerName);

  const now = new Date().toISOString();
  const signature: NonNullable<Apporteur["contractSignature"]> = {
    version: APPORTEUR_CONTRACT_VERSION,
    signedAt: now,
    signerName: String(params.signerName).trim(),
    signerEmail: params.apporteur.email,
    companyName: params.apporteur.companyName,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  };

  const { updateApporteur, finalizeRecruitAfterOnlineSignature } = await import("./apporteurStore");
  await updateApporteur(params.apporteur.id, {
    contractStatus: "signed",
    contractSignedAt: now,
    contractSignature: signature,
  });

  const apporteurWithSignature = { ...params.apporteur, contractStatus: "signed" as const, contractSignature: signature };
  const archived = await archiveAndNotifySignedContract(
    apporteurWithSignature,
    signature,
    params.sponsorName,
    params.portalBaseUrl,
  );

  await finalizeRecruitAfterOnlineSignature(archived.id);
  return archived;
}
