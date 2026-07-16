/**
 * Usage: npx tsx scripts/verify-apporteur-public-profile.ts
 */
import {
  buildApporteurPublicRefPayload,
  normalizeApporteurPublicProfile,
  validateApporteurPublicProfile,
} from "../shared/apporteurPublicProfile";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const normalized = normalizeApporteurPublicProfile(
  {
    enabled: true,
    photoUrl: "https://example.com/photo.jpg",
    title: "Conseiller immobilier",
    bio: "Je vous accompagne pour votre assurance emprunteur.",
  },
  { updatedBy: "conseiller" },
);

assert(normalized.enabled === true, "enabled");
assert(normalized.photoUrl?.startsWith("https://") === true, "photo https");
assert(validateApporteurPublicProfile(normalized).ok === true, "validation ok");

const badUrl = normalizeApporteurPublicProfile({
  enabled: true,
  photoUrl: "http://insecure.example/photo.jpg",
  title: "X",
});
assert(validateApporteurPublicProfile(badUrl).ok === false, "http photo rejected");

const emptyEnabled = normalizeApporteurPublicProfile({ enabled: true });
assert(validateApporteurPublicProfile(emptyEnabled).ok === false, "enabled without content rejected");

const payload = buildApporteurPublicRefPayload({
  active: true,
  contactName: "Marie Dupont",
  companyName: "Agence Demo",
  publicProfile: normalized,
});
assert(Boolean(payload), "public payload built");
assert(payload!.profile.enabled === true, "payload enabled");
assert(payload!.contactName === "Marie Dupont", "contact name");

const hidden = buildApporteurPublicRefPayload({
  active: true,
  contactName: "Marie Dupont",
  publicProfile: { ...normalized, enabled: false },
});
assert(hidden === null, "disabled profile not public");

console.log("\nApporteur public profile OK.");
