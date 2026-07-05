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
import type { Firestore as AdminFirestore } from "firebase-admin/firestore";
import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { ensureDossierShape } from "./dossierModel";
import { compactDossierForPersistence, stripUndefinedForFirestore } from "./dossierFirestoreCompact";
import { loadServiceAccountCredentials } from "./serviceAccount";

const DOSSIERS_COLLECTION = "dossiers";
const APPORTEUR_STORE_COLLECTION = "apporteur_store";
const APPORTEUR_STORE_DOC_ID = "main";
const NETWORK_STORE_COLLECTION = "network_store";
const NETWORK_STORE_DOC_ID = "main";

let firebaseApp: FirebaseApp | null = null;
let clientFirestoreDb: Firestore | null = null;
let adminFirestoreDb: AdminFirestore | null = null;
let firestoreMode: "admin" | "client" | null = null;
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
  firestoreMode?: "admin" | "client" | null;
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

function resolveProjectId(config: Record<string, string> | null): string | null {
  return (
    config?.projectId ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    null
  );
}

function loadFirebaseServiceAccountCredentials(): Record<string, unknown> | null {
  const raw =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() ||
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  if (raw) {
    try {
      const parsed = raw.startsWith("{")
        ? JSON.parse(raw)
        : JSON.parse(Buffer.from(raw.replace(/\s/g, ""), "base64").toString("utf8"));
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }

  const driveSa = loadServiceAccountCredentials();
  const firebaseProjectId =
    process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || "";
  if (
    driveSa &&
    firebaseProjectId &&
    String(driveSa.project_id || "") === firebaseProjectId
  ) {
    return driveSa;
  }
  return null;
}

async function tryInitAdminFirestore(projectId: string): Promise<AdminFirestore | null> {
  try {
    const sa = loadFirebaseServiceAccountCredentials();
    if (!sa) {
      console.warn(
        "[Firebase] Admin SDK : ajoutez FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 (clé Firebase Console, pas le compte Drive).",
      );
      return null;
    }

    const saEmail = String(sa.client_email || "");
    if (saEmail && !saEmail.includes("firebase-adminsdk") && saEmail !== loadServiceAccountCredentials()?.client_email) {
      console.warn(`[Firebase] Admin SDK : compte ${saEmail} — préférez firebase-adminsdk@...`);
    }

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(sa as admin.ServiceAccount),
        projectId,
      });
    }
    const db = admin.firestore();
    await db.collection(DOSSIERS_COLLECTION).limit(1).get();
    console.log(
      `[Firebase] Admin SDK prêt — projet=${projectId}, compte=${saEmail || "?"} (bypass règles Firestore)`,
    );
    return db;
  } catch (err: any) {
    console.warn(
      `[Firebase] Admin SDK indisponible (${err?.message || err}) — repli SDK client (règles ouvertes requises).`,
    );
    return null;
  }
}

function initClientFirestore(config: Record<string, string>): Firestore {
  firebaseApp = initializeApp(config);
  return getFirestore(firebaseApp, config.firestoreDatabaseId || undefined);
}

function activeDb(): Firestore | AdminFirestore | null {
  return adminFirestoreDb || clientFirestoreDb;
}

export function isFirebaseConfigured(): boolean {
  return loadFirebaseConfig() !== null;
}

export function isFirestoreReady(): boolean {
  return Boolean(activeDb());
}

export function getFirestoreDb(): Firestore | null {
  return clientFirestoreDb;
}

export function getFirebaseProjectId(): string | null {
  return loadedProjectId;
}

export function getFirestoreMode(): "admin" | "client" | null {
  return firestoreMode;
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

    loadedProjectId = resolveProjectId(firebaseConfig);
    if (!loadedProjectId) {
      console.error("[Firebase] FIREBASE_PROJECT_ID manquant.");
      return;
    }

    adminFirestoreDb = await tryInitAdminFirestore(loadedProjectId);
    if (adminFirestoreDb) {
      firestoreMode = "admin";
      return;
    }

    const onRailway = Boolean(process.env.RAILWAY_ENVIRONMENT);
    if (onRailway || process.env.FIREBASE_REQUIRED === "true") {
      console.error(
        "[Firebase] CRITIQUE : Admin SDK requis sur Railway. Ajoutez FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 " +
          "(Firebase Console → Comptes de service → Générer clé). Ne publiez pas de règles Firestore fermées sans cela.",
      );
    }

    clientFirestoreDb = initClientFirestore(firebaseConfig);
    firestoreMode = "client";
    try {
      const snap = await getDocs(collection(clientFirestoreDb, DOSSIERS_COLLECTION));
      console.log(
        `[Firebase] SDK client prêt — projet=${loadedProjectId}, dossiers=${snap.size} (règles Firestore doivent autoriser l'accès).`,
      );
    } catch (err: any) {
      console.error("[Firebase] Connexion Firestore échouée:", err?.message || err);
      clientFirestoreDb = null;
      firestoreMode = null;
      throw err;
    }
  })();

  return initPromise;
}

export async function getFirebaseStatus(): Promise<FirebaseStatus> {
  await initFirebaseSync();
  const db = activeDb();
  if (!db) {
    return {
      configured: isFirebaseConfigured(),
      ready: false,
      projectId: loadedProjectId,
      databaseId: process.env.FIREBASE_DATABASE_ID || "(default)",
      collection: DOSSIERS_COLLECTION,
      dossierCount: null,
      error: isFirebaseConfigured() ? "Firestore non initialisé" : "Variables Firebase absentes",
      firestoreMode,
    };
  }

  try {
    const snap = adminFirestoreDb
      ? await adminFirestoreDb.collection(DOSSIERS_COLLECTION).get()
      : await getDocs(collection(clientFirestoreDb!, DOSSIERS_COLLECTION));
    const count = adminFirestoreDb ? snap.size : snap.size;
    return {
      configured: true,
      ready: true,
      projectId: loadedProjectId,
      databaseId: process.env.FIREBASE_DATABASE_ID || "(default)",
      collection: DOSSIERS_COLLECTION,
      dossierCount: count,
      error: null,
      firestoreMode,
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
      firestoreMode,
    };
  }
}

export async function readAllDossiersFromFirestore(): Promise<ReturnType<typeof ensureDossierShape>[]> {
  await initFirebaseSync();
  const db = activeDb();
  if (!db) {
    throw new Error(
      "Firestore indisponible : configurez FIREBASE_PROJECT_ID et FIREBASE_API_KEY sur Railway.",
    );
  }

  if (adminFirestoreDb) {
    const snap = await adminFirestoreDb.collection(DOSSIERS_COLLECTION).get();
    return snap.docs.map((d) => ensureDossierShape(d.data()));
  }
  const snap = await getDocs(collection(clientFirestoreDb!, DOSSIERS_COLLECTION));
  return snap.docs.map((d) => ensureDossierShape(d.data()));
}

export async function readDossierFromFirestore(id: string) {
  await initFirebaseSync();
  const db = activeDb();
  if (!db) return null;

  if (adminFirestoreDb) {
    const snap = await adminFirestoreDb.collection(DOSSIERS_COLLECTION).doc(id).get();
    if (!snap.exists) return null;
    return ensureDossierShape(snap.data());
  }
  const snap = await getDoc(doc(clientFirestoreDb!, DOSSIERS_COLLECTION, id));
  if (!snap.exists()) return null;
  return ensureDossierShape(snap.data());
}

export async function syncDossierToFirebase(dossier: unknown) {
  await initFirebaseSync();
  const db = activeDb();
  if (!db) return;
  try {
    const shaped = ensureDossierShape(dossier);
    const cleanDossier = compactDossierForPersistence(shaped);
    if (adminFirestoreDb) {
      await adminFirestoreDb
        .collection(DOSSIERS_COLLECTION)
        .doc(String(cleanDossier.id))
        .set(cleanDossier as Record<string, unknown>);
    } else {
      await setDoc(doc(clientFirestoreDb!, DOSSIERS_COLLECTION, cleanDossier.id as string), cleanDossier);
    }
  } catch (err: any) {
    console.error("[Firebase] Error syncing dossier:", (dossier as any)?.id, err.message);
    throw err;
  }
}

export async function deleteDossierFromFirebase(id: string) {
  await initFirebaseSync();
  const db = activeDb();
  if (!db) return;
  try {
    if (adminFirestoreDb) {
      await adminFirestoreDb.collection(DOSSIERS_COLLECTION).doc(id).delete();
    } else {
      await deleteDoc(doc(clientFirestoreDb!, DOSSIERS_COLLECTION, id));
    }
  } catch (err: any) {
    console.error("[Firebase] Error deleting dossier:", id, err.message);
    throw err;
  }
}

export type ApporteurStoreDoc = {
  version: 1;
  apporteurs: unknown[];
  referrals: unknown[];
  partnerRecruits?: unknown[];
  updatedAt: string;
};

export async function readApporteurStoreFromFirestore(): Promise<ApporteurStoreDoc | null> {
  await initFirebaseSync();
  const db = activeDb();
  if (!db) return null;

  if (adminFirestoreDb) {
    const snap = await adminFirestoreDb
      .collection(APPORTEUR_STORE_COLLECTION)
      .doc(APPORTEUR_STORE_DOC_ID)
      .get();
    if (!snap.exists) return null;
    const data = snap.data() as ApporteurStoreDoc;
    if (!Array.isArray(data?.apporteurs)) return null;
    return data;
  }

  const snap = await getDoc(doc(clientFirestoreDb!, APPORTEUR_STORE_COLLECTION, APPORTEUR_STORE_DOC_ID));
  if (!snap.exists()) return null;
  const data = snap.data() as ApporteurStoreDoc;
  if (!Array.isArray(data?.apporteurs)) return null;
  return data;
}

export async function writeApporteurStoreToFirestore(store: ApporteurStoreDoc): Promise<void> {
  await initFirebaseSync();
  const db = activeDb();
  if (!db) {
    throw new Error("Firestore non initialisé — impossible d'écrire apporteur_store.");
  }
  const payload = stripUndefinedForFirestore(store);
  if (adminFirestoreDb) {
    await adminFirestoreDb
      .collection(APPORTEUR_STORE_COLLECTION)
      .doc(APPORTEUR_STORE_DOC_ID)
      .set(payload);
    return;
  }
  await setDoc(doc(clientFirestoreDb!, APPORTEUR_STORE_COLLECTION, APPORTEUR_STORE_DOC_ID), payload);
}

export type NetworkStoreDoc = {
  version: 1;
  members: unknown[];
  referrals: unknown[];
  updatedAt: string;
};

export async function readNetworkStoreFromFirestore(): Promise<NetworkStoreDoc | null> {
  await initFirebaseSync();
  const db = activeDb();
  if (!db) return null;

  if (adminFirestoreDb) {
    const snap = await adminFirestoreDb.collection(NETWORK_STORE_COLLECTION).doc(NETWORK_STORE_DOC_ID).get();
    if (!snap.exists) return null;
    const data = snap.data() as NetworkStoreDoc;
    if (!Array.isArray(data?.members)) return null;
    return data;
  }

  const snap = await getDoc(doc(clientFirestoreDb!, NETWORK_STORE_COLLECTION, NETWORK_STORE_DOC_ID));
  if (!snap.exists()) return null;
  const data = snap.data() as NetworkStoreDoc;
  if (!Array.isArray(data?.members)) return null;
  return data;
}

export async function writeNetworkStoreToFirestore(store: NetworkStoreDoc): Promise<void> {
  await initFirebaseSync();
  const db = activeDb();
  if (!db) {
    throw new Error("Firestore non initialisé — impossible d'écrire network_store.");
  }
  const payload = stripUndefinedForFirestore(store);
  if (adminFirestoreDb) {
    await adminFirestoreDb.collection(NETWORK_STORE_COLLECTION).doc(NETWORK_STORE_DOC_ID).set(payload);
    return;
  }
  await setDoc(doc(clientFirestoreDb!, NETWORK_STORE_COLLECTION, NETWORK_STORE_DOC_ID), payload);
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
