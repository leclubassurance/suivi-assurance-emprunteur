import { getDossierClientEmails } from "./gmailAttachments";

const INACTIVE_STATUSES = new Set(["CLOS", "REFUSE", "REFUSÉ"]);

export function isDossierActiveForClient(dossier: any): boolean {
  const st = String(dossier?.status || "").toUpperCase();
  return !INACTIVE_STATUSES.has(st);
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
  const prets = d.formData?.prets || [];
  const p0 = prets[0] || {};
  const bank = p0.banquePreteuse ? `, banque ${p0.banquePreteuse}` : "";
  const crd = p0.capitalRestant ? `, CRD ~${p0.capitalRestant} €` : "";
  const created = d.createdAt ? new Date(d.createdAt).toLocaleDateString("fr-FR") : "";
  const datePart = created ? `, créé le ${created}` : "";
  return `- ${id}${mark}${datePart}${bank}${crd}`;
}

export function buildMultiDossierClientContext(params: {
  allDossiers: any[];
  dossier: any;
  emailSubject?: string;
  emailBody?: string;
}): MultiDossierClientContext {
  const dossier = params.dossier;
  const currentId = String(dossier?.id || "");
  const active = listActiveDossiersForSameClient(params.allDossiers, dossier);
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
PLUSIEURS DOSSIERS ACTIFS CHEZ NOUS (même client)
Nombre de dossiers en cours : ${active.length}
${lines.join("\n")}

Consigne (uniquement dans ce cas) :
- Si vous avez un doute sur le dossier concerné par ce message (courant : ${currentId}), demandez au client de repréciser la référence dossier (numéro LCIF-XXXXXX indiqué sur son mail de confirmation) ou de répondre dans le fil de confirmation du prêt concerné.
- Ne posez PAS cette question si le sujet ou le corps du message cite clairement ${currentId}.
- Si le message cite un autre numéro LCIF que ${currentId}, invitez le client à utiliser le fil du dossier concerné plutôt que de traiter la demande sur ${currentId}.
${
  ambiguousTargeting
    ? `\nSignal : le message ne cite pas clairement ${currentId} — en cas de doute, privilégier la demande de précision avant toute consigne documentaire détaillée.`
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
