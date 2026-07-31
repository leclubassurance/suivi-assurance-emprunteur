import { addEvent, type Dossier } from "./dossierModel";
import { clearClientInsuranceAcceptance } from "./insuranceAcceptance";
import { cancelConseillerDecisionFollowUps } from "./conseillerDecisionFollowUp";

/**
 * Refus client de la substitution ADE — source de vérité = statut CRM dossier.
 * La reco portail passe en REFUSE via syncReferralFromDossier ensuite.
 */
export function applyClientSubstitutionRefusal(
  dossier: Dossier,
  options: {
    actorLabel: string;
    actorKind?: "APPORTEUR" | "ADMIN" | "SYSTEM";
    note?: string;
  },
): void {
  const actorKind = options.actorKind || "APPORTEUR";
  const now = new Date().toISOString();
  const before = dossier.status;

  dossier.status = "REFUSÉ";
  dossier.statusManualAt = now;
  dossier.updatedAt = now;

  clearClientInsuranceAcceptance(dossier);

  if (
    !dossier.subscriptionProgress ||
    dossier.subscriptionProgress.updatedBy === "system" ||
    dossier.subscriptionProgress.phase === "decision_received"
  ) {
    dossier.subscriptionProgress = {
      phase: "awaiting_decision",
      updatedAt: now,
      updatedBy: options.actorLabel,
      note: options.note || "Refus client de la substitution.",
    };
  }

  addEvent(dossier, {
    type: "STATUS_CHANGED",
    actor: { kind: actorKind, label: options.actorLabel },
    meta: { from: before, to: "REFUSÉ", reason: "client_refused_substitution" },
    message: options.note || "Client a refusé la substitution (signalé par le conseiller).",
  });

  addEvent(dossier, {
    type: "NOTE_ADDED",
    actor: { kind: actorKind, label: options.actorLabel },
    message:
      options.note ||
      "Refus de substitution enregistré — accord client auto éventuel effacé, dossier hors pipeline.",
  });

  cancelConseillerDecisionFollowUps(dossier, "Refus client enregistré.");
}
