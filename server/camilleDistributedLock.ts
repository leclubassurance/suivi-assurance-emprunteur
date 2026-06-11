import { doc, runTransaction } from "firebase/firestore";
import { getFirestoreDb, initFirebaseSync } from "./firebaseSync";

const LOCKS_COLLECTION = "_camilleLocks";
const LOCK_TTL_MS = 120_000;

function lockInstanceId(): string {
  return (
    process.env.RAILWAY_REPLICA_ID ||
    process.env.RAILWAY_DEPLOYMENT_ID ||
    process.env.HOSTNAME ||
    `pid-${process.pid}`
  );
}

export async function tryAcquireDistributedLock(lockKey: string): Promise<boolean> {
  await initFirebaseSync();
  const db = getFirestoreDb();
  if (!db) return true;

  const ref = doc(db, LOCKS_COLLECTION, lockKey);
  const now = Date.now();
  const holder = lockInstanceId();

  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists()) {
        const data = snap.data() as { expiresAt?: number; holder?: string };
        if (data.expiresAt && data.expiresAt > now && data.holder !== holder) {
          return false;
        }
      }
      tx.set(ref, {
        holder,
        expiresAt: now + LOCK_TTL_MS,
        updatedAt: now,
      });
      return true;
    });
  } catch (err: any) {
    const msg = String(err?.message || err);
    console.warn(`[Lock] acquire ${lockKey} failed:`, msg);
    // Firestore rules ou indispo → on retombe sur le verrou mémoire (ne pas bloquer l'envoi).
    if (/PERMISSION_DENIED|permission|insufficient/i.test(msg)) {
      console.warn(`[Lock] ${lockKey} — fallback verrou local uniquement`);
      return true;
    }
    return false;
  }
}

export async function releaseDistributedLock(lockKey: string): Promise<void> {
  await initFirebaseSync();
  const db = getFirestoreDb();
  if (!db) return;

  const ref = doc(db, LOCKS_COLLECTION, lockKey);
  const now = Date.now();
  const holder = lockInstanceId();

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const data = snap.data() as { holder?: string };
      if (data.holder !== holder) return;
      tx.set(ref, { holder, expiresAt: now - 1, updatedAt: now });
    });
  } catch (err: any) {
    console.warn(`[Lock] release ${lockKey} failed:`, err?.message || err);
  }
}
