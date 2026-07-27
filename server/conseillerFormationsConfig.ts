import type { ApporteurStore } from "./apporteurStore";
import {
  DEFAULT_APPORTEUR_FORMATION_PARCOURS,
  DEFAULT_CONSEILLER_FORMATION_PARCOURS,
  normalizeConseillerFormationParcours,
  type ConseillerFormationParcours,
  type FormationAudience,
} from "../shared/conseillerFormations";

export type { ConseillerFormationParcours, FormationAudience };

type LegacyModule = { title?: string; description?: string; embedUrl?: string };

function migrateFromLegacyModules(raw: unknown): ConseillerFormationParcours | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const withEmbed = (raw as LegacyModule[]).find((m) => String(m.embedUrl || "").startsWith("http"));
  const first = withEmbed || (raw as LegacyModule[])[0];
  if (!first) return null;
  return normalizeConseillerFormationParcours(
    {
      title: first.title || DEFAULT_CONSEILLER_FORMATION_PARCOURS.title,
      description: first.description || DEFAULT_CONSEILLER_FORMATION_PARCOURS.description,
      embedUrl: withEmbed?.embedUrl || first.embedUrl || "",
    },
    DEFAULT_CONSEILLER_FORMATION_PARCOURS,
  );
}

export function getConseillerFormationParcoursFromStore(store: ApporteurStore): ConseillerFormationParcours {
  const extended = store as ApporteurStore & {
    conseillerFormationParcours?: unknown;
    conseillerFormations?: unknown;
  };
  if (extended.conseillerFormationParcours) {
    return normalizeConseillerFormationParcours(
      extended.conseillerFormationParcours,
      DEFAULT_CONSEILLER_FORMATION_PARCOURS,
    );
  }
  const migrated = migrateFromLegacyModules(extended.conseillerFormations);
  if (migrated) return migrated;
  return { ...DEFAULT_CONSEILLER_FORMATION_PARCOURS };
}

export function getApporteurFormationParcoursFromStore(store: ApporteurStore): ConseillerFormationParcours {
  const extended = store as ApporteurStore & { apporteurFormationParcours?: unknown };
  return normalizeConseillerFormationParcours(
    extended.apporteurFormationParcours,
    DEFAULT_APPORTEUR_FORMATION_PARCOURS,
  );
}

export function getFormationParcoursFromStore(
  store: ApporteurStore,
  audience: FormationAudience,
): ConseillerFormationParcours {
  return audience === "apporteur"
    ? getApporteurFormationParcoursFromStore(store)
    : getConseillerFormationParcoursFromStore(store);
}

export async function loadConseillerFormationParcours(): Promise<ConseillerFormationParcours> {
  const { loadApporteurStore } = await import("./apporteurStore");
  const store = await loadApporteurStore();
  return getConseillerFormationParcoursFromStore(store);
}

export async function loadApporteurFormationParcours(): Promise<ConseillerFormationParcours> {
  const { loadApporteurStore } = await import("./apporteurStore");
  const store = await loadApporteurStore();
  return getApporteurFormationParcoursFromStore(store);
}

export async function loadFormationParcoursForAudience(
  audience: FormationAudience,
): Promise<ConseillerFormationParcours> {
  return audience === "apporteur"
    ? loadApporteurFormationParcours()
    : loadConseillerFormationParcours();
}

export async function saveConseillerFormationParcours(
  parcours: ConseillerFormationParcours,
): Promise<ConseillerFormationParcours> {
  const normalized = normalizeConseillerFormationParcours(
    parcours,
    DEFAULT_CONSEILLER_FORMATION_PARCOURS,
  );
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

export async function saveApporteurFormationParcours(
  parcours: ConseillerFormationParcours,
): Promise<ConseillerFormationParcours> {
  const normalized = normalizeConseillerFormationParcours(
    parcours,
    DEFAULT_APPORTEUR_FORMATION_PARCOURS,
  );
  const { loadApporteurStore, persistApporteurStoreMutation } = await import("./apporteurStore");
  await loadApporteurStore();
  await persistApporteurStoreMutation((store) => {
    const extended = store as ApporteurStore & {
      apporteurFormationParcours?: ConseillerFormationParcours;
    };
    extended.apporteurFormationParcours = normalized;
    return true;
  });
  return normalized;
}
