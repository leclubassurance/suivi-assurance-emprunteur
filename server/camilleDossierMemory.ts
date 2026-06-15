import type { Dossier } from "./dossierModel";
import { buildCamilleContextBlock } from "./camilleMail";
import { getConversationTailForAi } from "./gmailConversation";
import { generateContentWithRetry } from "./geminiClient";
import { hasStudyBeenSent } from "./dossierLifecycle";
import { clientHasAcceptedInsuranceChange } from "./insuranceAcceptance";

export type CamilleDossierMemory = {
  summary: string;
  phase: string;
  openTopics: string[];
  lastClientTone?: string;
  lastOutboundAt?: string;
  updatedAt: string;
};

export function getCamilleMemoryBlock(dossier: Dossier | any): string {
  const mem = dossier.camilleMemory as CamilleDossierMemory | undefined;
  if (!mem?.summary) return "Mémoire dossier : non encore générée.";
  const topics =
    mem.openTopics?.length > 0 ? mem.openTopics.map((t) => `• ${t}`).join("\n") : "• aucun sujet ouvert";
  return [
    `Mémoire dossier (mise à jour ${mem.updatedAt?.slice(0, 16) || "?"}) :`,
    mem.summary,
    `Phase mémorisée : ${mem.phase || "—"}`,
    `Sujets ouverts :`,
    topics,
    mem.lastClientTone ? `Ton dernier échange client : ${mem.lastClientTone}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Met à jour la mémoire narrative du dossier après un échange (envoi client ou validation).
 * Source de vérité pour la cohérence des prochaines réponses Camille.
 */
export async function refreshCamilleDossierMemory(
  dossier: Dossier,
  trigger?: { kind: "outbound" | "staff_validated" | "client_inbound"; excerpt?: string },
): Promise<CamilleDossierMemory | null> {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes("MY_GEMINI")) {
    return null;
  }

  const ctx = buildCamilleContextBlock(dossier);
  const tail = getConversationTailForAi(dossier, 12, 500);
  const a = dossier.formData?.assures?.[0];
  const name = [a?.prenom, a?.nom].filter(Boolean).join(" ") || dossier.id;

  const response = await generateContentWithRetry({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Tu maintiens la mémoire narrative d'un dossier assurance emprunteur pour Camille (assistante email).
Résume en 4 à 8 lignes ce qu'il faut ABSOLUMENT retenir pour les prochains mails : phase, documents, décisions client, promesses déjà faites, sujets en suspens.
Ne invente rien. JSON uniquement :
{
  "summary": "string",
  "openTopics": ["string"],
  "lastClientTone": "neutre|pressé|inquiet|satisfait|mécontent|—"
}`,
          },
        ],
      },
      {
        role: "user",
        parts: [
          {
            text: `Dossier ${dossier.id} — ${name}
Phase : ${ctx.subscriptionPhaseLabel || "—"}
Étude envoyée : ${hasStudyBeenSent(dossier) ? "oui" : "non"}
Accord client : ${clientHasAcceptedInsuranceChange(dossier) ? "oui" : "non"}
Déclencheur : ${trigger?.kind || "routine"} ${trigger?.excerpt ? `— ${trigger.excerpt.slice(0, 200)}` : ""}

Fil récent :
${tail}`,
          },
        ],
      },
    ],
    config: { responseMimeType: "application/json", temperature: 0.2 },
  });

  let parsed: { summary?: string; openTopics?: string[]; lastClientTone?: string } = {};
  try {
    parsed = JSON.parse(response.text || "{}");
  } catch {
    return null;
  }

  const summary = String(parsed.summary || "").trim();
  if (summary.length < 20) return null;

  const memory: CamilleDossierMemory = {
    summary: summary.slice(0, 1200),
    phase: ctx.subscriptionPhaseLabel || ctx.subscriptionPhase || "—",
    openTopics: Array.isArray(parsed.openTopics)
      ? parsed.openTopics.map((t) => String(t).slice(0, 120)).slice(0, 6)
      : [],
    lastClientTone: parsed.lastClientTone ? String(parsed.lastClientTone).slice(0, 40) : undefined,
    lastOutboundAt:
      trigger?.kind === "outbound" || trigger?.kind === "staff_validated"
        ? new Date().toISOString()
        : (dossier.camilleMemory as CamilleDossierMemory | undefined)?.lastOutboundAt,
    updatedAt: new Date().toISOString(),
  };

  dossier.camilleMemory = memory;
  return memory;
}
