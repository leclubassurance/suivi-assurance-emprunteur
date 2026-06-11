import type { Dossier } from "./dossierModel";

function sortedComms(dossier: Dossier | any) {
  return [...(dossier.communications || [])].sort(
    (a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime(),
  );
}

/** Dernier message entrant client sans réponse outbound plus récente. */
export function hasUnansweredClientInbound(
  dossier: Dossier | any,
  gmailId?: string,
): boolean {
  const comms = sortedComms(dossier);
  const processed = new Set<string>(
    (dossier.processedGmailIds || []).map((id: string) => String(id)),
  );

  if (gmailId) {
    const gid = String(gmailId);
    // Source de vérité : un mail entrant traité (répondu ou escaladé) est dans processedGmailIds.
    // Évite le faux « déjà répondu » quand une réponse à un message précédent a un horodatage
    // postérieur à un mail client plus récent (fil rapide type SCI LCAP).
    if (!processed.has(gid)) return true;
    return false;
  }

  const lastInbound = [...comms].reverse().find((c) => c.direction === "inbound");
  if (!lastInbound) return false;
  if (lastInbound.gmailId && processed.has(String(lastInbound.gmailId))) return false;

  const t = new Date(lastInbound.date || 0).getTime();
  return !comms.some(
    (c) =>
      c.direction === "outbound" &&
      new Date(c.date || 0).getTime() > t &&
      !String(c.from || "").toLowerCase().includes("système"),
  );
}

const DEFAULT_TAIL_LIMIT = 15;
const DEFAULT_TAIL_CHARS = 800;
const SUMMARY_THRESHOLD = 12;
/** Marge autour de leadPromotedAt pour rattacher mails formulaire / confirmation. */
const PROMOTION_TIME_SLACK_MS = 120_000;

export type ConversationTailOptions = {
  /** Dossier client : n'envoyer à l'IA que les échanges post-formulaire (évite confusion prospect). */
  clientPhaseOnly?: boolean;
};

function formatCommLines(
  comms: any[],
  maxCharsPerMessage: number,
): string {
  return comms
    .map((c) => {
      const who = c.direction === "inbound" ? "Client" : "Équipe/Camille";
      const subj = c.subject ? ` — ${String(c.subject).slice(0, 100)}` : "";
      const body = String(c.text || "").replace(/\s+/g, " ").slice(0, maxCharsPerMessage);
      return `[${c.date?.slice(0, 16) || "?"}] ${who}${subj}\n${body}`;
    })
    .join("\n\n");
}

function buildTailFromComms(
  all: any[],
  limit: number,
  maxCharsPerMessage: number,
): string {
  const slice = all.slice(-limit);
  if (!slice.length) return "Aucun échange enregistré.";

  const tail = formatCommLines(slice, maxCharsPerMessage);

  if (all.length <= SUMMARY_THRESHOLD) return tail;

  const older = all.slice(0, Math.max(0, all.length - limit));
  const inboundCount = older.filter((c) => c.direction === "inbound").length;
  const outboundCount = older.filter((c) => c.direction === "outbound").length;
  const firstDate = older[0]?.date?.slice(0, 10) || "?";
  const lastOlderDate = older[older.length - 1]?.date?.slice(0, 10) || "?";

  const summary = [
    `Résumé fil antérieur (${older.length} messages, ${firstDate} → ${lastOlderDate}) :`,
    `${inboundCount} message(s) client, ${outboundCount} réponse(s) équipe avant la fenêtre détaillée ci-dessous.`,
    "Tenir compte de cet historique — ne pas redemander ce qui a déjà été traité.",
  ].join("\n");

  return `${summary}\n\n--- Messages récents ---\n\n${tail}`;
}

function buildClientPhasePrefix(dossier: Dossier | any, prospectCount: number): string {
  const promotedOn = String(dossier.leadPromotedAt || "").slice(0, 10) || "?";
  return [
    `[Contexte conversion prospect → dossier]`,
    `${prospectCount} échange(s) en phase prospect avant le ${promotedOn} (formulaire pas encore déposé).`,
    "Le client a depuis complété le formulaire — répondre en mode dossier client :",
    "- ne plus envoyer le lien formulaire ni le ton pré-étude ;",
    "- s'appuyer sur les documents déposés et la phase souscription (checklist / étude).",
    "Le fil détaillé ci-dessous = échanges APRÈS dépôt du formulaire uniquement.",
    "",
  ].join("\n");
}

export function getConversationTailForAi(
  dossier: Dossier | any,
  limit = DEFAULT_TAIL_LIMIT,
  maxCharsPerMessage = DEFAULT_TAIL_CHARS,
  options?: ConversationTailOptions,
): string {
  const all = sortedComms(dossier);
  const promotedAt = dossier.leadPromotedAt
    ? new Date(dossier.leadPromotedAt).getTime()
    : null;

  if (options?.clientPhaseOnly && promotedAt) {
    const prospectPhase = all.filter(
      (c) => new Date(c.date || 0).getTime() < promotedAt - PROMOTION_TIME_SLACK_MS,
    );
    const clientPhase = all.filter(
      (c) => new Date(c.date || 0).getTime() >= promotedAt - PROMOTION_TIME_SLACK_MS,
    );

    if (clientPhase.length > 0) {
      const prefix =
        prospectPhase.length > 0 ? buildClientPhasePrefix(dossier, prospectPhase.length) : "";
      return prefix + buildTailFromComms(clientPhase, limit, maxCharsPerMessage);
    }

    if (prospectPhase.length > 0) {
      return (
        buildClientPhasePrefix(dossier, prospectPhase.length) +
        "Aucun échange post-dépôt enregistré pour l'instant — le dernier mail client peut concerner le formulaire lui-même."
      );
    }
  }

  return buildTailFromComms(all, limit, maxCharsPerMessage);
}
