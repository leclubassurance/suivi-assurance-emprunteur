import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getFirestore,
  type Firestore,
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  deleteDoc,
} from "firebase/firestore";
import fs from "fs";
import path from "path";
import { ensureDossierShape } from "./dossierModel";
import { compactDossierForPersistence } from "./dossierFirestoreCompact";

const DOSSIERS_COLLECTION = "dossiers";
const APPORTEUR_STORE_COLLECTION = "apporteur_store";
const APPORTEUR_STORE_DOC_ID = "main";

let firebaseApp: FirebaseApp | null = null;
let firestoreDb: Firestore | null = null;
let initPromise: Promise<void> | null = null;
let loadedProjectId: string | null = null;

export type FirebaseStatus = {
  configured: boolean;
  ready: boolean;
  projectId: string | null;
  databaseId: string | null;
  collection: string;
  dossierCount: number | null;
  error: string | null;
};

function loadFirebaseConfig(): Record<string, string> | null {
  const fromEnv = {
    apiKey: process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID,
    appId: process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId:
      process.env.FIREBASE_MESSAGING_SENDER_ID || process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    firestoreDatabaseId: process.env.FIREBASE_DATABASE_ID,
  };

  if (fromEnv.apiKey && fromEnv.projectId && !fromEnv.apiKey.includes("dummy")) {
    return fromEnv as Record<string, string>;
  }

  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (!fs.existsSync(configPath)) return null;

  const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (firebaseConfig.apiKey?.includes("dummy")) return null;
  return firebaseConfig;
}

export function isFirebaseConfigured(): boolean {
  return loadFirebaseConfig() !== null;
}

export function isFirestoreReady(): boolean {
  return Boolean(firestoreDb);
}

export function getFirestoreDb(): Firestore | null {
  return firestoreDb;
}

export function getFirebaseProjectId(): string | null {
  return loadedProjectId;
}

export async function initFirebaseSync(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const firebaseConfig = loadFirebaseConfig();
    if (!firebaseConfig) {
      const onRailway = Boolean(process.env.RAILWAY_ENVIRONMENT);
      if (onRailway || process.env.FIREBASE_REQUIRED === "true") {
        console.error(
          "[Firebase] Configuration manquante. Définissez FIREBASE_* / VITE_FIREBASE_* sur Railway et Vercel.",
        );
      } else {
        console.log("[Firebase] Configuration not found — mode local uniquement (USE_LOCAL_DB).");
      }
      return;
    }

    firebaseApp = initializeApp(firebaseConfig);
    firestoreDb = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId || undefined);
    loadedProjectId = firebaseConfig.projectId || null;

    try {
      const snap = await getDocs(collection(firestoreDb, DOSSIERS_COLLECTION));
      console.log(
        `[Firebase] Firestore prêt — projet=${loadedProjectId}, collection=${DOSSIERS_COLLECTION}, dossiers=${snap.size}`,
      );
    } catch (err: any) {
      console.error("[Firebase] Connexion Firestore échouée:", err?.message || err);
      firestoreDb = null;
      throw err;
    }
  })();

  return initPromise;
}

export async function getFirebaseStatus(): Promise<FirebaseStatus> {
  await initFirebaseSync();
  if (!firestoreDb) {
    return {
      configured: isFirebaseConfigured(),
      ready: false,
      projectId: loadedProjectId,
      databaseId: process.env.FIREBASE_DATABASE_ID || "(default)",
      collection: DOSSIERS_COLLECTION,
      dossierCount: null,
      error: isFirebaseConfigured() ? "Firestore non initialisé" : "Variables Firebase absentes",
    };
  }

  try {
    const snap = await getDocs(collection(firestoreDb, DOSSIERS_COLLECTION));
    return {
      configured: true,
      ready: true,
      projectId: loadedProjectId,
      databaseId: process.env.FIREBASE_DATABASE_ID || "(default)",
      collection: DOSSIERS_COLLECTION,
      dossierCount: snap.size,
      error: null,
    };
  } catch (err: any) {
    return {
      configured: true,
      ready: false,
      projectId: loadedProjectId,
      databaseId: process.env.FIREBASE_DATABASE_ID || "(default)",
      collection: DOSSIERS_COLLECTION,
      dossierCount: null,
      error: err?.message || String(err),
    };
  }
}

export async function readAllDossiersFromFirestore(): Promise<ReturnType<typeof ensureDossierShape>[]> {
  await initFirebaseSync();
  if (!firestoreDb) {
    throw new Error(
      "Firestore indisponible : configurez FIREBASE_PROJECT_ID et FIREBASE_API_KEY sur Railway.",
    );
  }

  const snap = await getDocs(collection(firestoreDb, DOSSIERS_COLLECTION));
  return snap.docs.map((d) => ensureDossierShape(d.data()));
}

export async function readDossierFromFirestore(id: string) {
  await initFirebaseSync();
  if (!firestoreDb) return null;
  const snap = await getDoc(doc(firestoreDb, DOSSIERS_COLLECTION, id));
  if (!snap.exists()) return null;
  return ensureDossierShape(snap.data());
}

export async function syncDossierToFirebase(dossier: unknown) {
  await initFirebaseSync();
  if (!firestoreDb) return;
  try {
    const shaped = ensureDossierShape(dossier);
    const cleanDossier = compactDossierForPersistence(shaped);
    await setDoc(doc(firestoreDb, DOSSIERS_COLLECTION, cleanDossier.id as string), cleanDossier);
  } catch (err: any) {
    console.error("[Firebase] Error syncing dossier:", (dossier as any)?.id, err.message);
    throw err;
  }
}

export async function deleteDossierFromFirebase(id: string) {
  await initFirebaseSync();
  if (!firestoreDb) return;
  try {
    await deleteDoc(doc(firestoreDb, DOSSIERS_COLLECTION, id));
  } catch (err: any) {
    console.error("[Firebase] Error deleting dossier:", id, err.message);
    throw err;
  }
}

export type ApporteurStoreDoc = {
  version: 1;
  apporteurs: unknown[];
  referrals: unknown[];
  updatedAt: string;
};

/** Stockage apporteurs — collection dédiée, séparée des dossiers clients. */
export async function readApporteurStoreFromFirestore(): Promise<ApporteurStoreDoc | null> {
  await initFirebaseSync();
  if (!firestoreDb) return null;
  const snap = await getDoc(doc(firestoreDb, APPORTEUR_STORE_COLLECTION, APPORTEUR_STORE_DOC_ID));
  if (!snap.exists()) return null;
  const data = snap.data() as ApporteurStoreDoc;
  if (!Array.isArray(data?.apporteurs)) return null;
  return data;
}

export async function writeApporteurStoreToFirestore(store: ApporteurStoreDoc): Promise<void> {
  await initFirebaseSync();
  if (!firestoreDb) {
    throw new Error("Firestore non initialisé — impossible d'écrire apporteur_store.");
  }
  await setDoc(doc(firestoreDb, APPORTEUR_STORE_COLLECTION, APPORTEUR_STORE_DOC_ID), store);
}

/** Import unique : data/db.json ou /tmp/data/db.json → Firestore (FIREBASE_IMPORT_LOCAL=true). */
export async function importLocalJsonToFirestoreIfRequested() {
  if (process.env.FIREBASE_IMPORT_LOCAL !== "true") return;

  const candidates = [
    path.join(process.cwd(), "data", "db.json"),
    path.join("/tmp", "data", "db.json"),
  ];

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
      const dossiers = Array.isArray(raw?.dossiers) ? raw.dossiers : [];
      if (dossiers.length === 0) continue;
      for (const d of dossiers) {
        await syncDossierToFirebase(ensureDossierShape(d));
      }
      console.log(`[Firebase] Importé ${dossiers.length} dossier(s) depuis ${file} vers Firestore.`);
      return;
    } catch (err: any) {
      console.error(`[Firebase] Import local échoué (${file}):`, err.message);
    }
  }
}
