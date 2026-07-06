import type { ApporteurStore } from "./apporteurStore";
import {
  DEFAULT_CONSEILLER_FORMATION_PARCOURS,
  normalizeConseillerFormationParcours,
  type ConseillerFormationParcours,
} from "../shared/conseillerFormations";

export type { ConseillerFormationParcours };

type LegacyModule = { title?: string; description?: string; embedUrl?: string };

function migrateFromLegacyModules(raw: unknown): ConseillerFormationParcours | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const withEmbed = (raw as LegacyModule[]).find((m) => String(m.embedUrl || "").startsWith("http"));
  const first = withEmbed || (raw as LegacyModule[])[0];
  if (!first) return null;
  return normalizeConseillerFormationParcours({
    title: first.title || DEFAULT_CONSEILLER_FORMATION_PARCOURS.title,
    description: first.description || DEFAULT_CONSEILLER_FORMATION_PARCOURS.description,
    embedUrl: withEmbed?.embedUrl || first.embedUrl || "",
  });
}

export function getConseillerFormationParcoursFromStore(store: ApporteurStore): ConseillerFormationParcours {
  const extended = store as ApporteurStore & {
    conseillerFormationParcours?: unknown;
    conseillerFormations?: unknown;
  };
  if (extended.conseillerFormationParcours) {
    return normalizeConseillerFormationParcours(extended.conseillerFormationParcours);
  }
  const migrated = migrateFromLegacyModules(extended.conseillerFormations);
  if (migrated) return migrated;
  return { ...DEFAULT_CONSEILLER_FORMATION_PARCOURS };
}

export async function loadConseillerFormationParcours(): Promise<ConseillerFormationParcours> {
  const { loadApporteurStore } = await import("./apporteurStore");
  const store = await loadApporteurStore();
  return getConseillerFormationParcoursFromStore(store);
}

export async function saveConseillerFormationParcours(
  parcours: ConseillerFormationParcours,
): Promise<ConseillerFormationParcours> {
  const normalized = normalizeConseillerFormationParcours(parcours);
  const { loadApporteurStore, persistApporteurStoreMutation } = await import("./apporteurStore");
  await loadApporteurStore();
  await persistApporteurStoreMutation((store) => {
    const extended = store as ApporteurStore & {
      conseillerFormationParcours?: ConseillerFormationParcours;
      conseillerFormations?: unknown;
    };
    extended.conseillerFormationParcours = normalized;
    delete extended.conseillerFormations;
    return true;
  });
  return normalized;
}
