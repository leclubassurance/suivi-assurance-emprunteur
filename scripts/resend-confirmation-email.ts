import "dotenv/config";
import { readDB, writeDB } from "../server/db";
import { sendDossierConfirmationEmail } from "../server/dossierConfirmationEmail";

async function main() {
  const dossierId = process.argv[2];
  if (!dossierId) {
    console.error("Usage: npx tsx scripts/resend-confirmation-email.ts LCIF-XXXXXX");
    process.exit(1);
  }

  const db = await readDB();
  const dossier = db.dossiers.find((d: any) => d.id === dossierId);
  if (!dossier) {
    console.error(`Dossier introuvable: ${dossierId}`);
    process.exit(1);
  }

  const result = await sendDossierConfirmationEmail(dossier, {
    log: (msg) => console.log(msg),
  });
  await writeDB(db);

  if (!result.ok) {
    console.error("Échec:", result.error || result.channel);
    process.exit(1);
  }

  console.log(`OK — confirmation envoyée via ${result.channel}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
