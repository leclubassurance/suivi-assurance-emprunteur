import { getDossierClientEmails } from "./gmailAttachments";
import { inferDocumentCategory } from "../shared/documentClassifier";

const INACTIVE_STATUSES = new Set(["CLOS", "REFUSE", "REFUSÉ"]);

export function isDossierActiveForClient(dossier: any): boolean {
  const st = String(dossier?.status || "").toUpperCase();
  return !INACTIVE_STATUSES.has(st);
}

function normalizeIdentityPart(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/** Clé client : même nom+prénom emprunteur principal (emails différents possibles). */
export function getClientIdentityKey(dossier: any): string | null {
  const a = dossier?.formData?.assures?.[0];
  const nom = normalizeIdentityPart(a?.nom);
  const prenom = normalizeIdentityPart(a?.prenom);
  if (!nom || nom.length < 2) return null;
  return `${prenom}|${nom}`;
}

export function extractLcifIdsFromText(text: string): string[] {
  const found: string[] = [];
  const re = /LCIF-\d{6}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text || ""))) !== null) {
    found.push(m[0].toUpperCase());
  }
  return [...new Set(found)];
}

/** Le message (sujet ou corps) cite explicitement ce dossier LCIF. */
export function emailClearlyTargetsDossier(params: {
  subject?: string;
  body?: string;
  dossierId: string;
}): boolean {
  const id = String(params.dossierId || "").toUpperCase();
  if (!id) return false;
  const combined = `${params.subject || ""}\n${params.body || ""}`;
  return extractLcifIdsFromText(combined).includes(id);
}

/** Dossiers actifs partageant au moins un email (ancien comportement). */
export function listActiveDossiersForSameClient(allDossiers: any[], dossier: any): any[] {
  const emails = new Set(getDossierClientEmails(dossier));
  if (emails.size === 0) {
    return isDossierActiveForClient(dossier) ? [dossier] : [];
  }
  return (allDossiers || []).filter((d) => {
    if (!isDossierActiveForClient(d)) return false;
    return getDossierClientEmails(d).some((e) => emails.has(e));
  });
}

/** Dossiers actifs du même client (emails différents OK si même identité emprunteur). */
export function listRelatedDossiersForClient(allDossiers: any[], dossier: any): any[] {
  const identityKey = getClientIdentityKey(dossier);
  if (identityKey) {
    const byIdentity = (allDossiers || []).filter((d) => {
      if (!isDossierActiveForClient(d)) return false;
      return getClientIdentityKey(d) === identityKey;
    });
    if (byIdentity.length > 0) return byIdentity;
  }
  return listActiveDossiersForSameClient(allDossiers, dossier);
}

function pickDossierForSenderEmail(related: any[], senderEmail: string): any | null {
  const sender = String(senderEmail || "").toLowerCase();
  const matches = related.filter((d) => getDossierClientEmails(d).includes(sender));
  if (matches.length === 0) return null;
  const primary = matches.find(
    (d) => String(d.formData?.assures?.[0]?.email || "").toLowerCase() === sender,
  );
  if (primary) return primary;
  return matches.sort(
    (a, b) =>
      new Date(b.updatedAt || b.createdAt || 0).getTime() -
      new Date(a.updatedAt || a.createdAt || 0).getTime(),
  )[0];
}

function recentCamilleOutboundOnDossier(dossier: any, withinMs: number): boolean {
  const cutoff = Date.now() - withinMs;
  for (const c of dossier.communications || []) {
    if (c.direction !== "outbound") continue;
    if (!/camille/i.test(String(c.from || ""))) continue;
    if (new Date(c.date || 0).getTime() >= cutoff) return true;
  }
  for (const e of dossier.eventLog || []) {
    if (e.type !== "AI_DECISION") continue;
    const msg = String(e.message || "");
    if (!/réponse automatique|accusé de réception/i.test(msg)) continue;
    if (new Date(e.at || 0).getTime() >= cutoff) return true;
  }
  return false;
}

export function getCrossDossierReplyCooldownMs(): number {
  const hours = Number(process.env.CAMILLE_CROSS_DOSSIER_COOLDOWN_HOURS || "6");
  return Math.max(1, hours) * 3600 * 1000;
}

/**
 * Évite que Camille réponde sur tous les contrats quand le client a plusieurs LCIF (emails distincts).
 * Une seule réponse auto par « famille » de dossiers sauf si le mail cite le LCIF concerné.
 */
export function shouldCamilleAutoReplyOnDossier(params: {
  dossier: any;
  senderEmail: string;
  subject: string;
  body: string;
  allDossiers: any[];
}): { allow: boolean; reason?: string } {
  const related = listRelatedDossiersForClient(params.allDossiers, params.dossier);
  if (related.length <= 1) return { allow: true };

  const dossierId = String(params.dossier.id || "");
  const sender = String(params.senderEmail || "").toLowerCase();
  const dossierEmails = getDossierClientEmails(params.dossier);

  if (
    emailClearlyTargetsDossier({
      subject: params.subject,
      body: params.body,
      dossierId,
    })
  ) {
    return { allow: true };
  }

  if (!dossierEmails.includes(sender)) {
    return { allow: false, reason: "sender_not_this_dossier_email" };
  }

  const owner = pickDossierForSenderEmail(related, sender);
  if (owner && String(owner.id) !== dossierId) {
    return { allow: false, reason: "other_contract_owns_this_email" };
  }

  const cooldown = getCrossDossierReplyCooldownMs();
  for (const sib of related) {
    if (String(sib.id) === dossierId) continue;
    if (!recentCamilleOutboundOnDossier(sib, cooldown)) continue;
    return { allow: false, reason: "sibling_recent_camille_reply" };
  }

  return { allow: true };
}

/** CNI / RIB déjà reçus sur un autre contrat du même client. */
export function getSharedIdentityDocsFromSiblings(
  allDossiers: any[],
  dossier: any,
): {
  cniFromSibling: boolean;
  ribFromSibling: boolean;
  siblingIds: string[];
  details: string[];
} {
  const related = listRelatedDossiersForClient(allDossiers, dossier);
  const currentId = String(dossier.id || "");
  let cniFromSibling = false;
  let ribFromSibling = false;
  const details: string[] = [];
  const siblingIds: string[] = [];

  for (const sib of related) {
    if (String(sib.id) === currentId) continue;
    const docs = (sib.formData?.documents || []) as any[];
    let hasCni = false;
    let hasRib = false;
    for (const doc of docs) {
      const cat = inferDocumentCategory(doc);
      if (cat === "cni") hasCni = true;
      if (cat === "rib") hasRib = true;
    }
    if (!hasCni && !hasRib) continue;
    siblingIds.push(String(sib.id));
    if (hasCni) {
      cniFromSibling = true;
      details.push(`CNI déjà sur ${sib.id}`);
    }
    if (hasRib) {
      ribFromSibling = true;
      details.push(`RIB déjà sur ${sib.id}`);
    }
  }

  return { cniFromSibling, ribFromSibling, siblingIds, details };
}

export type MultiDossierClientContext = {
  hasMultipleActive: boolean;
  activeCount: number;
  siblingIds: string[];
  ambiguousTargeting: boolean;
  promptBlock: string;
};

function formatDossierLine(d: any, currentId: string): string {
  const id = String(d.id);
  const mark = id === currentId ? " (dossier courant pour cet email)" : "";
  const email = String(d.formData?.assures?.[0]?.email || "").trim();
  const emailPart = email ? `, email ${email}` : "";
  const prets = d.formData?.prets || [];
  const p0 = prets[0] || {};
  const bank = p0.banquePreteuse ? `, banque ${p0.banquePreteuse}` : "";
  const crd = p0.capitalRestant ? `, CRD ~${p0.capitalRestant} €` : "";
  const created = d.createdAt ? new Date(d.createdAt).toLocaleDateString("fr-FR") : "";
  const datePart = created ? `, créé le ${created}` : "";
  return `- ${id}${mark}${emailPart}${datePart}${bank}${crd}`;
}

export function buildMultiDossierClientContext(params: {
  allDossiers: any[];
  dossier: any;
  emailSubject?: string;
  emailBody?: string;
}): MultiDossierClientContext {
  const dossier = params.dossier;
  const currentId = String(dossier?.id || "");
  const active = listRelatedDossiersForClient(params.allDossiers, dossier);
  const hasMultipleActive = active.length > 1;
  const siblingIds = active.map((d) => String(d.id));
  const clearlyTargeted = emailClearlyTargetsDossier({
    subject: params.emailSubject,
    body: params.emailBody,
    dossierId: currentId,
  });
  const ambiguousTargeting = hasMultipleActive && !clearlyTargeted;

  let promptBlock = "";
  if (hasMultipleActive) {
    const lines = [...active]
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map((d) => formatDossierLine(d, currentId));
    promptBlock = `
PLUSIEURS CONTRATS / DOSSIERS ACTIFS CHEZ NOUS (même client, emails ou prêts distincts)
Nombre de dossiers en cours : ${active.length}
${lines.join("\n")}

Consigne (uniquement dans ce cas) :
- Répondez UNIQUEMENT pour le dossier lié à l'adresse email de ce fil (${currentId} — email ${String(dossier.formData?.assures?.[0]?.email || "voir fiche")}).
- Ne traitez pas les autres contrats dans ce mail : le client doit répondre dans le fil du prêt concerné ou citer le numéro LCIF-XXXXXX.
- Si vous avez un doute sur le contrat concerné, demandez la référence LCIF ou le fil de confirmation du bon prêt — sans envoyer de consignes documentaires pour un autre contrat.
- Ne posez PAS cette question si le sujet ou le corps cite clairement ${currentId}.
- Pièces d'identité / RIB : si déjà reçus sur un autre contrat du même client, ne pas les redemander sur ${currentId} (offre + tableau restent spécifiques à chaque prêt).
${
  ambiguousTargeting
    ? `\nSignal : le message ne cite pas clairement ${currentId} — demander la précision LCIF avant toute demande de pièces.`
    : ""
}`;
  }

  return {
    hasMultipleActive,
    activeCount: active.length,
    siblingIds,
    ambiguousTargeting,
    promptBlock,
  };
}
