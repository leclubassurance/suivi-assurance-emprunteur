import type { Apporteur } from "../shared/apporteurTypes";
import { APPORTEUR_CONTRACT_VERSION } from "../shared/apporteurContract";
import {
  formatApporteurDisplayName,
  validateApporteurProfileForContract,
} from "../shared/apporteurProfile";
import { LCIF_LEGAL } from "../shared/lcifLegalIdentity";
import { buildApporteurContractDocument } from "../shared/apporteurContract";
import { buildApporteurContractPdfFilename, generateApporteurContractPdfBuffer } from "./apporteurContractPdf";
import { uploadApporteurContractPdfToDrive } from "./apporteurDriveArchive";
import { sendApporteurContractSignedEmail } from "./apporteurNotify";
import { resolvePublicAppBaseUrl } from "./clientPortal";
import { notifyTelegramApporteurContractSigned } from "./telegramNotify";

export function isApporteurContractSigned(apporteur: Pick<Apporteur, "contractStatus">): boolean {
  return (apporteur.contractStatus || "none") === "signed";
}

export function getApporteurContractPayload(
  apporteur: Apporteur,
  sponsorName?: string | null,
) {
  return buildApporteurContractDocument(apporteur, sponsorName);
}

export function isApporteurProfileComplete(apporteur: Apporteur): boolean {
  return validateApporteurProfileForContract(apporteur).ok;
}

export function getApporteurProfilePayload(apporteur: Apporteur) {
  return {
    contactPrenom: apporteur.contactPrenom || "",
    contactNom: apporteur.contactNom || "",
    companyName: apporteur.companyName || "",
    companyLegalName: apporteur.companyLegalName || "",
    email: apporteur.email || "",
    phone: apporteur.phone || "",
    addressLine: apporteur.addressLine || "",
    postalCode: apporteur.postalCode || "",
    city: apporteur.city || "",
    siret: apporteur.siret || "",
    siren: apporteur.siren || "",
    legalForm: apporteur.legalForm || "",
    legalFormOther: apporteur.legalFormOther || "",
    type: apporteur.type || "apporteur_affaires",
    typeCustomLabel: apporteur.typeCustomLabel || "",
  };
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
  const contact = normalizeName(formatApporteurDisplayName(apporteur));
  const parts = contact.split(" ").filter(Boolean);
  const declaredParts = declared.split(" ").filter(Boolean);
  const matchesContact =
    declared === contact ||
    (parts.length >= 2 &&
      declaredParts.some((p) => p.length >= 3 && parts.some((c) => c === p || c.startsWith(p))));
  if (!matchesContact) {
    throw new Error(
      `Le nom saisi doit correspondre à votre identité (${formatApporteurDisplayName(apporteur)}).`,
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
    );
  } catch (err: any) {
    console.warn("[Apporteur] Email copie PDF contrat:", err?.message || err);
  }

  try {
    await notifyTelegramApporteurContractSigned({
      apporteur: {
        contactName: updated.contactName,
        companyName: updated.companyName,
        email: updated.email,
        portalToken: updated.portalToken,
        driveLink: updated.contractSignature?.driveLink || driveLink,
      },
    });
  } catch (err: any) {
    console.warn("[Apporteur] Telegram contrat signé:", err?.message || err);
  }

  return updated;
}

export async function signApporteurContractOnline(params: {
  apporteur: Apporteur;
  signerName: string;
  acceptTerms: boolean;
  emailOtp?: string;
  ipAddress?: string;
  userAgent?: string;
  portalBaseUrl?: string;
  sponsorName?: string | null;
}): Promise<Apporteur> {
  if (!params.acceptTerms) {
    throw new Error("Vous devez accepter le contrat pour continuer.");
  }
  if (!String(params.emailOtp || "").trim()) {
    throw new Error("Saisissez le code reçu par email pour valider votre signature.");
  }
  const { verifyApporteurContractOtp } = await import("./apporteurContractOtp");
  if (!verifyApporteurContractOtp(params.apporteur.id, String(params.emailOtp || "").trim())) {
    throw new Error("Code invalide ou expiré. Demandez un nouveau code.");
  }
  if (isApporteurContractSigned(params.apporteur)) {
    return params.apporteur;
  }
  const profileCheck = validateApporteurProfileForContract(params.apporteur);
  if (!profileCheck.ok) {
    throw new Error(profileCheck.error);
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
    emailOtpVerifiedAt: now,
    mandantSignature: {
      signedAt: now,
      signerName: LCIF_LEGAL.legalRepresentative,
      signerTitle: LCIF_LEGAL.legalRepresentativeTitle,
      companyName: LCIF_LEGAL.companyName,
    },
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
