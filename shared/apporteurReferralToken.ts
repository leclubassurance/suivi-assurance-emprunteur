/** Slug ?ref= (prénom-nom, sans accents). */
export function slugifyReferralToken(input: string): string {
  return String(input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
}

/** Candidats ?ref= : contact en priorité, puis contact+société, puis société. */
export function buildReferralTokenCandidates(contactName: string, companyName: string): string[] {
  const contact = slugifyReferralToken(contactName);
  const company = slugifyReferralToken(companyName);
  const candidates: string[] = [];
  if (contact) candidates.push(contact);
  if (contact && company) {
    const combined =
      slugifyReferralToken(`${contactName} ${companyName}`) ||
      `${contact}-${company}`.slice(0, 48);
    if (combined && combined !== contact) candidates.push(combined);
  }
  if (company) candidates.push(company);
  return [...new Set(candidates.filter(Boolean))];
}

/** Le token actuel correspond-il au prénom/nom (ou variante -2, -3…) ? */
export function isReferralTokenDerivedFromIdentity(
  token: string,
  contactName: string,
  companyName: string,
): boolean {
  const current = slugifyReferralToken(token);
  if (!current) return false;
  const roots = buildReferralTokenCandidates(contactName, companyName);
  return roots.some((root) => current === root || current.startsWith(`${root}-`));
}

/** Meilleur slug attendu pour un contact (premier candidat). */
export function preferredReferralTokenSlug(contactName: string, companyName = ""): string {
  return buildReferralTokenCandidates(contactName, companyName)[0] || "partenaire";
}

/** Resynchroniser après correction de nom / faute de frappe (ex. lepriou → leprioux). */
export function shouldResyncReferralToken(current: string, contactName: string, companyName: string): boolean {
  const preferred = preferredReferralTokenSlug(contactName, companyName);
  const normalized = slugifyReferralToken(current);
  if (!normalized || normalized === preferred) return false;
  if (isReferralTokenDerivedFromIdentity(normalized, contactName, companyName)) return true;
  // Faute proche sur la fin du slug (1–3 caractères).
  if (preferred.startsWith(normalized) && preferred.length - normalized.length <= 3) return true;
  return false;
}
