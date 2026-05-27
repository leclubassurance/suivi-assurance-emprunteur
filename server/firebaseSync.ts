import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, deleteDoc } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';

let firestoreDb: any = null;

export async function initFirebaseSync() {
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (!fs.existsSync(configPath)) {
    console.log("[Firebase] Configuration not found, skipping sync.");
    return;
  }

  const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (firebaseConfig.apiKey && firebaseConfig.apiKey.includes("dummy")) {
    console.log("[Firebase] Dummy API key detected, skipping sync.");
    return;
  }
  const app = initializeApp(firebaseConfig);
  firestoreDb = getFirestore(app, firebaseConfig.firestoreDatabaseId);

  // Download all dossiers on start if local db is empty
  const DB_FILE = path.join(process.cwd(), "data", "db.json");
  let hasLocalData = false;
  if (fs.existsSync(DB_FILE)) {
    try {
        const localData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        if (localData && localData.dossiers && localData.dossiers.length > 0) {
            hasLocalData = true;
        }
    } catch (e) {
        // ignore
    }
  }

  if (!hasLocalData) {
    try {
        const snap = await getDocs(collection(firestoreDb, 'dossiers'));
        const dossiers = snap.docs.map(d => d.data());
        if (!fs.existsSync(path.dirname(DB_FILE))) {
            fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
        }
        fs.writeFileSync(DB_FILE, JSON.stringify({ dossiers }, null, 2));
        console.log(`[Firebase] Initialized local DB with ${dossiers.length} dossiers from Firestore.`);
    } catch (err: any) {
        console.error("[Firebase] Error fetching initial data from Firestore:", err.message);
    }
  } else {
    // Sync local to Firestore to avoid data loss
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        if (data && data.dossiers) {
            for (const dossier of data.dossiers) {
                const cleanDossier = JSON.parse(JSON.stringify(dossier));
                await setDoc(doc(firestoreDb, 'dossiers', cleanDossier.id), cleanDossier);
            }
            console.log(`[Firebase] Synced ${data.dossiers.length} local dossiers to Firestore.`);
        }
    } catch(err: any) {
        console.error("[Firebase] Error syncing local data to Firestore:", err.message);
    }
  }
}

export async function refreshFromFirebase() {
  if (!firestoreDb) return;
  try {
    const snap = await getDocs(collection(firestoreDb, 'dossiers'));
    const dossiers = snap.docs.map(d => d.data());
    const DB_FILE = path.join(process.cwd(), "data", "db.json");
    if (!fs.existsSync(path.dirname(DB_FILE))) {
      fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify({ dossiers }, null, 2), "utf-8");
  } catch (err: any) {
    console.error("[Firebase] Error refreshing from Firestore:", err.message);
  }
}

export async function syncDossierToFirebase(dossier: any) {
  if (!firestoreDb) return;
  try {
    const cleanDossier = JSON.parse(JSON.stringify(dossier));
    await setDoc(doc(firestoreDb, 'dossiers', cleanDossier.id), cleanDossier);
  } catch (err: any) {
    console.error("[Firebase] Error syncing dossier:", dossier.id, err.message);
  }
}

export async function deleteDossierFromFirebase(id: string) {
  if (!firestoreDb) return;
  try {
    await deleteDoc(doc(firestoreDb, 'dossiers', id));
  } catch (err: any) {
    console.error("[Firebase] Error deleting dossier:", id, err.message);
  }
}
