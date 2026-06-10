import { addEvent, ensureDossierShape, type Dossier } from "./dossierModel";
import { getDossierClientEmails } from "./gmailAttachments";
import { isDossierActiveForClient } from "./clientMultipleDossiers";
import type { PrivacyConsentRecord } from "./privacyConsent";

export function normalizeClientEmail(email: unknown): string | null {
  const e = String(email || "").trim().toLowerCase();
  return e.includes("@") ? e : null;
}

export function isLeadDossier(dossier: any): boolean {
  if (Boolean(dossier?.isLead)) return true;
  if (String(dossier?.status || "").toUpperCase() === "PROSPECT") return true;
  const src = String(dossier?.leadSource || "");
  return src === "gmail_inbound" || src === "public_help";
}

export function findLeadDossiersByEmail(db: { dossiers: any[] }, email: string): any[] {
  const e = normalizeClientEmail(email);
  if (!e) return [];
  return (db.dossiers || []).filter(
    (d) => isLeadDossier(d) && getDossierClientEmails(d).includes(e),
  );
}

export function findActiveFullDossiersByEmail(db: { dossiers: any[] }, email: string): any[] {
  const e = normalizeClientEmail(email);
  if (!e) return [];
  return (db.dossiers || []).filter(
    (d) =>
      !isLeadDossier(d) &&
      isDossierActiveForClient(d) &&
      getDossierClientEmails(d).includes(e),
  );
}

function mergeUniqueStrings(...lists: (string[] | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const v of list || []) {
      const s = String(v || "").trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

function mergeByDate<T extends { date?: string; at?: string }>(a: T[] = [], b: T[] = []): T[] {
  return [...a, ...b].sort((x, y) => {
    const tx = new Date(x.date || x.at || 0).getTime();
    const ty = new Date(y.date || y.at || 0).getTime();
    return tx - ty;
  });
}

/** Fusionne historique prospect → dossier cible (communications, events, registres Gmail…). */
export function mergeLeadHistoryIntoDossier(target: any, lead: any) {
  target.communications = mergeByDate(target.communications || [], lead.communications || []).slice(-40);
  target.eventLog = mergeByDate(target.eventLog || [], lead.eventLog || []).slice(-80);
  target.processedGmailIds = mergeUniqueStrings(target.processedGmailIds, lead.processedGmailIds).slice(-250);
  target.acknowledgedStaffOutboundGmailIds = mergeUniqueStrings(
    target.acknowledgedStaffOutboundGmailIds,
    lead.acknowledgedStaffOutboundGmailIds,
  ).slice(-250);
  target.aiAuditTrail = [...(target.aiAuditTrail || []), ...(lead.aiAuditTrail || [])].slice(-25);
  target.notes = [...(target.notes || []), ...(lead.notes || [])];
  target.emails = [...(target.emails || []), ...(lead.emails || [])];

  if (!target.studyKpi && lead.studyKpi) target.studyKpi = lead.studyKpi;
  if (!target.studyDraft && lead.studyDraft) target.studyDraft = lead.studyDraft;
  if (!target.subscriptionProgress && lead.subscriptionProgress) {
    target.subscriptionProgress = lead.subscriptionProgress;
  }

  addEvent(target, {
    type: "NOTE_ADDED",
    actor: { kind: "SYSTEM" },
    message: `Historique prospect ${lead.id} fusionné dans ce dossier (même adresse email).`,
    meta: { template: "LEAD_MERGED", fromLeadId: lead.id, leadSource: lead.leadSource },
  });
}

export type LeadReconciliationPlan =
  | { action: "create_new" }
  | { action: "adopt_lead"; lead: any }
  | { action: "merge_leads_into_existing"; target: any; leads: any[]; removeLeadIds: string[] };

/** Décide comment rattacher un formulaire à un prospect existant (même email). */
export function reconcileLeadOnFormSubmit(
  db: { dossiers: any[] },
  clientEmail: string,
): LeadReconciliationPlan {
  const email = normalizeClientEmail(clientEmail);
  if (!email) return { action: "create_new" };

  const leads = findLeadDossiersByEmail(db, email).sort(
    (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
  );
  const full = findActiveFullDossiersByEmail(db, email).sort(
    (a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() -
      new Date(a.updatedAt || a.createdAt || 0).getTime(),
  );

  if (full.length > 0 && leads.length > 0) {
    const target = full[0];
    return {
      action: "merge_leads_into_existing",
      target,
      leads,
      removeLeadIds: leads.map((l) => l.id),
    };
  }

  if (leads.length > 0) {
    return { action: "adopt_lead", lead: leads[0] };
  }

  return { action: "create_new" };
}

export function adoptLeadForFormSubmission(
  lead: any,
  params: {
    formData: any;
    privacyConsent: PrivacyConsentRecord;
  },
): Dossier {
  const now = new Date().toISOString();
  const previousLeadId = lead.id;
  const { isLead: _dropLead, ...leadRest } = lead;
  const promoted = ensureDossierShape({
    ...leadRest,
    id: lead.id,
    status: lead.status === "CLOS" ? "NOUVEAU" : lead.status || "NOUVEAU",
    updatedAt: now,
    formData: params.formData,
    privacyConsent: params.privacyConsent,
    leadPromotedAt: now,
    leadSource: lead.leadSource || "gmail_inbound",
  });

  addEvent(promoted, {
    type: "NOTE_ADDED",
    actor: { kind: "SYSTEM" },
    message: `Prospect ${previousLeadId} converti en dossier client via le formulaire (même adresse email).`,
    meta: {
      template: "LEAD_PROMOTED",
      previousLeadId,
      leadSource: lead.leadSource,
    },
  });

  return promoted;
}

export function applyFormToExistingDossier(
  target: any,
  params: {
    formData: any;
    privacyConsent: PrivacyConsentRecord;
    leadsToMerge: any[];
  },
): Dossier {
  const now = new Date().toISOString();
  for (const lead of params.leadsToMerge) {
    mergeLeadHistoryIntoDossier(target, lead);
  }

  const merged = ensureDossierShape({
    ...target,
    updatedAt: now,
    formData: params.formData,
    privacyConsent: params.privacyConsent,
  });

  addEvent(merged, {
    type: "NOTE_ADDED",
    actor: { kind: "SYSTEM" },
    message: "Formulaire client enregistré — prospect(s) rattaché(s) par adresse email.",
    meta: {
      template: "FORM_LINKED_TO_EXISTING",
      mergedLeadIds: params.leadsToMerge.map((l) => l.id),
    },
  });

  return merged;
}
