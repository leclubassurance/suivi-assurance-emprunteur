import type { Dossier } from "./dossierModel";
import { findApporteurById } from "./apporteurStore";
import { isConseillerImmoClubType } from "../shared/conseillerImmoClub";
import { formatApporteurDisplayName } from "../shared/apporteurProfile";
import { sendEmail } from "./emailProvider";
import { addEvent } from "./dossierModel";
import { hasStudyBeenSent } from "./dossierLifecycle";

function studyNotifyKey(dossierId: string): string {
  return `conseiller_study_copy:${dossierId}`;
}

export function wasConseillerStudyCopySent(dossier: Dossier): boolean {
  if ((dossier as any).conseillerStudyNotifiedAt) return true;
  return (dossier.eventLog || []).some(
    (e) => e.meta?.kind === studyNotifyKey(dossier.id) || e.meta?.template === "CONSEILLER_STUDY_COPY",
  );
}

/** Envoie une copie d'information au conseiller quand l'étude part au client (phase B surtout, aussi phase A). */
export async function maybeNotifyConseillerStudySent(
  dossier: Dossier,
  params: { subject: string; excerpt?: string },
): Promise<{ sent: boolean; reason?: string }> {
  if (!hasStudyBeenSent(dossier)) return { sent: false, reason: "no_study" };
  if (wasConseillerStudyCopySent(dossier)) return { sent: false, reason: "already_sent" };

  const apporteurId = String((dossier as any).apporteur?.apporteurId || "").trim();
  if (!apporteurId) return { sent: false, reason: "no_apporteur" };

  const apporteur = await findApporteurById(apporteurId);
  if (!apporteur || !isConseillerImmoClubType(apporteur.type)) {
    return { sent: false, reason: "not_conseiller" };
  }
  if (!apporteur.email?.includes("@")) return { sent: false, reason: "no_email" };

  const clientName = [
    dossier.formData?.assures?.[0]?.prenom,
    dossier.formData?.assures?.[0]?.nom,
  ]
    .filter(Boolean)
    .join(" ");
  const prenom = String(apporteur.contactPrenom || formatApporteurDisplayName(apporteur).split(" ")[0] || "");
  const subject = `[${dossier.id}] Étude envoyée au client — ${params.subject.slice(0, 80)}`;
  const body = [
    `Bonjour ${prenom},`,
    "",
    `L'étude personnalisée d'assurance emprunteur a été envoyée au client pour le dossier ${dossier.id}${clientName ? ` (${clientName})` : ""}.`,
    "",
    `Objet du mail client : ${params.subject}`,
    params.excerpt ? `\nExtrait :\n${params.excerpt.slice(0, 1200)}` : "",
    "",
    "Vous pouvez suivre l'avancement et les prochaines étapes dans votre espace conseiller.",
    "",
    "Le Club Immobilier Français",
  ].join("\n");

  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#334155;white-space:pre-wrap">${body.replace(/</g, "&lt;")}</div>`;
  const result = await sendEmail({ to: apporteur.email, subject, html });
  if (!result.ok) return { sent: false, reason: "error" in result ? result.error : "send_failed" };

  const now = new Date().toISOString();
  (dossier as any).conseillerStudyNotifiedAt = now;
  addEvent(dossier, {
    type: "EMAIL_SENT",
    actor: { kind: "SYSTEM", label: "Conseiller" },
    message: `Copie étude transmise au conseiller (${apporteur.email}).`,
    meta: { template: "CONSEILLER_STUDY_COPY", kind: studyNotifyKey(dossier.id), to: apporteur.email },
  });
  return { sent: true };
}
