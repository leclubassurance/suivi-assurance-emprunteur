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

export type AdeAssistThread = {
  messages: AdeStudyAssistMessage[];
  status: AdeStudyAssistStatus;
  pendingField?: AdeAssistFieldId | null;
  openQuestions?: string[];
};

export type AdeStudyAssistState = {
  mode: AdeAssistMode;
  overrides: AdeStudyAssistOverrides;
  /** Patches manuels sur la fiche Kereis (libellé → valeur). */
  kereisPatches: Record<string, string | number | boolean>;
  /** Conversations persistées par mode (ne se perdent plus au changement d'onglet). */
  threads: {
    kereis: AdeAssistThread;
    study: AdeAssistThread;
  };
  /** Miroir du thread actif (commodité API / UI). */
  messages: AdeStudyAssistMessage[];
  status: AdeStudyAssistStatus;
  pendingField?: AdeAssistFieldId | null;
  openQuestions?: string[];
  updatedAt?: string;
};

export function emptyThread(): AdeAssistThread {
  return { messages: [], status: "idle", pendingField: null, openQuestions: [] };
}
