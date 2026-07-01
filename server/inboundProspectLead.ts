import { addEvent, ensureDossierShape } from "./dossierModel";
import {
  classifyInboundEmail,
  extractEmailAddress,
  getAssuranceMailbox,
} from "./inboundEmailClassifier";
import {
  findLeadDossiersByEmail,
  findNonLeadDossierByCorrespondenceEmail,
  normalizeClientEmail,
} from "./leadDossierMerge";

function extractPrenomFromFromRaw(fromRaw: string): string {
  const raw = String(fromRaw || "").trim();
  const display = raw.match(/^([^<]+)</)?.[1]?.trim().replace(/^["']|["']$/g, "") || "";
  const token = (display || raw.split("@")[0] || "").trim();
  const first = token.split(/\s+/).filter(Boolean)[0] || "";
  return first.slice(0, 40);
}

export function findOrCreateGmailInboundLead(
  db: { dossiers: any[] },
  senderEmail: string,
  fromRaw: string,
): { lead: any; created: boolean } {
  const email = normalizeClientEmail(senderEmail);
  if (!email) throw new Error("email_invalide");

  const existing = findLeadDossiersByEmail(db, email).sort(
    (a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() -
      new Date(a.updatedAt || a.createdAt || 0).getTime(),
  );
  if (existing[0]) return { lead: existing[0], created: false };

  const now = new Date().toISOString();
  const prenom = extractPrenomFromFromRaw(fromRaw);
  const lead = ensureDossierShape({
    id: `LCIF-${Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, "0")}`,
    status: "PROSPECT",
    createdAt: now,
    updatedAt: now,
    formData: {
      assures: [{ prenom, nom: "", email }],
      documents: [],
    },
    communications: [],
    tasks: [],
    emails: [],
    notes: [],
    eventLog: [],
    isLead: true,
    leadSource: "gmail_inbound",
  });

  addEvent(lead, {
    type: "DOSSIER_CREATED",
    actor: { kind: "SYSTEM" },
    message: "Prospect créé depuis un email entrant (pas encore de dossier client).",
    meta: { leadSource: "gmail_inbound", clientEmail: email },
  });

  db.dossiers.push(lead);
  return { lead, created: true };
}

type GmailLike = {
  users: {
    messages: {
      list: (args: any) => Promise<{ data: { messages?: { id?: string | null }[] } }>;
      get: (args: any) => Promise<{ data: any }>;
    };
  };
};

/** Emails vers assurance@ sans dossier client → fiche prospect (pas de réponse Camille). */
export async function syncInboundProspectLeads(
  gmail: GmailLike,
  db: { dossiers: any[] },
  ctx: {
    processedIds: Set<string>;
    decodeEmailBodies: (payload: any) => { text: string; html: string };
    upsertCommunication: (dossier: any, msg: any) => boolean;
    markDossierDirty: (dossier: any) => void;
    getProcessedIds: (dossier: any) => Set<string>;
    markProcessed: (dossier: any, gmailId: string) => boolean;
  },
): Promise<{ handled: number; created: number }> {
  const mailbox = getAssuranceMailbox();
  const q = `(to:${mailbox} OR deliverto:${mailbox}) newer_than:90d -in:spam -in:trash`;
  const listRes = await gmail.users.messages.list({ userId: "me", q, maxResults: 40 });
  const messages = listRes.data.messages || [];

  let handled = 0;
  let created = 0;

  for (const msgMeta of messages) {
    if (!msgMeta.id || ctx.processedIds.has(msgMeta.id)) continue;

    const msgRes = await gmail.users.messages.get({ userId: "me", id: msgMeta.id, format: "full" });
    const payload = msgRes.data.payload;
    const headers = payload?.headers || [];
    const labelIds = msgRes.data.labelIds || [];
    if (labelIds.includes("SENT")) continue;

    const subject = headers.find((h: any) => h.name?.toLowerCase() === "subject")?.value || "";
    const fromRaw = headers.find((h: any) => h.name?.toLowerCase() === "from")?.value || "";
    const toRaw = headers.find((h: any) => h.name?.toLowerCase() === "to")?.value || "";
    const deliveredToRaw =
      headers.find((h: any) => h.name?.toLowerCase() === "delivered-to")?.value || "";

    const senderEmail = extractEmailAddress(fromRaw);
    if (!senderEmail) continue;

    if (findNonLeadDossierByCorrespondenceEmail(db, senderEmail)) {
      ctx.processedIds.add(msgMeta.id);
      continue;
    }

    const inboundClass = classifyInboundEmail(
      { fromRaw, toRaw, deliveredToRaw, subject },
      { requireAssuranceMailbox: true },
    );
    if (inboundClass.ignore) continue;

    const { text, html } = ctx.decodeEmailBodies(payload);
    const msgDate = new Date(Number(msgRes.data.internalDate || Date.now())).toISOString();

    const { lead, created: isNew } = findOrCreateGmailInboundLead(db, senderEmail, fromRaw);
    if (isNew) created += 1;

    const alreadyHandled = ctx.getProcessedIds(lead).has(msgMeta.id);
    const changed = ctx.upsertCommunication(lead, {
      id: `msg_${msgMeta.id}`,
      gmailId: msgMeta.id,
      direction: "inbound",
      from: senderEmail,
      subject,
      text,
      html: html || undefined,
      date: msgDate,
    });

    if (!alreadyHandled) {
      ctx.markProcessed(lead, msgMeta.id);
      const {
        wasTelegramNotifiedRecently,
        markTelegramNotified,
        telegramNotifyKey,
      } = await import("./telegramNotifyDedup");
      const tgKey = telegramNotifyKey(lead.id, "client_message", msgMeta.id);
      if (!wasTelegramNotifiedRecently(lead, tgKey, 24 * 60 * 60 * 1000)) {
        markTelegramNotified(lead, tgKey);
        void import("./telegramNotify")
          .then(({ notifyTelegramClientInbound }) =>
            notifyTelegramClientInbound({
              dossier: lead,
              clientEmail: senderEmail,
              subject,
              excerpt: String(text || "").slice(0, 500),
              gmailId: msgMeta.id,
            }),
          )
          .catch(() => undefined);
      }
      if (isNew) {
        addEvent(lead, {
          type: "NOTE_ADDED",
          actor: { kind: "SYSTEM" },
          message: `Premier contact email : « ${subject.slice(0, 80)} »`,
          meta: { gmailId: msgMeta.id, leadSource: "gmail_inbound" },
        });
      }
    }

    if (changed || !alreadyHandled) {
      ctx.markDossierDirty(lead);
      handled += 1;
    }

    ctx.processedIds.add(msgMeta.id);
  }

  if (handled > 0) {
    console.log(`[Gmail sync] ${handled} mail(s) prospect traité(s) (${created} nouveau(x))`);
  }

  return { handled, created };
}
