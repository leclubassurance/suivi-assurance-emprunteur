import { addEvent, type Dossier } from "./dossierModel";
import { getLastClientInbound } from "./dossierLifecycle";
import { isStaffMailbox, resumeCamilleForDossier } from "./camilleStaffHandoff";
import { executeCamilleStaffDirective } from "./camilleStaffDirective";
import { getEscalationState } from "./camilleEscalation";
import {
  acquireCamilleClientEmailLock,
  releaseCamilleClientEmailLock,
} from "./camilleClientEmailGuard";

const ESCALATION_SUBJECT_RE =
  /ALERTE\s+Camille|escalade\s+Camille|Rappel\s+—\s+dossier/i;

/** Extrait le texte saisi par l'équipe (hors citations du fil Gmail). */
export function extractStaffInstructionFromEmail(text: string): string {
  const t = String(text || "").replace(/\r\n/g, "\n");
  const cutPatterns = [
    /\nOn .+ wrote:\n/i,
    /\nLe .{5,120} a écrit\s*:\n/i,
    /\n-{2,}\s*Message d'origine/i,
    /\nDe\s*:\s*.+\nEnvoyé\s*:\s*/i,
    /\n_{5,}\n/,
    /\n>{1}\s/,
  ];
  let cut = t.length;
  for (const p of cutPatterns) {
    const m = t.search(p);
    if (m > 60 && m < cut) cut = m;
  }
  return t.slice(0, cut).trim();
}

export function isStaffEscalationInbound(
  subject: string,
  dossier: Dossier,
  params: { senderEmail: string; isSentByMe: boolean },
): boolean {
  if (params.isSentByMe) return false;
  if (!isStaffMailbox(params.senderEmail)) return false;

  if (ESCALATION_SUBJECT_RE.test(subject)) return true;

  const esc = getEscalationState(dossier);
  if (esc?.lastAt && !esc.resolvedAt) return true;

  return false;
}

export function resolveCamilleEscalation(
  dossier: Dossier,
  meta?: { source?: string; gmailId?: string },
) {
  const now = new Date().toISOString();
  if (dossier.camilleEscalation) {
    dossier.camilleEscalation = {
      ...dossier.camilleEscalation,
      resolvedAt: now,
      resolvedBy: meta?.source || "staff_email",
    };
  }

  for (const t of dossier.tasks || []) {
    if (
      t.status === "PENDING" &&
      t.type === "INTERNAL_ALERT" &&
      t.payload?.kind === "ESCALATION_FOLLOWUP"
    ) {
      t.status = "CANCELLED";
    }
  }

  addEvent(dossier, {
    type: "AI_DECISION",
    actor: { kind: "ADMIN", label: "Équipe" },
    message: "Escalade close — consigne email prise en compte par Camille.",
    meta: { gmailId: meta?.gmailId, source: meta?.source },
  });
}

export async function buildDossierKnowledgeForStaffDirective(dossier: Dossier): Promise<string> {
  const lines: string[] = [];

  const esc = getEscalationState(dossier);
  if (esc?.reason) lines.push(`Motif escalade Camille : ${esc.reason}`);

  const lastIn = getLastClientInbound(dossier);
  if (lastIn) {
    lines.push(
      `Dernier message client (${String(lastIn.date || "").slice(0, 16)}): ${String(lastIn.subject || "").slice(0, 80)}`,
    );
    lines.push(`Extrait : ${String(lastIn.text || "").replace(/\s+/g, " ").slice(0, 600)}`);
  }

  const kpi = dossier.studyKpi;
  if (kpi) {
    lines.push(
      `Étude déjà envoyée — économie brute ~${kpi.grossSavingsEur} €, capital ~${kpi.loanCapitalEur} €, courtage ~${kpi.feesCourtageEur} €.`,
    );
  }

  const extracted = dossier.studyDraft?.extracted;
  if (extracted && typeof extracted === "object") {
    lines.push(`Données étude (brouillon) : ${JSON.stringify(extracted).slice(0, 900)}`);
  }

  const docs = (dossier.formData?.documents || []) as any[];
  const devis =
    docs.find((d) => d?.category === "devis") ||
    docs.find((d) => /devis/i.test(String(d?.name || "")));

  if (devis) {
    lines.push(`Devis dans le dossier : ${devis.name || devis.id}`);
    const hint = devis.loanSignal?.clientHint || devis.loanSignal?.rawExcerpt;
    if (hint) lines.push(`Indice devis : ${String(hint).slice(0, 800)}`);

    try {
      const path = await import("path");
      const uploadsDir =
        process.env.RAILWAY_ENVIRONMENT || process.env.VERCEL
          ? path.join("/tmp", "data", "uploads")
          : path.join(process.cwd(), "data", "uploads");
      const { ensureDocumentLocalFile } = await import("./documentFileResolve");
      const resolved = await ensureDocumentLocalFile(dossier, devis, uploadsDir);
      const localPath = resolved.localPath;
      if (localPath) {
        const pdfParse = (await import("pdf-parse")).default;
        const fs = await import("fs");
        const buf = fs.readFileSync(localPath);
        const parsed = await pdfParse(buf);
        const pdfText = String(parsed?.text || "");
        const insurer =
          pdfText.match(
            /\b(Cardif|Generali|Axa|Allianz|Swiss\s*Life|CNP|iAssure|MetLife|MMA|Groupama|April|Abeille|Aviva|Maif|Macif)\b/i,
          )?.[1] || pdfText.match(/compagnie\s*[:\-]?\s*([A-Za-zÀ-ÿ0-9\s]{3,40})/i)?.[1];
        if (insurer) lines.push(`Assureur repéré dans le devis (PDF) : ${insurer.trim()}`);
        if (pdfText.length > 40) {
          lines.push(`Extrait devis (PDF, tronqué) :\n${pdfText.replace(/\s+/g, " ").slice(0, 1200)}`);
        }
      }
    } catch {
      /* devis sur Drive uniquement — contexte fichier suffit */
    }
  } else {
    lines.push("Aucun devis PDF indexé dans le dossier — utiliser uniquement ce que la consigne autorise.");
  }

  return lines.join("\n") || "—";
}

/**
 * Réponse de Rémi/équipe à un mail d'escalade → consigne Camille → mail client si pertinent.
 */
export async function handleStaffEscalationEmailReply(
  dossier: Dossier,
  rawEmailText: string,
  options: { gmailId: string; subject?: string; senderEmail?: string },
) {
  const instruction = extractStaffInstructionFromEmail(rawEmailText);
  if (!instruction || instruction.length < 4) {
    addEvent(dossier, {
      type: "AI_DECISION",
      actor: { kind: "ADMIN", label: "Équipe" },
      message: "Réponse escalade ignorée (texte vide après nettoyage).",
      meta: { gmailId: options.gmailId },
    });
    return { ok: false, action: "FAILED" as const, summary: "Consigne vide." };
  }

  resumeCamilleForDossier(dossier, "escalation_email");

  const dossierKnowledge = await buildDossierKnowledgeForStaffDirective(dossier);

  const result = await executeCamilleStaffDirective(dossier, instruction, {
    channel: "escalation_email",
    dossierKnowledge,
    staffAuthorizesInsurerName: true,
  });

  if (result.ok) {
    resolveCamilleEscalation(dossier, {
      source: "escalation_email",
      gmailId: options.gmailId,
    });
  }

  return result;
}

function matchDossierByLcif(db: { dossiers: any[] }, subject: string) {
  const lcif = subject.match(/LCIF-\d{6}/i)?.[0]?.toUpperCase();
  if (!lcif) return null;
  return db.dossiers.find((d) => String(d.id).toUpperCase() === lcif) || null;
}

/**
 * Scanne les fils d'escalade (ALERTE Camille…) — absents de la requête « emails client ».
 */
export async function syncStaffEscalationReplyEmails(
  gmail: { users: { messages: { list: (a: any) => Promise<any>; get: (a: any) => Promise<any> } } },
  db: { dossiers: any[] },
  processedIds: Set<string>,
  helpers: {
    getProcessedIds: (dossier: any) => Set<string>;
    markProcessed: (dossier: any, gmailId: string) => void;
    upsertCommunication: (dossier: any, msg: any) => void;
  },
): Promise<number> {
  const { decodeEmailBodies, extractEmail } = await import("./mailAutomation");
  const queries = [
    'subject:"ALERTE Camille" newer_than:120d',
    'subject:"Rappel — dossier" subject:LCIF newer_than:120d',
    'subject:"escalade Camille" newer_than:120d',
  ];

  let handled = 0;
  const seen = new Set<string>();

  for (const q of queries) {
    const listRes = await gmail.users.messages.list({ userId: "me", q, maxResults: 30 });
    for (const msgMeta of listRes.data.messages || []) {
      if (!msgMeta.id || processedIds.has(msgMeta.id) || seen.has(msgMeta.id)) continue;
      seen.add(msgMeta.id);

      const msgRes = await gmail.users.messages.get({
        userId: "me",
        id: msgMeta.id,
        format: "full",
      });
      const payload = msgRes.data.payload;
      if (!payload?.headers) continue;

      const subject =
        payload.headers.find((h: any) => h.name?.toLowerCase() === "subject")?.value || "";
      const fromRaw =
        payload.headers.find((h: any) => h.name?.toLowerCase() === "from")?.value || "";
      const senderEmail = extractEmail(fromRaw);
      const labelIds = msgRes.data.labelIds || [];
      const isSentByMe = labelIds.includes("SENT");
      const msgDate = new Date(Number(msgRes.data.internalDate || Date.now())).toISOString();

      const dossier = matchDossierByLcif(db, subject);
      if (!dossier) continue;

      if (!isStaffEscalationInbound(subject, dossier, { senderEmail, isSentByMe })) continue;

      const processed = helpers.getProcessedIds(dossier);
      if (processed.has(msgMeta.id)) {
        processedIds.add(msgMeta.id);
        continue;
      }

      const { text } = decodeEmailBodies(payload);
      helpers.upsertCommunication(dossier, {
        id: `msg_${msgMeta.id}`,
        gmailId: msgMeta.id,
        direction: "inbound",
        from: senderEmail,
        subject,
        text,
        date: msgDate,
      });

      if (!(await acquireCamilleClientEmailLock(dossier.id))) continue;

      try {
        console.log(
          `[Camille] Consigne escalade email — ${dossier.id} (${senderEmail}): ${subject.slice(0, 60)}`,
        );
        const result = await handleStaffEscalationEmailReply(dossier, text, {
          gmailId: msgMeta.id,
          subject,
          senderEmail,
        });
        helpers.markProcessed(dossier, msgMeta.id);
        processedIds.add(msgMeta.id);
        if (result.ok) handled += 1;
      } catch (err: any) {
        console.error(`[Camille] Escalade email ${dossier.id}:`, err?.message || err);
      } finally {
        await releaseCamilleClientEmailLock(dossier.id);
      }
    }
  }

  return handled;
}
