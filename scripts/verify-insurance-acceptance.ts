/**
 * Usage: npx tsx scripts/verify-insurance-acceptance.ts
 */
import {
  clientHasAcceptedInsuranceChange,
  recordClientInsuranceAcceptance,
  syncClientInsuranceAcceptanceFromMail,
} from "../server/insuranceAcceptance";
import {
  applySubscriptionPhaseUpdate,
  clientDecisionIsRecorded,
  resolveEffectiveSubscriptionPhase,
} from "../server/subscriptionProgress";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const baseDossier = {
  id: "LCIF-TEST",
  status: "MAIL_ENVOYÉ",
  createdAt: "2026-07-01T10:00:00.000Z",
  updatedAt: "2026-07-01T10:00:00.000Z",
  formData: {},
  communications: [
    {
      direction: "outbound",
      date: "2026-07-10T10:00:00.000Z",
      subject: "Votre étude",
    },
    {
      direction: "inbound",
      date: "2026-07-11T10:00:00.000Z",
      subject: "Re: étude",
      text: "Je suis d'accord pour le changement d'assurance",
    },
  ],
} as any;

const mailDossier = { ...baseDossier };
assert(syncClientInsuranceAcceptanceFromMail(mailDossier), "sync mail crée un enregistrement");
assert(Boolean(mailDossier.clientAcceptedInsuranceAt), "date accord persistée");
assert(clientHasAcceptedInsuranceChange(mailDossier), "accord lu après persist");

const adminDossier = {
  ...baseDossier,
  communications: baseDossier.communications.slice(0, 1),
} as any;
applySubscriptionPhaseUpdate(adminDossier, "decision_received", {
  updatedBy: "admin",
  note: "Accord oral conseiller",
});
assert(Boolean(adminDossier.clientAcceptedInsuranceAt), "phase admin enregistre accord");
assert(clientDecisionIsRecorded(adminDossier), "décision visible portail conseiller");
assert(
  resolveEffectiveSubscriptionPhase(adminDossier) === "decision_received",
  "phase effective = accord client",
);
assert(adminDossier.status === "ADHESION_EN_COURS", "statut CRM aligné");

const fresh = { ...baseDossier, communications: [] } as any;
recordClientInsuranceAcceptance(fresh, { source: "admin", note: "Test manuel" });
assert(fresh.clientAcceptedInsuranceSource === "admin", "source admin");

console.log("\nInsurance acceptance OK.");
