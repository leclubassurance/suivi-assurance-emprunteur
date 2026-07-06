import type { ApporteurStore } from "./apporteurStore";
import {
  DEFAULT_CONSEILLER_FORMATIONS,
  normalizeConseillerFormationModule,
  sortConseillerFormations,
  type ConseillerFormationModule,
} from "../shared/conseillerFormations";

export type { ConseillerFormationModule };

export function getConseillerFormationsFromStore(store: ApporteurStore): ConseillerFormationModule[] {
  const raw = (store as ApporteurStore & { conseillerFormations?: unknown }).conseillerFormations;
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_CONSEILLER_FORMATIONS.map((m) => ({ ...m }));
  }
  const modules = raw
    .map((item, index) => normalizeConseillerFormationModule(item, index))
    .filter((m): m is ConseillerFormationModule => Boolean(m));
  return sortConseillerFormations(modules);
}

export async function loadConseillerFormations(): Promise<ConseillerFormationModule[]> {
  const { loadApporteurStore } = await import("./apporteurStore");
  const store = await loadApporteurStore();
  return getConseillerFormationsFromStore(store);
}

export async function saveConseillerFormations(
  modules: ConseillerFormationModule[],
): Promise<ConseillerFormationModule[]> {
  const normalized = sortConseillerFormations(
    modules
      .map((item, index) => normalizeConseillerFormationModule(item, index))
      .filter((m): m is ConseillerFormationModule => Boolean(m))
      .map((m, index) => ({ ...m, order: index + 1 })),
  );
  const { loadApporteurStore, persistApporteurStoreMutation } = await import("./apporteurStore");
  await loadApporteurStore();
  await persistApporteurStoreMutation((store) => {
    (store as ApporteurStore & { conseillerFormations?: ConseillerFormationModule[] }).conseillerFormations =
      normalized;
    return true;
  });
  return normalized;
}

export function newConseillerFormationId(): string {
  return `formation-${Date.now().toString(36)}`;
}
