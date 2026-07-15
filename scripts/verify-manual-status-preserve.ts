/**
 * Usage: npx tsx scripts/verify-manual-status-preserve.ts
 */
import type { Dossier } from "../server/dossierModel";
import { mergeManualDossierOverrides } from "../server/dossierManualOverrides";
import {
  resolveEffectiveSubscriptionPhase,
  applySubscriptionPhaseUpdate,
} from "../server/subscriptionProgress";
import { inferReferralStatusFromDossier } from "../server/apporteurStore";
import { resolveClientPortalStatusView } from "../server/subscriptionProgress";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const adminLocked: Dossier = {
  id: "LCIF-022211",
  status: "ADHESION_EN_COURS",
  statusManualAt: "2026-07-15T10:00:00.000Z",
  subscriptionProgress: {
    phase: "adhesion_space_sent",
    updatedAt: "2026-07-15T10:00:00.000Z",
    updatedBy: "admin",
  },
  clientAcceptedInsuranceAt: "2026-07-15T10:00:00.000Z",
  clientAcceptedInsuranceSource: "admin",
  communications: [{ direction: "outbound", subject: "Votre étude personnalisée", date: "2026-07-10T10:00:00.000Z" }],
} as Dossier;

const gmailStale: Dossier = {
  ...adminLocked,
  status: "MAIL_ENVOYÉ",
  statusManualAt: undefined,
  subscriptionProgress: {
    phase: "awaiting_decision",
    updatedAt: "2026-07-14T10:00:00.000Z",
    updatedBy: "system",
  },
  clientAcceptedInsuranceAt: undefined,
  clientAcceptedInsuranceSource: undefined,
} as Dossier;

const merged = mergeManualDossierOverrides(adminLocked, gmailStale);
assert(merged.status === "ADHESION_EN_COURS", "merge Firestore conserve statut admin");
assert(Boolean(merged.statusManualAt), "merge conserve statusManualAt");
assert(merged.subscriptionProgress?.phase === "adhesion_space_sent", "merge conserve phase admin");
assert(Boolean(merged.clientAcceptedInsuranceAt), "merge conserve accord client");

assert(
  resolveEffectiveSubscriptionPhase(merged) === "adhesion_space_sent",
  "phase effective = espace adhésion",
);

const portal = resolveClientPortalStatusView(merged);
assert(
  portal.label.includes("Adhésion") || portal.label.includes("Décision"),
  `portail client pas bloqué sur étude envoyée (${portal.label})`,
);

assert(inferReferralStatusFromDossier(merged) === "SIGNE", "reco apporteur = signé");

const fromStatusChange = {
  id: "LCIF-TEST",
  status: "MAIL_ENVOYÉ",
  communications: [{ direction: "outbound", subject: "Votre étude", date: "2026-07-10T10:00:00.000Z" }],
} as Dossier;

applySubscriptionPhaseUpdate(fromStatusChange, "adhesion_space_sent", {
  updatedBy: "admin",
  note: "Espace adhésion ouvert",
});
assert(fromStatusChange.status === "ADHESION_EN_COURS", "phase adhésion aligne statut CRM");

console.log("\nManual status preserve OK.");
