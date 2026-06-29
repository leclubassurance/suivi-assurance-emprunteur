import type { Apporteur } from "../shared/apporteurTypes";
import { APPORTEUR_CONTRACT_VERSION } from "../shared/apporteurContract";
import { APPORTEUR_TYPE_LABELS } from "../shared/apporteurTypes";
import { buildApporteurContractDocument } from "../shared/apporteurContract";

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

export async function signApporteurContractOnline(params: {
  apporteur: Apporteur;
  signerName: string;
  acceptTerms: boolean;
  ipAddress?: string;
  userAgent?: string;
}): Promise<Apporteur> {
  if (!params.acceptTerms) {
    throw new Error("Vous devez accepter le contrat pour continuer.");
  }
  if (isApporteurContractSigned(params.apporteur)) {
    return params.apporteur;
  }
  validateSignerName(params.apporteur, params.signerName);

  const now = new Date().toISOString();
  const { updateApporteur, finalizeRecruitAfterOnlineSignature } = await import("./apporteurStore");
  const updated = await updateApporteur(params.apporteur.id, {
    contractStatus: "signed",
    contractSignedAt: now,
    contractSignature: {
      version: APPORTEUR_CONTRACT_VERSION,
      signedAt: now,
      signerName: String(params.signerName).trim(),
      signerEmail: params.apporteur.email,
      companyName: params.apporteur.companyName,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    },
  });

  await finalizeRecruitAfterOnlineSignature(updated.id);
  return updated;
}
