/**
 * Assistant ADE in-app : modes Kereis (fiche devis) + Étude économie.
 * Prompt courtier : shared/adeBrokerSystemPrompt.ts
 */
import type { EconomyComputation } from "./economyFromDocs";
import type { AdeFeasibilityAssessment } from "./adeStudyFeasibility";
import type {
  AdeAssistFieldId,
  AdeAssistMode,
  AdeStudyAssistMessage,
  AdeStudyAssistOverrides,
  AdeStudyAssistState,
  AdeStudyAssistStatus,
} from "./adeStudyAssistTypes";

export type {
  AdeAssistFieldId,
  AdeAssistMode,
  AdeStudyAssistMessage,
  AdeStudyAssistOverrides,
  AdeStudyAssistState,
  AdeStudyAssistStatus,
} from "./adeStudyAssistTypes";

export type AdeAssistFieldNeed = {
  id: AdeAssistFieldId;
  label: string;
  required: boolean;
  question: string;
  unit: "eur" | "months";
};

function nowIso() {
  return new Date().toISOString();
}

function msg(role: "assistant" | "user", content: string): AdeStudyAssistMessage {
  return { role, content, at: nowIso() };
}

export function getAdeStudyAssist(dossier: any): AdeStudyAssistState {
  const raw = (dossier as any)?.adeStudyAssist;
  if (!raw || typeof raw !== "object") {
    return {
      mode: "study",
      overrides: {},
      kereisPatches: {},
      messages: [],
      status: "idle",
      pendingField: null,
      openQuestions: [],
    };
  }
  return {
    mode: raw.mode === "kereis" ? "kereis" : "study",
    overrides: { ...(raw.overrides || {}) },
    kereisPatches: { ...(raw.kereisPatches || {}) },
    messages: Array.isArray(raw.messages) ? raw.messages.slice(-80) : [],
    status: (raw.status as AdeStudyAssistStatus) || "idle",
    pendingField: (raw.pendingField as AdeAssistFieldId | null) ?? null,
    openQuestions: Array.isArray(raw.openQuestions) ? raw.openQuestions : [],
    updatedAt: raw.updatedAt,
  };
}

export function getAdeAssistOverrides(dossier: any): AdeStudyAssistOverrides {
  return getAdeStudyAssist(dossier).overrides || {};
}

export function areAdeAssistOverridesComplete(
  overrides: AdeStudyAssistOverrides | null | undefined,
): boolean {
  if (!overrides) return false;
  const cur = overrides.currentTotalEur;
  const prop = overrides.proposedTotalEur;
  const months = overrides.remainingMonths;
  return (
    typeof cur === "number" &&
    cur > 0 &&
    typeof prop === "number" &&
    prop > 0 &&
    typeof months === "number" &&
    months >= 12
  );
}

export function resolveEffectiveEconomyAnchors(
  eco: EconomyComputation,
  overrides: AdeStudyAssistOverrides,
): {
  currentTotalEur: number | null;
  proposedTotalEur: number | null;
  remainingMonths: number | null;
  feesAssureurEur: number | null;
  fromAssist: AdeAssistFieldId[];
} {
  const fromAssist: AdeAssistFieldId[] = [];
  let current =
    eco.extracted.currentTotalRemaining != null && eco.extracted.currentTotalRemaining > 0
      ? eco.extracted.currentTotalRemaining
      : null;
  let proposed =
    eco.extracted.proposedTotalRemaining != null && eco.extracted.proposedTotalRemaining > 0
      ? eco.extracted.proposedTotalRemaining
      : null;
  let months =
    eco.extracted.remainingMonths != null && eco.extracted.remainingMonths >= 12
      ? eco.extracted.remainingMonths
      : null;
  let fees =
    eco.extracted.feesAssureurTotal != null && eco.extracted.feesAssureurTotal > 0
      ? eco.extracted.feesAssureurTotal
      : null;

  if (overrides.currentTotalEur != null && overrides.currentTotalEur > 0) {
    current = overrides.currentTotalEur;
    fromAssist.push("currentTotalEur");
  }
  if (overrides.proposedTotalEur != null && overrides.proposedTotalEur > 0) {
    proposed = overrides.proposedTotalEur;
    fromAssist.push("proposedTotalEur");
  }
  if (overrides.remainingMonths != null && overrides.remainingMonths >= 12) {
    months = overrides.remainingMonths;
    fromAssist.push("remainingMonths");
  }
  if (overrides.feesAssureurEur != null && overrides.feesAssureurEur >= 0) {
    fees = overrides.feesAssureurEur;
    fromAssist.push("feesAssureurEur");
  }

  return {
    currentTotalEur: current,
    proposedTotalEur: proposed,
    remainingMonths: months,
    feesAssureurEur: fees,
    fromAssist,
  };
}

/** Fusionne extraction locale + overrides manuels pour le pipeline ADE. */
export function applyAdeAssistOverrides(
  eco: EconomyComputation,
  overrides: AdeStudyAssistOverrides,
): EconomyComputation {
  if (!overrides || !Object.keys(overrides).length) return eco;

  const anchors = resolveEffectiveEconomyAnchors(eco, overrides);
  const extracted = { ...eco.extracted };
  const reasons = [...eco.reasons];

  if (anchors.fromAssist.includes("currentTotalEur") && anchors.currentTotalEur != null) {
    extracted.currentTotalRemaining = anchors.currentTotalEur;
    reasons.push(`Assistant ADE : coût actuel forcé à ${anchors.currentTotalEur.toFixed(2)} €`);
  }
  if (anchors.fromAssist.includes("proposedTotalEur") && anchors.proposedTotalEur != null) {
    extracted.proposedTotalRemaining = anchors.proposedTotalEur;
    reasons.push(`Assistant ADE : devis forcé à ${anchors.proposedTotalEur.toFixed(2)} €`);
  }
  if (anchors.fromAssist.includes("remainingMonths") && anchors.remainingMonths != null) {
    extracted.remainingMonths = anchors.remainingMonths;
    reasons.push(`Assistant ADE : durée forcée à ${anchors.remainingMonths} mois`);
  }
  if (anchors.fromAssist.includes("feesAssureurEur") && anchors.feesAssureurEur != null) {
    extracted.feesAssureurTotal = anchors.feesAssureurEur;
    reasons.push(`Assistant ADE : frais assureur ${anchors.feesAssureurEur.toFixed(2)} €`);
  }
  if (overrides.notes) {
    reasons.push(`Assistant ADE notes : ${overrides.notes.slice(0, 200)}`);
  }

  const cur = extracted.currentTotalRemaining;
  const prop = extracted.proposedTotalRemaining;
  const months = extracted.remainingMonths;
  const ok =
    typeof cur === "number" &&
    cur > 0 &&
    typeof prop === "number" &&
    prop > 0 &&
    typeof months === "number" &&
    months >= 12;

  const reliability = anchors.fromAssist.length
    ? ("MEDIUM" as const)
    : eco.reliability;

  if (!ok) {
    return { ok: false, reliability: "LOW", reasons, extracted };
  }

  const grossSavings = cur! - prop!;
  return {
    ok: true,
    reliability,
    reasons,
    extracted,
    result: {
      ...(eco.result || {}),
      grossSavings,
      currentTotalRemaining: cur,
      proposedTotalRemaining: prop,
      table: eco.result?.table,
      grossSavings8y: eco.result?.grossSavings8y,
    },
  };
}

function effectiveValue(
  field: AdeAssistFieldId,
  eco: EconomyComputation,
  overrides: AdeStudyAssistOverrides,
): number | null {
  const a = resolveEffectiveEconomyAnchors(eco, overrides);
  switch (field) {
    case "currentTotalEur":
      return a.currentTotalEur;
    case "proposedTotalEur":
      return a.proposedTotalEur;
    case "remainingMonths":
      return a.remainingMonths;
    case "feesAssureurEur":
      return a.feesAssureurEur;
  }
}

export function buildAssistAgenda(
  eco: EconomyComputation,
  overrides: AdeStudyAssistOverrides,
  feasibility?: AdeFeasibilityAssessment | null,
): AdeAssistFieldNeed[] {
  const agenda: AdeAssistFieldNeed[] = [];
  const hasDevis = Boolean(feasibility?.summary?.hasDevis);

  if (effectiveValue("currentTotalEur", eco, overrides) == null) {
    agenda.push({
      id: "currentTotalEur",
      label: "Coût assurance actuelle restant",
      required: true,
      unit: "eur",
      question:
        "Je n'arrive pas à extraire le **coût total d'assurance actuelle restant** (somme des cotisations assurance sur le(s) échéancier(s)).\n\nQuel montant total en euros TTC dois-je utiliser ?",
    });
  }

  if (effectiveValue("remainingMonths", eco, overrides) == null) {
    agenda.push({
      id: "remainingMonths",
      label: "Durée restante",
      required: true,
      unit: "months",
      question:
        "Quelle est la **durée restante** du (des) prêt(s) en mois ? (ex. 222, 248 — minimum 12)",
    });
  }

  if (effectiveValue("proposedTotalEur", eco, overrides) == null) {
    agenda.push({
      id: "proposedTotalEur",
      label: "Total cotisations devis",
      required: true,
      unit: "eur",
      question: hasDevis
        ? "Le devis est présent mais le **total des cotisations** est introuvable.\n\nQuel est le montant total TTC des cotisations du devis (hors frais d'adhésion si séparés) ?"
        : "Aucun devis détecté. Après upload, indiquez le **total cotisations devis** TTC, ou uploadez d'abord le PDF devis puis relancez l'assistant.",
    });
  }

  // Soft : frais seulement si manquants et qu'on a déjà les 3 requis (ou on les aura juste avant)
  const requiredSoonComplete =
    (effectiveValue("currentTotalEur", eco, overrides) != null ||
      agenda.some((a) => a.id === "currentTotalEur")) &&
    (effectiveValue("proposedTotalEur", eco, overrides) != null ||
      agenda.some((a) => a.id === "proposedTotalEur")) &&
    (effectiveValue("remainingMonths", eco, overrides) != null ||
      agenda.some((a) => a.id === "remainingMonths"));

  if (
    requiredSoonComplete &&
    effectiveValue("feesAssureurEur", eco, overrides) == null &&
    !overrides.feesAssureurEur
  ) {
    // Only ask fees when required fields are already filled (not still in agenda for required)
    const stillNeedRequired = agenda.some((a) => a.required);
    if (!stillNeedRequired) {
      agenda.push({
        id: "feesAssureurEur",
        label: "Frais assureur",
        required: false,
        unit: "eur",
        question:
          "Frais assureur (adhésion / dossier) non trouvés — souvent 75 €, 110 € ou 0.\n\nQuel montant ? (répondez `0` ou `passer` pour ignorer)",
      });
    }
  }

  return agenda;
}

/** Parse un montant FR ou une durée depuis une réponse libre. */
export function parseAssistNumber(
  text: string,
  unit: "eur" | "months",
): { value: number | null; skip?: boolean; ambiguous?: boolean } {
  const raw = String(text || "").trim();
  const lower = raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  if (/^(passer|skip|ignore|na|n\/a|aucun|rien)$/i.test(lower.trim())) {
    return { value: null, skip: true };
  }

  // "environ 2000" → ambiguous unless we still extract
  const approx = /\b(environ|approx|~|vers|autour)\b/i.test(raw);

  if (unit === "months") {
    const m = raw.match(/(\d{2,3})\s*(mois|m)?/i) || raw.match(/^(\d{2,3})\s*$/);
    if (m?.[1]) {
      const n = Number(m[1]);
      if (n >= 12 && n <= 600) return { value: n, ambiguous: approx };
    }
    return { value: null };
  }

  // euros: 4 426,94 / 4426.94 / 4426 — éviter de découper 2028.60 en 202 + 8.60
  const moneyRx =
    /(\d{1,3}(?:[ .\u00a0]\d{3})+,\d{1,2}|\d{1,3}(?:[ .\u00a0]\d{3})+(?![\d,])|\d+,\d{1,2}|\d+\.\d{1,2}|\d{4,}|\d{1,3})(?=\s*(?:€|euros?\b)?|$|[^0-9.,])/gi;
  const candidates: number[] = [];
  for (const m of raw.matchAll(moneyRx)) {
    const token = m[1];
    const normalized = token
      .replace(/[\s\u00a0]/g, "")
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".");
    const n = Number(normalized);
    if (Number.isFinite(n) && n >= 0 && n < 1_000_000) candidates.push(n);
  }

  if (!candidates.length) return { value: null };
  // Prefer the largest amount (totals >> fees fragments)
  const max = Math.max(...candidates);
  if (candidates.length === 1) return { value: max, ambiguous: approx };
  if (approx || candidates.filter((c) => c > 100).length > 1) {
    return { value: max, ambiguous: true };
  }
  return { value: max };
}

async function refineNumberWithGemini(
  userText: string,
  field: AdeAssistFieldId,
  unit: "eur" | "months",
): Promise<number | null> {
  if (!process.env.GEMINI_API_KEY) return null;
  try {
    const { generateContentWithRetry } = await import("./geminiClient");
    const res = await generateContentWithRetry({
      model: process.env.ADE_STUDY_MODEL || "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Extrais UNIQUEMENT un JSON {"value": number|null, "skip": boolean} depuis la réponse admin pour le champ "${field}" (unité ${unit}).
Règles: value = nombre positif; skip=true si l'admin veut ignorer; null si illisible.
Réponse admin: """${userText.slice(0, 400)}"""`,
            },
          ],
        },
      ],
      config: { temperature: 0, maxOutputTokens: 80 },
    });
    const text = String(res?.text || "");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    if (parsed?.skip) return null;
    const v = Number(parsed?.value);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function formatEur(n: number) {
  return `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function snapshotLines(
  eco: EconomyComputation,
  overrides: AdeStudyAssistOverrides,
): string {
  const a = resolveEffectiveEconomyAnchors(eco, overrides);
  const line = (label: string, v: number | null, unit: "eur" | "months", forced: boolean) => {
    if (v == null) return `• ${label} : ❌ manquant`;
    const val = unit === "eur" ? formatEur(v) : `${v} mois`;
    return `• ${label} : ✅ ${val}${forced ? " (saisi)" : " (extrait)"}`;
  };
  return [
    line("Assurance actuelle", a.currentTotalEur, "eur", Boolean(overrides.currentTotalEur)),
    line("Devis proposé", a.proposedTotalEur, "eur", Boolean(overrides.proposedTotalEur)),
    line("Durée restante", a.remainingMonths, "months", Boolean(overrides.remainingMonths)),
    line("Frais assureur", a.feesAssureurEur, "eur", overrides.feesAssureurEur != null),
  ].join("\n");
}

function finalizeState(
  state: AdeStudyAssistState,
  eco: EconomyComputation,
): AdeStudyAssistState {
  const anchors = resolveEffectiveEconomyAnchors(eco, state.overrides);
  const ready =
    anchors.currentTotalEur != null &&
    anchors.currentTotalEur > 0 &&
    anchors.proposedTotalEur != null &&
    anchors.proposedTotalEur > 0 &&
    anchors.remainingMonths != null &&
    anchors.remainingMonths >= 12;

  if (ready) {
    // Persister les valeurs effectives (extraites ou saisies) pour le bypass pipeline
    const nextOverrides: AdeStudyAssistOverrides = {
      ...state.overrides,
      currentTotalEur: anchors.currentTotalEur!,
      proposedTotalEur: anchors.proposedTotalEur!,
      remainingMonths: anchors.remainingMonths!,
    };
    if (anchors.feesAssureurEur != null && nextOverrides.feesAssureurEur == null) {
      nextOverrides.feesAssureurEur = anchors.feesAssureurEur;
    }
    return {
      ...state,
      overrides: nextOverrides,
      status: "ready",
      pendingField: null,
      updatedAt: nowIso(),
    };
  }

  return {
    ...state,
    status: "needs_input",
    updatedAt: nowIso(),
  };
}

export async function startAdeStudyAssist(params: {
  dossier: any;
  feasibility?: AdeFeasibilityAssessment | null;
  mode?: AdeAssistMode;
  uploadsDir?: string;
}): Promise<{ assist: AdeStudyAssistState; eco: EconomyComputation }> {
  const mode: AdeAssistMode = params.mode === "kereis" ? "kereis" : "study";
  const { computeEconomyFromDossierDocs } = await import("./economyFromDocs");
  const eco = await computeEconomyFromDossierDocs(params.dossier);
  const prev = getAdeStudyAssist(params.dossier);

  let state: AdeStudyAssistState = {
    mode,
    overrides: { ...prev.overrides },
    kereisPatches: { ...prev.kereisPatches },
    messages: mode === prev.mode ? [...prev.messages] : [],
    status: "needs_input",
    pendingField: null,
    openQuestions: [],
    updatedAt: nowIso(),
  };

  if (mode === "kereis") {
    // S'assurer qu'une fiche existe
    if (!(params.dossier as any).kereisDraft && params.uploadsDir) {
      try {
        const { buildKereisDraftForDossier } = await import("./kereisDraftBuild");
        await buildKereisDraftForDossier({
          dossier: params.dossier,
          uploadsDir: params.uploadsDir,
          actorLabel: "Assistant ADE",
        });
      } catch {
        /* best-effort */
      }
    }
    if (Object.keys(state.kereisPatches).length && (params.dossier as any).kereisDraft) {
      const { applyKereisDraftPatches } = await import("./kereisDraftBuild");
      (params.dossier as any).kereisDraft = applyKereisDraftPatches(
        (params.dossier as any).kereisDraft,
        state.kereisPatches,
      );
    }

    const draft = (params.dossier as any).kereisDraft;
    const missing: string[] = Array.isArray(draft?.missing) ? draft.missing : [];
    const warnings: string[] = Array.isArray(draft?.warnings) ? draft.warnings.slice(0, 4) : [];
    const intro = [
      "**Mode Kereis** — je vous aide à compléter la fiche pour générer le devis (sans inventer de chiffres).",
      draft
        ? `Fiche du ${draft.effectDateLabel || "?"} · effet J+3 mois · ${missing.length} champ(s) à compléter.`
        : "Aucune fiche Kereis encore — cliquez d'abord sur « Préparer fiche Kereis », ou décrivez ce qui manque.",
      missing.length ? `Manquants : ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? "…" : ""}.` : "Aucun champ manquant détecté — je peux quand même vérifier les alertes / Lemoine / CRD.",
      warnings.length ? `Alertes : ${warnings.join(" · ")}` : "",
      "",
      missing[0]
        ? `Première question — **${missing[0]}** : quelle valeur dois-je retenir ? (ou expliquez l'ambiguïté)`
        : "Que voulez-vous vérifier ou corriger sur la fiche Kereis ?",
    ]
      .filter(Boolean)
      .join("\n");

    state.status = missing.length ? "needs_input" : "ready";
    state.messages = [...state.messages, msg("assistant", intro)];
    state.updatedAt = nowIso();
    return { assist: state, eco };
  }

  // Mode étude
  const agenda = buildAssistAgenda(eco, state.overrides, params.feasibility);
  state = finalizeState(state, eco);

  if (state.status === "ready") {
    const a = resolveEffectiveEconomyAnchors(eco, state.overrides);
    state.messages = [
      ...state.messages,
      msg(
        "assistant",
        `**Mode Étude** — ancrages complets. Vous pouvez générer le PDF.\n\n${snapshotLines(eco, state.overrides)}\n\nÉconomie brute estimée : ${formatEur((a.currentTotalEur || 0) - (a.proposedTotalEur || 0))}.\n\nPosez-moi une question si vous voulez un contrôle STOP & DEMANDER (multi-devis, CRD, Lemoine…).`,
      ),
    ];
    return { assist: state, eco };
  }

  const next = agenda[0];
  const scoreBit =
    params.feasibility && !params.feasibility.pass
      ? `Score faisabilité ${params.feasibility.score}/${params.feasibility.max} — génération auto bloquée. `
      : "";
  const intro =
    `**Mode Étude économie** — ${scoreBit}je complète les ancrages manquants (rigueur courtier ADE, jamais d'invention).\n\n${snapshotLines(eco, state.overrides)}\n\n`;

  if (!next) {
    state.messages = [...state.messages, msg("assistant", intro + "Que souhaitez-vous clarifier ?")];
    return { assist: state, eco };
  }

  state.pendingField = next.id;
  state.status = "needs_input";
  state.messages = [...state.messages, msg("assistant", intro + next.question)];
  return { assist: state, eco };
}

function mergeOverrides(
  base: AdeStudyAssistOverrides,
  patch?: AdeStudyAssistOverrides,
): AdeStudyAssistOverrides {
  if (!patch) return base;
  const next = { ...base };
  for (const key of ["currentTotalEur", "proposedTotalEur", "remainingMonths", "feesAssureurEur"] as const) {
    if (patch[key] != null && Number.isFinite(Number(patch[key]))) next[key] = Number(patch[key]);
  }
  if (patch.notes) next.notes = patch.notes;
  return next;
}

export async function handleAdeStudyAssistMessage(params: {
  dossier: any;
  userText: string;
  feasibility?: AdeFeasibilityAssessment | null;
  mode?: AdeAssistMode;
  uploadsDir?: string;
}): Promise<{ assist: AdeStudyAssistState; eco: EconomyComputation; error?: string }> {
  const userText = String(params.userText || "").trim();
  if (!userText) {
    return {
      assist: getAdeStudyAssist(params.dossier),
      eco: await (await import("./economyFromDocs")).computeEconomyFromDossierDocs(params.dossier),
      error: "Message vide",
    };
  }

  const { computeEconomyFromDossierDocs } = await import("./economyFromDocs");
  const eco = await computeEconomyFromDossierDocs(params.dossier);
  let state = getAdeStudyAssist(params.dossier);
  const mode: AdeAssistMode = params.mode || state.mode || "study";
  state = {
    ...state,
    mode,
    overrides: { ...state.overrides },
    kereisPatches: { ...state.kereisPatches },
    messages: [...state.messages, msg("user", userText)],
    openQuestions: [...(state.openQuestions || [])],
  };

  if (/^(reset|recommencer|reinitialiser|réinitialiser)$/i.test(userText)) {
    state = resetAdeStudyAssist(mode);
    const restarted = await startAdeStudyAssist({
      dossier: { ...params.dossier, adeStudyAssist: state },
      feasibility: params.feasibility,
      mode,
      uploadsDir: params.uploadsDir,
    });
    return { assist: restarted.assist, eco: restarted.eco };
  }

  // --- Mode étude : chemin rapide si pendingField + nombre clair ---
  if (mode === "study" && state.pendingField) {
    const agenda = buildAssistAgenda(eco, state.overrides, params.feasibility);
    const field = agenda.find((a) => a.id === state.pendingField) || agenda[0];
    if (field) {
      let parsed = parseAssistNumber(userText, field.unit);
      if (parsed.value == null && !parsed.skip) {
        const gem = await refineNumberWithGemini(userText, field.id, field.unit);
        if (gem != null) parsed = { value: gem };
      }

      if (parsed.skip && !field.required) {
        if (field.id === "feesAssureurEur") state.overrides.feesAssureurEur = 0;
        state.messages.push(msg("assistant", "Frais ignorés (0 €)."));
        state.pendingField = null;
      } else if (parsed.value != null && !parsed.ambiguous) {
        if (field.unit === "months" && (parsed.value < 12 || parsed.value > 600)) {
          state.messages.push(msg("assistant", "La durée doit être entre 12 et 600 mois. Réessayez."));
          state.updatedAt = nowIso();
          return { assist: state, eco };
        }
        if (field.unit === "eur" && field.required && parsed.value <= 0) {
          state.messages.push(msg("assistant", "Le montant doit être strictement positif. Réessayez."));
          return { assist: state, eco };
        }
        state.overrides = { ...state.overrides, [field.id]: parsed.value };
        state.messages.push(
          msg(
            "assistant",
            `Noté : **${field.label}** = ${field.unit === "eur" ? formatEur(parsed.value) : `${parsed.value} mois`}.`,
          ),
        );
        state.pendingField = null;

        const nextAgenda = buildAssistAgenda(eco, state.overrides, params.feasibility);
        state = finalizeState(state, eco);
        if (state.status === "ready") {
          const soft = nextAgenda.find((a) => !a.required);
          if (soft && state.overrides.feesAssureurEur == null) {
            state.status = "needs_input";
            state.pendingField = soft.id;
            state.messages.push(msg("assistant", soft.question));
            state.updatedAt = nowIso();
            return { assist: state, eco };
          }
          const a = resolveEffectiveEconomyAnchors(eco, state.overrides);
          state.messages.push(
            msg(
              "assistant",
              `Parfait — ancrages complets. Cliquez sur **Générer étude depuis devis**.\n\n${snapshotLines(eco, state.overrides)}\n\nÉconomie brute : **${formatEur((a.currentTotalEur || 0) - (a.proposedTotalEur || 0))}**.`,
            ),
          );
          state.updatedAt = nowIso();
          return { assist: state, eco };
        }
        const next = nextAgenda[0];
        if (next) {
          state.pendingField = next.id;
          state.messages.push(msg("assistant", `${snapshotLines(eco, state.overrides)}\n\n${next.question}`));
          state.updatedAt = nowIso();
          return { assist: state, eco };
        }
      } else if (parsed.ambiguous && parsed.value != null) {
        state.messages.push(
          msg(
            "assistant",
            `J'ai lu **${field.unit === "eur" ? formatEur(parsed.value) : `${parsed.value} mois`}**. Confirmez avec uniquement ce chiffre, ou corrigez.`,
          ),
        );
        state.updatedAt = nowIso();
        return { assist: state, eco };
      }
      // sinon : tombe dans le chat Gemini
    }
  }

  // --- Chat courtier (Gemini + prompt) ---
  const { runAdeAssistChatTurn } = await import("./adeAssistChat");
  const chat = await runAdeAssistChatTurn({
    dossier: { ...params.dossier, adeStudyAssist: state },
    mode,
    userText,
    history: state.messages.slice(0, -1),
  });

  if (chat.economyOverrides) {
    state.overrides = mergeOverrides(state.overrides, chat.economyOverrides);
  }
  if (chat.kereisPatches) {
    state.kereisPatches = { ...state.kereisPatches, ...chat.kereisPatches };
    if ((params.dossier as any).kereisDraft) {
      const { applyKereisDraftPatches } = await import("./kereisDraftBuild");
      (params.dossier as any).kereisDraft = applyKereisDraftPatches(
        (params.dossier as any).kereisDraft,
        state.kereisPatches,
      );
    }
  }

  let reply = chat.reply;
  if (chat.openQuestion) {
    state.openQuestions = [...(state.openQuestions || []), chat.openQuestion].slice(-10);
  }
  if (chat.stopAndAsk && chat.openQuestion && !reply.includes(chat.openQuestion)) {
    reply = `${reply}\n\n**STOP & DEMANDER** — ${chat.openQuestion}`;
  }

  state.messages.push(msg("assistant", reply));

  if (mode === "study") {
    state = finalizeState(state, eco);
    if (chat.studyReady || state.status === "ready") {
      state = finalizeState(state, eco);
      if (areAdeAssistOverridesComplete(state.overrides) || chat.studyReady) {
        const a = resolveEffectiveEconomyAnchors(eco, state.overrides);
        if (a.currentTotalEur && a.proposedTotalEur && a.remainingMonths) {
          state.overrides = {
            ...state.overrides,
            currentTotalEur: a.currentTotalEur,
            proposedTotalEur: a.proposedTotalEur,
            remainingMonths: a.remainingMonths,
          };
          state.status = "ready";
          state.pendingField = null;
        }
      }
    } else if (chat.stopAndAsk) {
      state.status = "awaiting_clarification";
    } else {
      const agenda = buildAssistAgenda(eco, state.overrides, params.feasibility);
      if (agenda[0] && !state.pendingField) {
        state.pendingField = agenda[0].id;
        state.status = "needs_input";
      }
    }
  } else {
    const missing = (params.dossier as any).kereisDraft?.missing || [];
    state.status = chat.kereisReady || missing.length === 0 ? "ready" : chat.stopAndAsk ? "awaiting_clarification" : "needs_input";
  }

  state.updatedAt = nowIso();
  return { assist: state, eco };
}

export function resetAdeStudyAssist(mode: AdeAssistMode = "study"): AdeStudyAssistState {
  return {
    mode,
    overrides: {},
    kereisPatches: {},
    messages: [
      msg(
        "assistant",
        mode === "kereis"
          ? "Assistant Kereis réinitialisé. Cliquez sur Démarrer / ouvrez l'assistant pour reprendre."
          : "Assistant étude réinitialisé. Cliquez sur Démarrer pour reprendre.",
      ),
    ],
    status: "idle",
    pendingField: null,
    openQuestions: [],
    updatedAt: nowIso(),
  };
}

/** Pour le pipeline : overrides complets autorisent le bypass score. */
export function dossierHasAdeAssistBypass(dossier: any): boolean {
  return areAdeAssistOverridesComplete(getAdeStudyAssist(dossier).overrides);
}
