/** Types partagés assistant ADE (évite cycles d'import avec le chat). */

export type AdeAssistMode = "kereis" | "study";

export type AdeStudyAssistOverrides = {
  currentTotalEur?: number;
  proposedTotalEur?: number;
  remainingMonths?: number;
  feesAssureurEur?: number;
  notes?: string;
};

export type AdeStudyAssistMessage = {
  role: "assistant" | "user";
  content: string;
  at: string;
};

export type AdeStudyAssistStatus = "idle" | "needs_input" | "ready" | "awaiting_clarification";

export type AdeAssistFieldId =
  | "currentTotalEur"
  | "proposedTotalEur"
  | "remainingMonths"
  | "feesAssureurEur";

export type AdeStudyAssistState = {
  mode: AdeAssistMode;
  overrides: AdeStudyAssistOverrides;
  /** Patches manuels sur la fiche Kereis (libellé → valeur). */
  kereisPatches: Record<string, string | number | boolean>;
  messages: AdeStudyAssistMessage[];
  status: AdeStudyAssistStatus;
  pendingField?: AdeAssistFieldId | null;
  openQuestions?: string[];
  updatedAt?: string;
};
