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
  if (gmailId) {
    const target = comms.find((c) => c.gmailId === gmailId && c.direction === "inbound");
    if (!target) return false;
    const t = new Date(target.date || 0).getTime();
    const answered = comms.some(
      (c) =>
        c.direction === "outbound" &&
        new Date(c.date || 0).getTime() > t &&
        !String(c.from || "").toLowerCase().includes("système"),
    );
    return !answered;
  }

  const lastInbound = [...comms].reverse().find((c) => c.direction === "inbound");
  if (!lastInbound) return false;
  const t = new Date(lastInbound.date || 0).getTime();
  return !comms.some(
    (c) => c.direction === "outbound" && new Date(c.date || 0).getTime() > t,
  );
}

const DEFAULT_TAIL_LIMIT = 15;
const DEFAULT_TAIL_CHARS = 800;
const SUMMARY_THRESHOLD = 12;

export function getConversationTailForAi(
  dossier: Dossier | any,
  limit = DEFAULT_TAIL_LIMIT,
  maxCharsPerMessage = DEFAULT_TAIL_CHARS,
): string {
  const all = sortedComms(dossier);
  const slice = all.slice(-limit);
  if (!slice.length) return "Aucun échange enregistré.";

  const tail = slice
    .map((c) => {
      const who = c.direction === "inbound" ? "Client" : "Équipe/Camille";
      const subj = c.subject ? ` — ${String(c.subject).slice(0, 100)}` : "";
      const body = String(c.text || "").replace(/\s+/g, " ").slice(0, maxCharsPerMessage);
      return `[${c.date?.slice(0, 16) || "?"}] ${who}${subj}\n${body}`;
    })
    .join("\n\n");

  if (all.length <= SUMMARY_THRESHOLD) return tail;

  const older = all.slice(0, -limit);
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
