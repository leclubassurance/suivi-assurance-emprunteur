/** Fiche de saisie Kereis générée depuis les docs du dossier (MVP). */

export type KereisFieldConfidence = "high" | "medium" | "low" | "missing";

export type KereisField = {
  label: string;
  value: string | number | boolean | null;
  source?: string;
  confidence: KereisFieldConfidence;
  note?: string;
};

export type KereisDraftLoan = {
  label: string;
  fields: KereisField[];
};

export type KereisDraft = {
  computedAt: string;
  effectDateIso: string;
  effectDateLabel: string;
  clientName: string;
  steps: {
    coordonnees: KereisField[];
    infosPerso: KereisField[];
    prets: KereisDraftLoan[];
    preteur: KereisField[];
    simulations: KereisField[];
  };
  missing: string[];
  warnings: string[];
  copyText: string;
  sourceDocs: { category: string; name: string; chars: number }[];
  provider: "gemini" | "heuristic" | "mixed";
};
