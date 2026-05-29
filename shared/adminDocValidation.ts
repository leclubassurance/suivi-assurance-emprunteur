import type { ChecklistDocStatus, ChecklistItem } from "./documentChecklist";

export type AdminChecklistOverride = {
  status: ChecklistDocStatus;
  validatedAt: string;
  validatedBy?: string;
  note?: string;
};

export function getAdminChecklistOverrides(
  dossier: { adminChecklistOverrides?: Record<string, AdminChecklistOverride> } | null | undefined,
): Record<string, AdminChecklistOverride> {
  const raw = dossier?.adminChecklistOverrides;
  if (!raw || typeof raw !== "object") return {};
  return raw;
}

export function applyAdminChecklistOverrides(
  items: ChecklistItem[],
  overrides: Record<string, AdminChecklistOverride>,
): ChecklistItem[] {
  if (!Object.keys(overrides).length) return items;

  return items.map((item) => {
    const o = overrides[item.key];
    if (!o) return item;

    if (o.status === "ok") {
      return {
        ...item,
        ok: true,
        status: "ok",
        reviewHint: o.note || `Validé manuellement par l'équipe (${o.validatedAt.slice(0, 10)})`,
      };
    }
    if (o.status === "review") {
      return {
        ...item,
        ok: item.ok,
        status: "review",
        reviewHint: o.note || item.reviewHint,
      };
    }
    if (o.status === "missing") {
      return {
        ...item,
        ok: false,
        status: "missing",
        reviewHint: o.note,
        matchedFiles: [],
      };
    }
    return item;
  });
}
