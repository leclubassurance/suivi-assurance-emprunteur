import fs from "fs";
import path from "path";
import {
  initFirebaseSync,
  isFirebaseConfigured,
  isFirestoreReady,
  readAllDossiersFromFirestore,
  syncDossierToFirebase,
  deleteDossierFromFirebase,
  importLocalJsonToFirestoreIfRequested,
} from "./firebaseSync";
import { Dossier, ensureDossierShape } from "./dossierModel";

export interface DBShape {
  dossiers: Dossier[];
}

function getLocalDbFile(): string {
  if (process.env.VERCEL || process.env.RAILWAY_ENVIRONMENT) {
    return path.join("/tmp", "data", "db.json");
  }
  return path.join(process.cwd(), "data", "db.json");
}

export function getDbFilePath() {
  return getLocalDbFile();
}

function useLocalDbOnly(): boolean {
  if (process.env.USE_LOCAL_DB === "true") return true;
  if (process.env.DATA_STORE === "local") return true;
  return false;
}

function useFirestorePrimary(): boolean {
  if (useLocalDbOnly()) return false;
  if (process.env.DATA_STORE === "firestore") return isFirebaseConfigured();
  // Par défaut : Firestore si configuré (prod Railway / Vercel API)
  return isFirebaseConfigured();
}

let dbInitDone = false;

async function ensureDbLayerReady(): Promise<void> {
  if (dbInitDone) return;
  await initFirebaseSync();
  if (useFirestorePrimary()) {
    await importLocalJsonToFirestoreIfRequested();
  }
  dbInitDone = true;
}

function readLocalDBSync(): DBShape {
  const dbFile = getLocalDbFile();
  const dataDir = path.dirname(dbFile);
  if (!fs.existsSync(dbFile)) return { dossiers: [] };
  const raw = fs.readFileSync(dbFile, "utf-8");
  const parsed = JSON.parse(raw);
  const dossiers = Array.isArray(parsed?.dossiers) ? parsed.dossiers.map(ensureDossierShape) : [];
  return { dossiers };
}

function writeLocalDBSync(db: DBShape) {
  const dbFile = getLocalDbFile();
  const dataDir = path.dirname(dbFile);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2), "utf-8");
}

/** Source de vérité : Firestore (prod) ou fichier local (dev sans Firebase). */
export async function readDB(): Promise<DBShape> {
  await ensureDbLayerReady();

  if (useFirestorePrimary()) {
    if (!isFirestoreReady()) {
      throw new Error(
        "Firestore requis mais non connecté. Vérifiez FIREBASE_* sur Railway (même projet que Vercel).",
      );
    }
    const dossiers = await readAllDossiersFromFirestore();
    return { dossiers };
  }

  return readLocalDBSync();
}

export async function writeDB(db: DBShape, modifiedDossier?: Dossier): Promise<void> {
  await ensureDbLayerReady();

  if (modifiedDossier) {
    const { normalizeDossierDocumentsForPersistence } = await import("./documentStoragePolicy");
    normalizeDossierDocumentsForPersistence(modifiedDossier);
  }

  if (useFirestorePrimary()) {
    if (!isFirestoreReady()) {
      throw new Error("Impossible d'écrire : Firestore non connecté.");
    }
    if (modifiedDossier) {
      await syncDossierToFirebase(modifiedDossier);
      return;
    }
    for (const dossier of db.dossiers) {
      await syncDossierToFirebase(dossier);
    }
    return;
  }

  writeLocalDBSync(db);
  if (modifiedDossier && isFirebaseConfigured()) {
    await syncDossierToFirebase(modifiedDossier).catch(() => undefined);
  }
}

export function getDataStoreMode(): "firestore" | "local" {
  return useFirestorePrimary() ? "firestore" : "local";
}

/** Supprime un dossier sans resynchroniser toute la collection (évite timeout admin). */
export async function deleteDossierFromStore(id: string): Promise<void> {
  await ensureDbLayerReady();

  if (useFirestorePrimary()) {
    if (!isFirestoreReady()) {
      throw new Error("Impossible de supprimer : Firestore non connecté.");
    }
    await deleteDossierFromFirebase(id);
    return;
  }

  const db = readLocalDBSync();
  db.dossiers = db.dossiers.filter((d) => d.id !== id);
  writeLocalDBSync(db);
}
