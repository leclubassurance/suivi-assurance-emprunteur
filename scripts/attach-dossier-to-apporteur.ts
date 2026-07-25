/**
 * Rattache un dossier à un conseiller/apporteur (prod Firestore).
 * Usage:
 *   npx tsx -r dotenv/config scripts/attach-dossier-to-apporteur.ts LCIF-390485 "arthur vaillant"
 */
import { initFirebaseSync, getFirebaseStatus, readDossierFromFirestore } from "../server/firebaseSync";
import { writeDB, readDB } from "../server/db";
import {
  loadApporteurStore,
  createReferral,
  findApporteurById,
  syncReferralFromDossier,
  listReferrals,
} from "../server/apporteurStore";

const dossierId = String(process.argv[2] || "").trim().toUpperCase();
const query = String(process.argv[3] || "").trim().toLowerCase();

if (!dossierId || !query) {
  console.error('Usage: npx tsx -r dotenv/config scripts/attach-dossier-to-apporteur.ts <DOSSIER_ID> "<nom conseiller>"');
  process.exit(1);
}

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function main() {
  await initFirebaseSync();
  const status = await getFirebaseStatus();
  if (!status.ready) {
    console.error("Firestore unavailable:", status.error);
    process.exit(2);
  }

  const store = await loadApporteurStore();
  const q = norm(query);
  const matches = store.apporteurs.filter((a) => {
    const hay = norm(
      [a.contactPrenom, a.contactNom, a.contactName, a.companyName, a.email].filter(Boolean).join(" "),
    );
    return hay.includes(q) || q.split(" ").every((p) => hay.includes(p));
  });

  if (matches.length === 0) {
    console.error("Aucun conseiller trouvé pour:", query);
    console.error(
      "Conseillers club:",
      store.apporteurs
        .filter((a) => a.type === "conseiller_immo_club")
        .map((a) => `${a.contactName} <${a.email}> (${a.id})`)
        .join("\n"),
    );
    process.exit(3);
  }
  if (matches.length > 1) {
    console.error("Plusieurs correspondances:");
    for (const a of matches) {
      console.error(`- ${a.id} | ${a.contactName} | ${a.email} | ${a.companyName}`);
    }
    process.exit(4);
  }

  const apporteur = matches[0]!;
  const dossier = await readDossierFromFirestore(dossierId);
  if (!dossier) {
    console.error("Dossier introuvable:", dossierId);
    process.exit(5);
  }

  const assure = dossier.formData?.assures?.[0] || {};
  console.log("Apporteur:", apporteur.id, apporteur.contactName, apporteur.email);
  console.log("Dossier:", dossier.id, assure.prenom, assure.nom, assure.email);
  console.log("Avant:", dossier.apporteur || null);

  const existingReferrals = await listReferrals({ apporteurId: apporteur.id });
  let referral = existingReferrals.find((r) => r.dossierId === dossierId);
  if (!referral) {
    referral = await createReferral({
      apporteurId: apporteur.id,
      contact: {
        prenom: assure.prenom,
        nom: assure.nom,
        email: assure.email,
        phone: assure.telephone,
      },
      source: "admin",
      status: "DOSSIER_OUVERT",
      dossierId,
      actor: "admin_script_attach",
    });
  }

  dossier.apporteur = {
    apporteurId: apporteur.id,
    referralId: referral.id,
    apporteurLabel: apporteur.companyName,
    referralToken: apporteur.referralToken,
  };
  if (dossier.formData && !dossier.formData.apporteurRefToken) {
    (dossier.formData as any).apporteurRefToken = apporteur.referralToken;
  }

  await syncReferralFromDossier(dossier, "admin_script_attach");
  const db = await readDB();
  const idx = db.dossiers.findIndex((d) => d.id === dossierId);
  if (idx >= 0) db.dossiers[idx] = dossier;
  else db.dossiers.push(dossier);
  await writeDB(db, dossier);

  const verify = await readDossierFromFirestore(dossierId);
  console.log("Après:", verify?.apporteur || null);
  console.log("OK — dossier rattaché.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
