import fs from "fs";
import path from "path";
import { refreshFromFirebase, syncDossierToFirebase } from "./firebaseSync";
import { Dossier, ensureDossierShape } from "./dossierModel";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

export interface DBShape {
  dossiers: Dossier[];
}

export function getDbFilePath() {
  return DB_FILE;
}

export function readDBSync(): DBShape {
  if (!fs.existsSync(DB_FILE)) return { dossiers: [] };
  const raw = fs.readFileSync(DB_FILE, "utf-8");
  const parsed = JSON.parse(raw);
  const dossiers = Array.isArray(parsed?.dossiers) ? parsed.dossiers.map(ensureDossierShape) : [];
  return { dossiers };
}

export async function readDB(): Promise<DBShape> {
  await refreshFromFirebase().catch(() => undefined);
  return readDBSync();
}

export function writeDB(db: DBShape, modifiedDossier?: Dossier) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf-8");
  if (modifiedDossier) {
    syncDossierToFirebase(modifiedDossier).catch(() => undefined);
  }
}

