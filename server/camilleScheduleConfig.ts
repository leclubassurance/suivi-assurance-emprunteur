import type { ApporteurStore } from "./apporteurStore";
import {
  DEFAULT_CAMILLE_SCHEDULE,
  isWithinCamilleSchedule,
  normalizeCamilleSchedule,
  type CamilleSchedule,
} from "../shared/camilleSchedule";
import { parisDayHour } from "./businessHours";

export type { CamilleSchedule };

export function getCamilleScheduleFromStore(store: ApporteurStore): CamilleSchedule {
  if (store.camilleSchedule) return normalizeCamilleSchedule(store.camilleSchedule);
  return { ...DEFAULT_CAMILLE_SCHEDULE };
}

export async function loadCamilleSchedule(): Promise<CamilleSchedule> {
  const { loadApporteurStore } = await import("./apporteurStore");
  const store = await loadApporteurStore();
  return getCamilleScheduleFromStore(store);
}

export async function saveCamilleSchedule(raw: unknown): Promise<CamilleSchedule> {
  const normalized = normalizeCamilleSchedule(raw);
  const { loadApporteurStore, persistApporteurStoreMutation } = await import("./apporteurStore");
  await loadApporteurStore();
  await persistApporteurStoreMutation((store) => {
    store.camilleSchedule = normalized;
    return true;
  });
  return normalized;
}

/** Camille est-elle autorisée à traiter automatiquement les emails maintenant ? */
export async function isCamilleScheduleOpenNow(now = new Date()): Promise<boolean> {
  const schedule = await loadCamilleSchedule();
  return isWithinCamilleSchedule(schedule, parisDayHour(now));
}
