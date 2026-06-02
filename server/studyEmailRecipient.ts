/** Vérifie cohérence objet / destinataire avant envoi d'une étude. */

export function extractFirstNameFromStudySubject(subject: string): string | null {
  const m = String(subject || "").match(/^([^,]+),/);
  const name = m?.[1]?.trim();
  return name && name.length >= 2 ? name : null;
}

export function validateStudyEmailRecipient(dossier: any, subject: string): {
  ok: boolean;
  error?: string;
  toEmail: string;
  clientPrenom: string;
  clientNom: string;
} {
  const toEmail = String(dossier?.formData?.assures?.[0]?.email || "").trim().toLowerCase();
  const clientPrenom = String(dossier?.formData?.assures?.[0]?.prenom || "").trim();
  const clientNom = String(dossier?.formData?.assures?.[0]?.nom || "").trim();

  if (!toEmail) {
    return { ok: false, error: "Aucune adresse email sur ce dossier.", toEmail, clientPrenom, clientNom };
  }

  const subjectName = extractFirstNameFromStudySubject(subject);
  if (subjectName && clientPrenom) {
    const a = subjectName.toLowerCase();
    const b = clientPrenom.toLowerCase();
    if (a !== b && !a.startsWith(b) && !b.startsWith(a)) {
      return {
        ok: false,
        error: `L'objet du mail s'adresse à « ${subjectName} » mais le dossier ${dossier.id} est au nom de ${clientPrenom} ${clientNom} (destinataire : ${toEmail}). Ouvrez le bon dossier LCIF ou corrigez l'objet avant d'envoyer.`,
        toEmail,
        clientPrenom,
        clientNom,
      };
    }
  }

  return { ok: true, toEmail, clientPrenom, clientNom };
}
