import { findApporteurById } from "./apporteurStore";
import { isConseillerImmoClubType } from "../shared/conseillerImmoClub";

/** Email du conseiller LCIF rattaché au dossier (copie des échanges client ↔ LCIF). */
export async function resolveConseillerCcEmail(dossier: unknown): Promise<string | null> {
  const apporteurId = String((dossier as any)?.apporteur?.apporteurId || "").trim();
  if (!apporteurId) return null;
  const apporteur = await findApporteurById(apporteurId);
  if (!apporteur || !isConseillerImmoClubType(apporteur.type)) return null;
  const email = String(apporteur.email || "").trim().toLowerCase();
  return email.includes("@") ? email : null;
}

export function mergeCcWithConseiller(existing: string[], conseillerEmail: string | null | undefined): string[] {
  const out = new Set(
    (existing || [])
      .map((e) => String(e || "").trim().toLowerCase())
      .filter((e) => e.includes("@")),
  );
  const cc = String(conseillerEmail || "").trim().toLowerCase();
  if (cc.includes("@")) out.add(cc);
  return [...out];
}

export async function appendConseillerCcForDossier(dossier: unknown, cc: string[] = []): Promise<string[]> {
  const conseillerEmail = await resolveConseillerCcEmail(dossier);
  return mergeCcWithConseiller(cc, conseillerEmail);
}
