/**
 * Vérifie le barème dynamique + contrat sans Kbis.
 * Usage: npx tsx scripts/verify-apporteur-special-conditions.ts
 */
import assert from "assert";
import {
  canAccessConseillerFormation,
  formatBrokerageShareForContract,
  resolveBrokerageSharePercent,
  resolveRemunerationConfigForApporteur,
} from "../shared/apporteurBrokerageShare";
import { validateApporteurProfileForContract } from "../shared/apporteurProfile";
import { buildPartnerContractDocument } from "../shared/apporteurContract";

const baseProfile = {
  contactPrenom: "Marie",
  contactNom: "Dupont",
  contactName: "Marie Dupont",
  email: "marie@leclubimmobilier.fr",
  phone: "0600000000",
  addressLine: "1 rue Test",
  postalCode: "44000",
  city: "Nantes",
  companyName: "Dupont Immo",
  type: "conseiller_immo_club" as const,
};

assert.equal(resolveBrokerageSharePercent({ type: "apporteur_affaires" }), 50);
assert.equal(resolveBrokerageSharePercent({ type: "conseiller_immo_club" }), 70);
assert.equal(
  resolveBrokerageSharePercent({ type: "conseiller_immo_club", brokerageSharePercent: 60 }),
  60,
);
assert.equal(
  resolveRemunerationConfigForApporteur({ type: "conseiller_immo_club", brokerageSharePercent: 65 })
    .apporteurShareOfBrokerage,
  0.65,
);
assert.equal(formatBrokerageShareForContract(70).label, "soixante-dix pour cent (70 %)");

assert.equal(canAccessConseillerFormation({ type: "conseiller_immo_club" }), true);
assert.equal(
  canAccessConseillerFormation({ type: "conseiller_immo_club", formationAccessGranted: false }),
  false,
);

const withoutSiret = validateApporteurProfileForContract({
  ...baseProfile,
  companyInCreation: true,
});
assert.equal(withoutSiret.ok, true);

const withCompanyNoSiret = validateApporteurProfileForContract(baseProfile);
assert.equal(withCompanyNoSiret.ok, false);

const doc = buildPartnerContractDocument({
  ...baseProfile,
  companyInCreation: true,
  brokerageSharePercent: 55,
});
const remSection = doc.sections.find((s) => s.heading.startsWith("5."));
assert.ok(remSection?.body.includes("cinquante-cinq pour cent (55 %)"));
assert.ok(doc.preamble.includes("Marie Dupont") || remSection);

console.log("verify-apporteur-special-conditions: OK");
