/**
 * Tour de chat Gemini pour l'assistant ADE (prompt courtier + contexte dossier).
 */
import { ADE_BROKER_SYSTEM_PROMPT, adeBrokerModeAddon } from "../shared/adeBrokerSystemPrompt";
import type { AdeAssistMode, AdeStudyAssistOverrides } from "./adeStudyAssistTypes";

export type AdeAssistChatResult = {
  reply: string;
  stopAndAsk?: boolean;
  economyOverrides?: AdeStudyAssistOverrides;
  kereisPatches?: Record<string, string | number | boolean>;
  studyReady?: boolean;
  kereisReady?: boolean;
  openQuestion?: string | null;
};

function extractJsonObject(text: string): any | null {
  const raw = String(text || "").trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence?.[1]?.trim() || raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function buildDossierContext(dossier: any, mode: AdeAssistMode): string {
  const a0 = dossier?.formData?.assures?.[0] || {};
  const docs = (dossier?.formData?.documents || []) as any[];
  const docLines = docs
    .slice(0, 20)
    .map((d) => `- ${d.category || "?"} : ${d.name || "?"} (${d.size || "?"} o)`)
    .join("\n");
  const draft = dossier?.kereisDraft;
  const missing = Array.isArray(draft?.missing) ? draft.missing.join(", ") : "(pas de fiche Kereis encore)";
  const warnings = Array.isArray(draft?.warnings) ? draft.warnings.slice(0, 6).join(" | ") : "";
  const feas = dossier?.adeStudyFeasibility;
  const assist = dossier?.adeStudyAssist;
  const ov = assist?.overrides || {};

  return `DOSSIER ${dossier?.id || "?"}
Client: ${[a0.prenom, a0.nom].filter(Boolean).join(" ") || "?"}
Email: ${a0.email || "—"} · Tél: ${a0.telephone || "—"}
Statut CRM: ${dossier?.status || "—"}
Assurés: ${(dossier?.formData?.assures || []).length || 0} · Prêts formulaire: ${(dossier?.formData?.prets || []).length || 0}

Documents:
${docLines || "(aucun)"}

Fiche Kereis — champs manquants: ${missing}
${warnings ? `Alertes Kereis: ${warnings}` : ""}
Date d'effet Kereis: ${draft?.effectDateLabel || draft?.effectDateIso || "—"}

Faisabilité étude: ${feas?.score != null ? `${feas.score}/${feas.max} pass=${feas.pass}` : "non évaluée"}
Blockers: ${Array.isArray(feas?.blockers) ? feas.blockers.slice(0, 5).join(" · ") : "—"}

Ancrages étude déjà saisis:
- actuelle: ${ov.currentTotalEur ?? "—"}
- proposée: ${ov.proposedTotalEur ?? "—"}
- mois: ${ov.remainingMonths ?? "—"}
- frais: ${ov.feesAssureurEur ?? "—"}

Mode UI: ${mode}`;
}

export async function runAdeAssistChatTurn(params: {
  dossier: any;
  mode: AdeAssistMode;
  userText: string;
  history: Array<{ role: "assistant" | "user"; content: string }>;
}): Promise<AdeAssistChatResult> {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes("MY_GEMINI")) {
    return {
      reply:
        "Gemini n'est pas configuré sur le serveur. Indiquez les montants / champs manquants en clair (ex. « actuelle 4426,94 » ou « Banque : Caisse d'Épargne ») — le parseur local prendra le relais quand c'est possible.",
      stopAndAsk: true,
    };
  }

  const { generateContentWithRetry } = await import("./geminiClient");
  const historySlice = params.history.slice(-12);
  const historyText = historySlice
    .map((m) => `${m.role === "user" ? "RÉMI" : "ASSISTANT"}: ${m.content}`)
    .join("\n\n");

  const prompt = `${ADE_BROKER_SYSTEM_PROMPT}

${adeBrokerModeAddon(params.mode)}

## Contexte dossier
${buildDossierContext(params.dossier, params.mode)}

## Historique récent
${historyText || "(début de conversation)"}

## Message de Rémi
${params.userText}

## Format de réponse OBLIGATOIRE
Réponds UNIQUEMENT avec un JSON valide (pas de markdown autour) :
{
  "reply": "texte affiché à Rémi (markdown léger OK, **gras** OK)",
  "stopAndAsk": boolean,
  "openQuestion": "question précise si stopAndAsk, sinon null",
  "economyOverrides": {
    "currentTotalEur": number|null,
    "proposedTotalEur": number|null,
    "remainingMonths": number|null,
    "feesAssureurEur": number|null
  },
  "kereisPatches": { "Libellé champ Kereis": "valeur" },
  "studyReady": boolean,
  "kereisReady": boolean
}
Règles JSON :
- N'inclus dans economyOverrides / kereisPatches QUE les valeurs que Rémi vient de confirmer ou que tu extrais avec certitude élevée des documents déjà résumés — jamais d'invention.
- Si ambiguïté : stopAndAsk=true, economyOverrides/kereisPatches vides ou partiels, openQuestion remplie.
- studyReady=true seulement si actuelle + proposée + durée ≥12 sont connus et cohérents.
- kereisReady=true seulement si les champs critiques Kereis (identité, CRD, durée, banque, quotité si duo) sont couverts.`;

  try {
    const response = await generateContentWithRetry({
      model: process.env.ADE_ASSIST_MODEL || process.env.ADE_STUDY_MODEL || "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { temperature: 0.2, maxOutputTokens: 2048 },
    });
    const text = String(response?.text || "").trim();
    const parsed = extractJsonObject(text);
    if (!parsed || typeof parsed.reply !== "string") {
      return {
        reply: text || "Je n'ai pas pu formuler une réponse structurée. Reformulez ou donnez le chiffre / champ manquant.",
        stopAndAsk: true,
      };
    }

    const economyOverrides: AdeStudyAssistOverrides = {};
    const eo = parsed.economyOverrides || {};
    for (const key of ["currentTotalEur", "proposedTotalEur", "remainingMonths", "feesAssureurEur"] as const) {
      const v = eo[key];
      if (v != null && Number.isFinite(Number(v))) {
        economyOverrides[key] = Number(v);
      }
    }

    const kereisPatches: Record<string, string | number | boolean> = {};
    if (parsed.kereisPatches && typeof parsed.kereisPatches === "object") {
      for (const [k, v] of Object.entries(parsed.kereisPatches)) {
        if (v == null || v === "") continue;
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          kereisPatches[String(k)] = v;
        } else {
          kereisPatches[String(k)] = String(v);
        }
      }
    }

    return {
      reply: parsed.reply,
      stopAndAsk: Boolean(parsed.stopAndAsk),
      openQuestion: parsed.openQuestion ? String(parsed.openQuestion) : null,
      economyOverrides: Object.keys(economyOverrides).length ? economyOverrides : undefined,
      kereisPatches: Object.keys(kereisPatches).length ? kereisPatches : undefined,
      studyReady: Boolean(parsed.studyReady),
      kereisReady: Boolean(parsed.kereisReady),
    };
  } catch (e: any) {
    return {
      reply: `Erreur assistant : ${e?.message || "échec Gemini"}. Vous pouvez quand même saisir les montants en clair.`,
      stopAndAsk: true,
    };
  }
}
