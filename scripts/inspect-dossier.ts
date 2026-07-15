/** Usage: npx tsx -r dotenv/config scripts/inspect-dossier.ts LCIF-988700 */
import { initFirebaseSync, getFirebaseStatus, readDossierFromFirestore } from "../server/firebaseSync";

const id = process.argv[2]?.trim();
if (!id) {
  console.error("Usage: npx tsx -r dotenv/config scripts/inspect-dossier.ts <DOSSIER_ID>");
  process.exit(1);
}

async function main() {
  await initFirebaseSync();
  const status = await getFirebaseStatus();
  if (!status.ready) {
    console.error("Firestore unavailable:", status.error);
    process.exit(2);
  }

  const dossier = await readDossierFromFirestore(id);
  if (!dossier) {
    console.error("Dossier not found:", id);
    process.exit(3);
  }

  const v = dossier.studyConseillerValidation;
  const summary = {
    id: dossier.id,
    status: dossier.status,
    statusManualAt: dossier.statusManualAt || null,
    subscriptionProgress: dossier.subscriptionProgress || null,
    clientAcceptedInsuranceAt: dossier.clientAcceptedInsuranceAt || null,
    clientAcceptedInsuranceSource: dossier.clientAcceptedInsuranceSource || null,
    updatedAt: dossier.updatedAt,
    clients: (dossier.formData?.assures || []).map((a) => ({
      prenom: a.prenom,
      nom: a.nom,
      email: a.email,
      telephone: a.telephone,
    })),
    apporteurId: dossier.apporteurId,
    referralId: dossier.referralId,
    studyConseillerValidation: v
      ? {
          status: v.status,
          submittedAt: v.submittedAt,
          approvedAt: v.approvedAt,
          assuredCount: v.assuredCount,
          suggestedFeePerAssuredEur: v.suggestedFeePerAssuredEur,
          feesPerAssuredEur: v.feesPerAssuredEur,
          feesCourtageTotalEur: v.feesCourtageTotalEur,
          grossSavingsEur: v.grossSavingsEur,
          conseillerRetroEur: v.conseillerRetroEur,
        }
      : null,
    studyKpi: dossier.studyKpi || null,
    studyDraft: dossier.studyDraft
      ? {
          computedAt: dossier.studyDraft.computedAt,
          reliability: dossier.studyDraft.reliability,
          economySummary: dossier.studyDraft.economySummary,
          subject: dossier.studyDraft.subject,
          htmlHasCourtage: /Frais de courtage/i.test(String(dossier.studyDraft.html || "")),
        }
      : null,
    recentEvents: (dossier.events || []).slice(-10).map((e) => ({
      type: e.type,
      at: e.at,
      message: e.message,
      meta: e.meta,
    })),
    outboundEmails: (dossier.communications || [])
      .filter((c) => c.direction === "outbound")
      .slice(-5)
      .map((c) => ({
        at: c.at,
        subject: c.subject,
        channel: c.channel,
      })),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
