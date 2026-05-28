import { addEvent, type Dossier } from "./dossierModel";

export type AiAuditOutcome = "sent" | "skipped" | "failed" | "no_email" | "notified" | "info";

export type AiAuditEntry = {
  id: string;
  at: string;
  action: string;
  channel: string;
  actor: string;
  outcome: AiAuditOutcome;
  model?: string;
  summary?: string;
  instructionPreview?: string;
  meta?: Record<string, unknown>;
};

const AUDIT_META = "aiAudit";

export function logAiAudit(
  dossier: Dossier,
  entry: Omit<AiAuditEntry, "id" | "at"> & { id?: string; at?: string },
) {
  const at = entry.at || new Date().toISOString();
  const id = entry.id || `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const row: AiAuditEntry = {
    id,
    at,
    action: entry.action,
    channel: entry.channel,
    actor: entry.actor || "Camille",
    outcome: entry.outcome,
    model: entry.model,
    summary: entry.summary,
    instructionPreview: entry.instructionPreview,
    meta: entry.meta,
  };

  addEvent(dossier, {
    type: "AI_DECISION",
    actor: { kind: "AI", label: row.actor },
    message: row.summary || row.action,
    meta: { [AUDIT_META]: row },
  });

  if (!dossier.aiAuditTrail) dossier.aiAuditTrail = [];
  dossier.aiAuditTrail.push(row);
  if (dossier.aiAuditTrail.length > 80) {
    dossier.aiAuditTrail = dossier.aiAuditTrail.slice(-80);
  }
}

export function getAiAuditTrail(dossier: Dossier): AiAuditEntry[] {
  const fromField = Array.isArray((dossier as any).aiAuditTrail)
    ? ((dossier as any).aiAuditTrail as AiAuditEntry[])
    : [];
  const fromEvents = (dossier.eventLog || [])
    .map((e) => e.meta?.[AUDIT_META] as AiAuditEntry | undefined)
    .filter(Boolean) as AiAuditEntry[];
  const merged = [...fromEvents, ...fromField];
  const byId = new Map<string, AiAuditEntry>();
  for (const row of merged) {
    if (row?.id) byId.set(row.id, row);
  }
  return [...byId.values()].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
