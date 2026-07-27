/**
 * Vérifie qu'un statut MAIL_ENVOYÉ sans envoi réel d'étude ne compte pas comme « étude envoyée ».
 * Usage: npx tsx scripts/verify-study-sent-false-positive.ts
 */
import assert from "assert";
import { hasStudyBeenSent, getLastStudyOutbound } from "../server/dossierLifecycle";
import type { Dossier } from "../server/dossierModel";

function base(partial: Partial<Dossier> = {}): Dossier {
  return {
    id: "LCIF-744670",
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    status: "NOUVEAU",
    formData: { assures: [{ prenom: "Test", nom: "Client", email: "t@example.com" }] },
    eventLog: [],
    communications: [],
    emails: [],
    ...partial,
  } as Dossier;
}

// Faux positif historique : statut MAIL_ENVOYÉ sans mail d'étude
assert.equal(
  hasStudyBeenSent(base({ status: "MAIL_ENVOYÉ" })),
  false,
  "MAIL_ENVOYÉ seul ne doit pas valoir étude envoyée",
);
assert.equal(
  hasStudyBeenSent(
    base({
      status: "MAIL_ENVOYÉ",
      studyDraft: { kind: "MANUAL", computedAt: "2026-07-01", subject: "Brouillon", html: "<p>x</p>" },
    } as any),
  ),
  false,
  "brouillon + statut ne suffit pas",
);

// Confirmation de réception
assert.equal(
  hasStudyBeenSent(
    base({
      status: "EN_COURS",
      eventLog: [
        {
          type: "EMAIL_SENT",
          at: "2026-07-01T11:00:00.000Z",
          meta: {
            template: "CONFIRMATION",
            subject: "Confirmation de réception - Dossier N° LCIF-744670",
          },
        } as any,
      ],
    }),
  ),
  false,
);

// Copie conseiller
assert.equal(
  hasStudyBeenSent(
    base({
      eventLog: [
        {
          type: "EMAIL_SENT",
          at: "2026-07-01T11:00:00.000Z",
          message: "Copie étude transmise au conseiller (x@y.fr).",
          meta: { template: "CONSEILLER_STUDY_COPY" },
        } as any,
      ],
    }),
  ),
  false,
);

// Vrai envoi
const real = base({
  status: "EN_COURS",
  communications: [
    {
      id: "1",
      direction: "outbound",
      subject: "Marie, votre étude personnalisée - Assurance Emprunteur",
      date: "2026-07-02T10:00:00.000Z",
      text: "…",
    } as any,
  ],
});
assert.equal(hasStudyBeenSent(real), true);
assert.ok(getLastStudyOutbound(real)?.subject.includes("étude"));

console.log("verify-study-sent-false-positive: OK");
