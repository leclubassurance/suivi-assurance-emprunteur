import { clientHasAcceptedInsuranceChange } from "./insuranceAcceptance";
import { hasStudyBeenSent } from "./dossierLifecycle";
import { resolveEffectiveSubscriptionPhase, SUBSCRIPTION_PHASE_OPTIONS } from "./subscriptionProgress";

function getDossierClientEmails(dossier: any): string[] {
  const emails = new Set<string>();
  for (const a of dossier.formData?.assures || []) {
    if (a?.email) emails.add(String(a.email).trim().toLowerCase());
  }
  const primary = dossier.formData?.assures?.[0]?.email;
  if (primary) emails.add(String(primary).trim().toLowerCase());
  return [...emails];
}

function extractLcifIdsFromText(text: string): string[] {
  const found: string[] = [];
  const re = /LCIF-\d{6}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text || ""))) !== null) {
    found.push(m[0].toUpperCase());
  }
  return [...new Set(found)];
}

export type InboundRoutingHints = {
  bodyText?: string;
  threadId?: string;
  inReplyTo?: string;
};

export function normalizeEmailSubject(subject: string): string {
  let s = String(subject || "");
  for (let i = 0; i < 4; i++) {
    const next = s.replace(/^(re|fw|fwd|tr|ré|réf)\s*:\s*/i, "").trim();
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeGmailId(raw: unknown): string {
  return String(raw || "")
    .replace(/^<|>$/g, "")
    .trim();
}

export function findDossierByGmailThreadId(db: { dossiers: any[] }, threadId: string): any | null {
  const tid = String(threadId || "").trim();
  if (!tid) return null;
  for (const d of db.dossiers || []) {
    for (const c of d.communications || []) {
      if (String(c.gmailThreadId || c.threadId || "") === tid) return d;
    }
  }
  return null;
}

export function findDossierByGmailMessageId(db: { dossiers: any[] }, gmailId: string): any | null {
  const gid = normalizeGmailId(gmailId);
  if (!gid) return null;
  for (const d of db.dossiers || []) {
    for (const c of d.communications || []) {
      if (normalizeGmailId(c.gmailId) === gid) return d;
    }
  }
  return null;
}

/** Rattache un mail entrant au dossier qui a déjà le même fil (sujet normalisé). */
export function findDossierBySubjectThreadHistory(
  db: { dossiers: any[] },
  senderEmail: string,
  subject: string,
): any | null {
  const norm = normalizeEmailSubject(subject);
  if (!norm || norm.length < 10) return null;
  const sender = String(senderEmail || "").toLowerCase();
  let best: any | null = null;
  let bestDate = 0;

  for (const d of db.dossiers || []) {
    if (!getDossierClientEmails(d).includes(sender)) continue;
    for (const c of d.communications || []) {
      const cs = normalizeEmailSubject(String(c.subject || ""));
      if (!cs || cs.length < 10) continue;
      const sameThread =
        cs === norm ||
        norm.includes(cs) ||
        cs.includes(norm) ||
        (norm.includes("dossier") && cs.includes("dossier") && norm.includes("lcif") && cs.includes("lcif"));
      if (!sameThread) continue;
      const t = new Date(c.date || 0).getTime();
      if (t > bestDate) {
        bestDate = t;
        best = d;
      }
    }
  }
  return best;
}

function dossierPhaseScore(dossier: any, bodyText: string): number {
  const body = String(bodyText || "").toLowerCase();
  const studySent = hasStudyBeenSent(dossier);
  const accepted = clientHasAcceptedInsuranceChange(dossier);
  let score = 0;

  if (/étude|etude|économ|econom|accord|souscri|adhésion|adhesion|cni|rib|identité|identite/.test(body)) {
    if (studySent) score += 35;
    if (accepted) score += 25;
  }
  if (/offre|tableau|amortissement|prêt|pret|banque|document|pièce|piece/.test(body)) {
    if (!studySent) score += 30;
    if (studySent && !accepted) score += 10;
  }

  const updated = new Date(dossier.updatedAt || dossier.createdAt || 0).getTime();
  score += Math.min(20, Math.max(0, (updated - Date.now() + 90 * 86400000) / (90 * 86400000)) * 20);

  for (const c of dossier.communications || []) {
    const from = String(c.from || "").toLowerCase();
    if (c.direction === "inbound" && from.includes(String(dossier.formData?.assures?.[0]?.email || "").toLowerCase())) {
      const age = Date.now() - new Date(c.date || 0).getTime();
      if (age < 45 * 86400000) score += 12;
    }
  }

  return score;
}

export function pickBestDossierAmongEmailMatches(
  matches: any[],
  params: {
    senderEmail: string;
    subject: string;
    bodyText?: string;
    messageDate?: string;
  },
): any | null {
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  const msgTs = params.messageDate ? new Date(params.messageDate).getTime() : NaN;
  let pool = matches;
  if (Number.isFinite(msgTs)) {
    const eligible = matches.filter((d) => {
      const createdTs = new Date(d.createdAt || 0).getTime();
      return createdTs <= msgTs + 6 * 3600 * 1000;
    });
    if (eligible.length > 0) pool = eligible;
  }

  return [...pool].sort((a, b) => {
    const scoreDiff = dossierPhaseScore(b, params.bodyText || "") - dossierPhaseScore(a, params.bodyText || "");
    if (scoreDiff !== 0) return scoreDiff;
    const da = Math.abs(
      (Number.isFinite(msgTs) ? msgTs : Date.now()) - new Date(a.updatedAt || a.createdAt || 0).getTime(),
    );
    const db = Math.abs(
      (Number.isFinite(msgTs) ? msgTs : Date.now()) - new Date(b.updatedAt || b.createdAt || 0).getTime(),
    );
    return da - db;
  })[0];
}

export function resolveInboundDossierForClientEmail(
  db: { dossiers: any[] },
  senderEmail: string,
  subject: string,
  messageDate?: string,
  hints?: InboundRoutingHints,
): any | null {
  const combined = `${subject}\n${hints?.bodyText || ""}`;
  const lcifIds = extractLcifIdsFromText(combined);
  if (lcifIds.length === 1) {
    const byId = db.dossiers.find((d) => String(d.id).toUpperCase() === lcifIds[0]);
    if (byId) return byId;
  }

  if (hints?.threadId) {
    const byThread = findDossierByGmailThreadId(db, hints.threadId);
    if (byThread) return byThread;
  }

  if (hints?.inReplyTo) {
    const byReply = findDossierByGmailMessageId(db, hints.inReplyTo);
    if (byReply) return byReply;
  }

  const bySubject = findDossierBySubjectThreadHistory(db, senderEmail, subject);
  if (bySubject) return bySubject;

  const sender = String(senderEmail || "").toLowerCase();
  const matches = (db.dossiers || []).filter((d) => getDossierClientEmails(d).includes(sender));
  return pickBestDossierAmongEmailMatches(matches, {
    senderEmail,
    subject,
    bodyText: hints?.bodyText,
    messageDate,
  });
}

export function formatDossierPhaseLabel(dossier: any): string {
  const studySent = hasStudyBeenSent(dossier);
  const accepted = clientHasAcceptedInsuranceChange(dossier);
  const phase = resolveEffectiveSubscriptionPhase(dossier);
  const email = String(dossier.formData?.assures?.[0]?.email || "").trim();
  const parts: string[] = [];
  if (!studySent) parts.push("en attente d'étude");
  else if (!accepted) parts.push("étude envoyée");
  else {
    const phaseLabel = phase
      ? SUBSCRIPTION_PHASE_OPTIONS.find((o) => o.value === phase)?.label || phase
      : "adhésion en cours";
    parts.push(String(phaseLabel));
  }
  if (email) parts.push(email);
  const p0 = dossier.formData?.prets?.[0];
  if (p0?.banquePreteuse) parts.push(String(p0.banquePreteuse));
  return parts.join(" — ");
}
