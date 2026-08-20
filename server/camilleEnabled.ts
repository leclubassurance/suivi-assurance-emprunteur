import { isCamilleProductionSafeMode } from "./camilleClientSafety";

function envFlagTrue(raw: unknown, defaultWhenUnset: string): boolean {
  const v = String(raw ?? defaultWhenUnset).toLowerCase();
  return v !== "false" && v !== "0" && v !== "no";
}

/**
 * Kill switch global — réponses auto client, relances documents proactives, traitement IA Gmail.
 * Opt-in explicite uniquement : CAMILLE_CLIENT_AUTOMATION_ENABLED=true
 * (AI_AUTO_REPLY_ENABLED legacy ignoré pour l'activation — évite les env prod oubliés).
 */
export function isCamilleClientAutomationEnabled(): boolean {
  return envFlagTrue(process.env.CAMILLE_CLIENT_AUTOMATION_ENABLED, "false");
}

/** Relance documents ~2 min après dépôt formulaire (sans mail entrant client). */
export function isCamilleProactiveDocFollowUpEnabled(): boolean {
  if (!isCamilleClientAutomationEnabled()) return false;
  const configured = process.env.AI_PROACTIVE_DOC_FOLLOWUP_ENABLED;
  const v = String(configured ?? (isCamilleProductionSafeMode() ? "false" : "true")).toLowerCase();
  return v !== "false" && v !== "0" && v !== "no";
}

export function camilleAutomationStatusLabel(): string {
  if (!isCamilleClientAutomationEnabled()) return "disabled";
  if (!isCamilleProactiveDocFollowUpEnabled()) return "inbound_only";
  return "full";
}
