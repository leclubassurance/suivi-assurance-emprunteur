/**
 * Usage: npx tsx scripts/verify-insurance-acceptance.ts
 */
import {
  clientHasAcceptedInsuranceChange,
  detectInsuranceChangeAcceptanceInComms,
  extractClientAuthoredEmailText,
  recordClientInsuranceAcceptance,
  syncClientInsuranceAcceptanceFromMail,
  textSignalsInsuranceChangeAcceptance,
} from "../server/insuranceAcceptance";
import {
  applySubscriptionPhaseUpdate,
  clientDecisionIsRecorded,
  resolveEffectiveSubscriptionPhase,
} from "../server/subscriptionProgress";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const baseDossier = {
  id: "LCIF-TEST",
  status: "MAIL_ENVOYÉ",
  createdAt: "2026-07-01T10:00:00.000Z",
  updatedAt: "2026-07-01T10:00:00.000Z",
  formData: {},
  communications: [
    {
      direction: "outbound",
      date: "2026-07-10T10:00:00.000Z",
      subject: "Votre étude",
    },
    {
      direction: "inbound",
      date: "2026-07-11T10:00:00.000Z",
      subject: "Re: étude",
      text: "Je suis d'accord pour le changement d'assurance",
    },
  ],
} as any;

const mailDossier = { ...baseDossier, communications: [...baseDossier.communications] };
assert(syncClientInsuranceAcceptanceFromMail(mailDossier), "sync mail crée un enregistrement");
assert(Boolean(mailDossier.clientAcceptedInsuranceAt), "date accord persistée");
assert(clientHasAcceptedInsuranceChange(mailDossier), "accord lu après persist");

const adminDossier = {
  ...baseDossier,
  communications: baseDossier.communications.slice(0, 1),
} as any;
applySubscriptionPhaseUpdate(adminDossier, "decision_received", {
  updatedBy: "admin",
  note: "Accord oral conseiller",
});
assert(Boolean(adminDossier.clientAcceptedInsuranceAt), "phase admin enregistre accord");
assert(clientDecisionIsRecorded(adminDossier), "décision visible portail conseiller");
assert(
  resolveEffectiveSubscriptionPhase(adminDossier) === "decision_received",
  "phase effective = accord client",
);
assert(adminDossier.status === "ADHESION_EN_COURS", "statut CRM aligné");

const fresh = { ...baseDossier, communications: [] } as any;
recordClientInsuranceAcceptance(fresh, { source: "admin", note: "Test manuel" });
assert(fresh.clientAcceptedInsuranceSource === "admin", "source admin");

const refusalWithQuote = `
Bonjour,

Nous vous remercions pour votre proposition et l'étude de notre dossier.

Après réflexion, nous ne souhaitons toutefois pas donner suite à votre
proposition, car nous préférons finalement conserver notre assureur actuel.

En vous remerciant pour votre temps,
Bien cordialement

Le lun. 20 juil. 2026 à 10:35, Assurance Emprunteur Le Club Immobilier
Français <assurance@leclubimmobilier.fr> a écrit :

> Bonne nouvelle : malgré le fait que vous ayez déjà changé d'assurance
> récemment, une très bonne démarche...
> j'accepte volontiers de vous accompagner — formule type dans le mail LCIF.
`;

assert(
  !textSignalsInsuranceChangeAcceptance(refusalWithQuote),
  "refus client + citation LCIF ne déclenche pas l'accord (LCIF-735749)",
);
assert(
  extractClientAuthoredEmailText(refusalWithQuote).includes("pas donner suite"),
  "extrait client conserve le refus",
);
assert(
  !extractClientAuthoredEmailText(refusalWithQuote).includes("j'accepte volontiers"),
  "extrait client ignore la citation",
);

const refusalDossier = {
  ...baseDossier,
  communications: [
    baseDossier.communications[0],
    {
      direction: "inbound",
      date: "2026-07-24T16:26:56.000Z",
      subject: "Re: Proposition d'assurance avec les nouvelles garanties",
      text: refusalWithQuote,
    },
  ],
} as any;
assert(!detectInsuranceChangeAcceptanceInComms(refusalDossier), "comms refus = pas d'accord");
assert(!syncClientInsuranceAcceptanceFromMail(refusalDossier), "sync refuse le faux positif");

assert(
  textSignalsInsuranceChangeAcceptance("Bonjour, j'accepte votre proposition. Cordialement"),
  "vrai accord j'accepte proposition",
);
assert(
  textSignalsInsuranceChangeAcceptance("Ok pour le changement, on part là-dessus."),
  "vrai accord ok pour le changement",
);

console.log("\nInsurance acceptance OK.");
