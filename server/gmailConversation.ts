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

export function getConversationTailForAi(dossier: Dossier | any, limit = 6): string {
  const slice = sortedComms(dossier).slice(-limit);
  if (!slice.length) return "Aucun échange enregistré.";
  return slice
    .map((c) => {
      const who = c.direction === "inbound" ? "Client" : "Équipe/Camille";
      const subj = c.subject ? ` — ${String(c.subject).slice(0, 80)}` : "";
      const body = String(c.text || "").replace(/\s+/g, " ").slice(0, 400);
      return `[${c.date?.slice(0, 16) || "?"}] ${who}${subj}\n${body}`;
    })
    .join("\n\n");
}
