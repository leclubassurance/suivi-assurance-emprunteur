import type { ApporteurStore } from "./apporteurStore";
import {
  DEFAULT_KEREIS_MIA_SETTINGS,
  normalizeKereisMiaSettings,
  type KereisMiaSettings,
} from "../shared/kereisMiaRemuneration";

export type { KereisMiaSettings };

export function getKereisMiaSettingsFromStore(store: ApporteurStore): KereisMiaSettings {
  if (store.kereisMiaSettings) return normalizeKereisMiaSettings(store.kereisMiaSettings);
  return { ...DEFAULT_KEREIS_MIA_SETTINGS };
}

export async function loadKereisMiaSettings(): Promise<KereisMiaSettings> {
  const { loadApporteurStore } = await import("./apporteurStore");
  const store = await loadApporteurStore();
  return getKereisMiaSettingsFromStore(store);
}

export async function saveKereisMiaSettings(raw: unknown): Promise<KereisMiaSettings> {
  const normalized = normalizeKereisMiaSettings(raw);
  const { loadApporteurStore, persistApporteurStoreMutation } = await import("./apporteurStore");
  await loadApporteurStore();
  await persistApporteurStoreMutation((store) => {
    store.kereisMiaSettings = normalized;
    return true;
  });
  return normalized;
}
