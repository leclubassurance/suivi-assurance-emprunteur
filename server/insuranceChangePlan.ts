import { addEvent, type Dossier } from "./dossierModel";

export type InsuranceChangePlanSource = "study_email" | "manual";

export type InsuranceChangePlan = {
  /** Date ISO YYYY-MM-DD */
  plannedDate: string;
  source: InsuranceChangePlanSource;
  updatedAt: string;
  updatedBy?: string;
};

const FRENCH_MONTHS: Record<string, number> = {
  janvier: 1,
  fevrier: 2,
  février: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  août: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
  décembre: 12,
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toIsoDate(y: number, m: number, d: number): string | null {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2020 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function normalizeBlob(htmlOrText: string): string {
  return String(htmlOrText || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumericDate(day: string, month: string, year: string): string | null {
  return toIsoDate(Number(year), Number(month), Number(day));
}

function parseFrenchLongDate(match: RegExpMatchArray): string | null {
  const day = Number(match[1]);
  const monthRaw = String(match[2] || "").toLowerCase();
  const month = FRENCH_MONTHS[monthRaw];
  const year = Number(match[3]);
  return month ? toIsoDate(year, month, day) : null;
}

/** Extrait une date de changement d'assurance depuis le corps du mail d'étude. */
export function extractPlannedChangeDateFromStudyContent(htmlOrText: string): string | null {
  const blob = normalizeBlob(htmlOrText);
  if (!blob) return null;

  const changeContext =
    /changement|substitution|prise\s+d['']effet|effectif|activation|mise\s+en\s+place/i.test(blob);

  const patterns: RegExp[] = [
    /date\s+(?:de\s+)?changement\s+pr[ée]vu[e]?\s*(?:le|:)?\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/i,
    /changement\s+pr[ée]vu[e]?\s*(?:le|pour|à partir du|:)\s*(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+(\d{4})/i,
    /(?:effectif|à partir)\s+(?:le|du)\s*(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+(\d{4})/i,
    /(?:effectif|à partir)\s+(?:le|du)\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/i,
    /date\s+pr[ée]vue\s+(?:du\s+)?changement\s*(?:le|:)?\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/i,
    /(\d{4})-(\d{2})-(\d{2})/,
  ];

  for (const re of patterns) {
    const m = blob.match(re);
    if (!m) continue;
    let iso: string | null = null;
    if (re.source.startsWith("(\\d{4})")) {
      iso = toIsoDate(Number(m[1]), Number(m[2]), Number(m[3]));
    } else if (m[2] && Number.isNaN(Number(m[2]))) {
      iso = parseFrenchLongDate(m);
    } else {
      iso = parseNumericDate(m[1], m[2], m[3]);
    }
    if (iso) {
      if (!changeContext && !/date\s+(?:de\s+)?changement|changement\s+pr[ée]vu/i.test(m[0])) {
        continue;
      }
      return iso;
    }
  }

  if (changeContext) {
    const loose = blob.match(
      /(?:changement|substitution)[\s\S]{0,100}?(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/i,
    );
    if (loose) return parseNumericDate(loose[1], loose[2], loose[3]);
  }

  return null;
}

export function formatInsuranceChangePlanLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export function getInsuranceChangePlan(dossier: Dossier): InsuranceChangePlan | null {
  const p = (dossier as any).insuranceChangePlan;
  if (!p?.plannedDate) return null;
  const plannedDate = String(p.plannedDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plannedDate)) return null;
  return {
    plannedDate,
    source: p.source === "manual" ? "manual" : "study_email",
    updatedAt: String(p.updatedAt || ""),
    updatedBy: p.updatedBy ? String(p.updatedBy) : undefined,
  };
}

export function tryApplyInsuranceChangePlanFromStudyContent(
  dossier: Dossier,
  htmlOrText: string,
): boolean {
  const existing = getInsuranceChangePlan(dossier);
  if (existing?.source === "manual") return false;

  const iso = extractPlannedChangeDateFromStudyContent(htmlOrText);
  if (!iso) return false;
  if (existing?.plannedDate === iso && existing.source === "study_email") return false;

  (dossier as any).insuranceChangePlan = {
    plannedDate: iso,
    source: "study_email",
    updatedAt: new Date().toISOString(),
  } satisfies InsuranceChangePlan;

  addEvent(dossier, {
    type: "NOTE_ADDED",
    actor: { kind: "SYSTEM" },
    message: `Date de changement prévue extraite du mail d'étude : ${formatInsuranceChangePlanLabel(iso)}.`,
    meta: { template: "INSURANCE_CHANGE_PLAN_EXTRACTED", plannedDate: iso },
  });
  return true;
}

export function patchInsuranceChangePlan(
  dossier: Dossier,
  plannedDate: string | null | undefined,
  updatedBy?: string,
): InsuranceChangePlan | null {
  const raw = String(plannedDate || "").trim();
  if (!raw) {
    delete (dossier as any).insuranceChangePlan;
    addEvent(dossier, {
      type: "NOTE_ADDED",
      actor: { kind: "ADMIN", label: updatedBy || "admin" },
      message: "Date de changement prévue retirée.",
    });
    return null;
  }

  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : extractPlannedChangeDateFromStudyContent(raw) || raw;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new Error("Date invalide — utilisez le format AAAA-MM-JJ.");
  }

  const plan: InsuranceChangePlan = {
    plannedDate: iso,
    source: "manual",
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  (dossier as any).insuranceChangePlan = plan;

  addEvent(dossier, {
    type: "NOTE_ADDED",
    actor: { kind: "ADMIN", label: updatedBy || "admin" },
    message: `Date de changement prévue enregistrée : ${formatInsuranceChangePlanLabel(iso)}.`,
    meta: { template: "INSURANCE_CHANGE_PLAN_MANUAL", plannedDate: iso },
  });
  return plan;
}
