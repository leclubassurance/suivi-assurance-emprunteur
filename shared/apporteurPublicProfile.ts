/** Profil public affiché sur le lien client (?ref=). */

export const APPORTEUR_PUBLIC_BIO_MAX = 280;
export const APPORTEUR_PUBLIC_TITLE_MAX = 80;

export type ApporteurPublicProfile = {
  /** Si true, le bandeau apparaît sur la landing ?ref= */
  enabled: boolean;
  /** URL https de la photo (Drive public, CDN…). */
  photoUrl?: string;
  /** Ex. « Conseiller immobilier » */
  title?: string;
  /** Bio courte (max APPORTEUR_PUBLIC_BIO_MAX). */
  bio?: string;
  updatedAt?: string;
  updatedBy?: "admin" | "conseiller" | "system";
};

export type ApporteurPublicProfileInput = {
  enabled?: boolean;
  photoUrl?: string | null;
  title?: string | null;
  bio?: string | null;
};

export type ApporteurPublicRefPayload = {
  ok: true;
  contactName: string;
  contactPrenom?: string;
  contactNom?: string;
  companyName?: string;
  profile: {
    enabled: true;
    photoUrl?: string;
    title?: string;
    bio?: string;
  };
};

function trimOrEmpty(v: unknown): string {
  return String(v ?? "").trim();
}

export function isHttpsPhotoUrl(url: string): boolean {
  if (!url) return true;
  try {
    const u = new URL(url);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeApporteurPublicProfile(
  input: ApporteurPublicProfileInput,
  meta?: { updatedBy?: ApporteurPublicProfile["updatedBy"] },
): ApporteurPublicProfile {
  const photoUrl = trimOrEmpty(input.photoUrl) || undefined;
  const title = trimOrEmpty(input.title).slice(0, APPORTEUR_PUBLIC_TITLE_MAX) || undefined;
  const bio = trimOrEmpty(input.bio).slice(0, APPORTEUR_PUBLIC_BIO_MAX) || undefined;
  return {
    enabled: Boolean(input.enabled),
    photoUrl,
    title,
    bio,
    updatedAt: new Date().toISOString(),
    updatedBy: meta?.updatedBy || "system",
  };
}

export function validateApporteurPublicProfile(
  profile: ApporteurPublicProfile,
): { ok: true } | { ok: false; error: string } {
  if (profile.photoUrl && !isHttpsPhotoUrl(profile.photoUrl)) {
    return { ok: false, error: "L'URL de la photo doit commencer par https://" };
  }
  if (profile.bio && profile.bio.length > APPORTEUR_PUBLIC_BIO_MAX) {
    return { ok: false, error: `La bio est limitée à ${APPORTEUR_PUBLIC_BIO_MAX} caractères.` };
  }
  if (profile.title && profile.title.length > APPORTEUR_PUBLIC_TITLE_MAX) {
    return { ok: false, error: `Le titre est limité à ${APPORTEUR_PUBLIC_TITLE_MAX} caractères.` };
  }
  if (profile.enabled && !profile.photoUrl && !profile.bio && !profile.title) {
    return {
      ok: false,
      error: "Ajoutez au moins une photo, un titre ou une bio avant d'afficher le bandeau.",
    };
  }
  return { ok: true };
}

export function buildApporteurPublicRefPayload(apporteur: {
  active?: boolean;
  contactName?: string;
  contactPrenom?: string;
  contactNom?: string;
  companyName?: string;
  publicProfile?: ApporteurPublicProfile | null;
}): ApporteurPublicRefPayload | null {
  if (!apporteur.active) return null;
  const p = apporteur.publicProfile;
  if (!p?.enabled) return null;

  const contactName =
    trimOrEmpty(apporteur.contactName) ||
    [trimOrEmpty(apporteur.contactPrenom), trimOrEmpty(apporteur.contactNom)].filter(Boolean).join(" ");
  if (!contactName) return null;

  return {
    ok: true,
    contactName,
    contactPrenom: trimOrEmpty(apporteur.contactPrenom) || undefined,
    contactNom: trimOrEmpty(apporteur.contactNom) || undefined,
    companyName: trimOrEmpty(apporteur.companyName) || undefined,
    profile: {
      enabled: true,
      photoUrl: p.photoUrl,
      title: p.title,
      bio: p.bio,
    },
  };
}
