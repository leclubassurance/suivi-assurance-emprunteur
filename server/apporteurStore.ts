import fs from "fs";
import path from "path";
import { APPORTEUR_META_DOSSIER_ID } from "../shared/apporteurMeta";
import type {
  Apporteur,
  ApporteurType,
  Referral,
  ReferralContact,
  ReferralSource,
  ReferralStatus,
} from "../shared/apporteurTypes";
import { REFERRAL_STATUS_ORDER } from "../shared/apporteurTypes";
import { computeAdminApporteurKpis, computeReferralKpis } from "../shared/apporteurKpis";
import { getRemunerationConfig } from "../shared/apporteurRemuneration";
import type { Dossier } from "./dossierModel";
import { hasStudyBeenSent } from "./dossierLifecycle";
import { clientHasAcceptedInsuranceChange } from "./insuranceAcceptance";
import { generatePortalToken } from "./apporteurNotify";

export type ApporteurStore = {
  version: 1;
  apporteurs: Apporteur[];
  referrals: Referral[];
  updatedAt: string;
};

export type DossierApporteurAttribution = {
  apporteurId: string;
  referralId?: string;
  apporteurLabel?: string;
  referralToken?: string;
};

const STORE_CACHE_MS = 10_000;
let cachedStore: ApporteurStore | null = null;
let cachedAt = 0;

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

function slugifyToken(input: string): string {
  return String(input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
}

function getStoreFilePath(): string {
  if (process.env.VERCEL || process.env.RAILWAY_ENVIRONMENT) {
    return path.join("/tmp", "data", "apporteurs.json");
  }
  return path.join(process.cwd(), "data", "apporteurs.json");
}

function emptyStore(): ApporteurStore {
  return { version: 1, apporteurs: [], referrals: [], updatedAt: new Date().toISOString() };
}

function normalizeStore(raw: unknown): ApporteurStore {
  const data = raw as ApporteurStore | null;
  return {
    version: 1,
    apporteurs: Array.isArray(data?.apporteurs) ? data.apporteurs : [],
    referrals: Array.isArray(data?.referrals) ? data.referrals : [],
    updatedAt: data?.updatedAt || new Date().toISOString(),
  };
}

function loadStoreFromFile(): ApporteurStore {
  try {
    const p = getStoreFilePath();
    if (!fs.existsSync(p)) return emptyStore();
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    return normalizeStore(raw);
  } catch {
    return emptyStore();
  }
}

function saveStoreToFile(store: ApporteurStore) {
  const p = getStoreFilePath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  store.updatedAt = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(store, null, 2), "utf-8");
}

async function loadLegacyStoreFromMetaDossier(): Promise<ApporteurStore | null> {
  try {
    const { readDB } = await import("./db");
    const db = await readDB();
    const meta = db.dossiers.find((d: any) => d.id === APPORTEUR_META_DOSSIER_ID);
    const fromMeta = meta?.apporteurStore as ApporteurStore | undefined;
    if (fromMeta?.apporteurs && Array.isArray(fromMeta.apporteurs)) return normalizeStore(fromMeta);
  } catch {
    /* ignore */
  }
  return null;
}

async function loadStoreFromFirestore(): Promise<ApporteurStore | null> {
  try {
    const { readApporteurStoreFromFirestore } = await import("./firebaseSync");
    const fromDedicated = await readApporteurStoreFromFirestore();
    if (fromDedicated && Array.isArray(fromDedicated.apporteurs)) return normalizeStore(fromDedicated);

    const legacy = await loadLegacyStoreFromMetaDossier();
    if (legacy) {
      await saveStoreToFirestore(legacy);
      return legacy;
    }
  } catch {
    /* fallback file */
  }
  return null;
}

async function saveStoreToFirestore(store: ApporteurStore) {
  try {
    const { writeApporteurStoreToFirestore } = await import("./firebaseSync");
    store.updatedAt = new Date().toISOString();
    await writeApporteurStoreToFirestore(store);
  } catch (e: any) {
    console.warn("[Apporteurs] Firestore store save:", e?.message || e);
  }
}

function invalidateCache() {
  cachedStore = null;
  cachedAt = 0;
}

async function ensureApporteurFields(store: ApporteurStore): Promise<void> {
  let changed = false;
  for (const apporteur of store.apporteurs) {
    if (!apporteur.portalToken) {
      apporteur.portalToken = generatePortalToken();
      changed = true;
    }
    if (apporteur.notifyEmailEnabled === undefined) {
      apporteur.notifyEmailEnabled = true;
      changed = true;
    }
  }
  if (changed) await persistStore(store);
}

async function notifyAfterReferralChange(
  store: ApporteurStore,
  referral: Referral,
  previousStatus?: ReferralStatus,
): Promise<void> {
  const apporteur = store.apporteurs.find((a) => a.id === referral.apporteurId);
  if (!apporteur) return;
  try {
    const { notifyApporteurReferralStatusChange } = await import("./apporteurNotify");
    const sent = await notifyApporteurReferralStatusChange({ apporteur, referral, previousStatus });
    if (sent) await persistStore(store);
  } catch (err: any) {
    console.warn("[Apporteurs] Notification email:", err?.message || err);
  }
}

export async function loadApporteurStore(): Promise<ApporteurStore> {
  if (cachedStore && Date.now() - cachedAt < STORE_CACHE_MS) return cachedStore;
  const fromFirestore = await loadStoreFromFirestore();
  const store = fromFirestore || loadStoreFromFile();
  await ensureApporteurFields(store);
  cachedStore = store;
  cachedAt = Date.now();
  return store;
}

async function persistStore(store: ApporteurStore) {
  saveStoreToFile(store);
  await saveStoreToFirestore(store);
  cachedStore = store;
  cachedAt = Date.now();
}

function uniqueReferralToken(store: ApporteurStore, base: string): string {
  const root = slugifyToken(base) || "partenaire";
  let token = root;
  let n = 2;
  while (store.apporteurs.some((a) => a.referralToken === token)) {
    token = `${root}-${n}`;
    n += 1;
  }
  return token;
}

function pushReferralEvent(referral: Referral, status: ReferralStatus, message?: string, actor?: string) {
  referral.events = referral.events || [];
  referral.events.push({
    at: new Date().toISOString(),
    status,
    message,
    actor,
  });
  referral.events = referral.events.slice(-30);
}

export async function listApporteurs(): Promise<Apporteur[]> {
  const store = await loadApporteurStore();
  return [...store.apporteurs].sort((a, b) => a.companyName.localeCompare(b.companyName, "fr"));
}

export async function listReferrals(filters?: { apporteurId?: string }): Promise<Referral[]> {
  const store = await loadApporteurStore();
  let items = [...store.referrals];
  if (filters?.apporteurId) {
    items = items.filter((r) => r.apporteurId === filters.apporteurId);
  }
  return items.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export async function findApporteurById(id: string): Promise<Apporteur | null> {
  const store = await loadApporteurStore();
  return store.apporteurs.find((a) => a.id === id) || null;
}

export async function findApporteurByToken(token: string): Promise<Apporteur | null> {
  const t = slugifyToken(token);
  if (!t) return null;
  const store = await loadApporteurStore();
  return store.apporteurs.find((a) => a.active && a.referralToken === t) || null;
}

export async function findApporteurByPortalToken(token: string): Promise<Apporteur | null> {
  const t = String(token || "").trim();
  if (!t || t.length < 16) return null;
  const store = await loadApporteurStore();
  return store.apporteurs.find((a) => a.active && a.portalToken === t) || null;
}

export async function findReferralById(id: string): Promise<Referral | null> {
  const store = await loadApporteurStore();
  return store.referrals.find((r) => r.id === id) || null;
}

export async function createApporteur(input: {
  companyName: string;
  contactName: string;
  email: string;
  phone?: string;
  type?: ApporteurType;
  notes?: string;
  referralToken?: string;
}): Promise<Apporteur> {
  const store = await loadApporteurStore();
  const now = new Date().toISOString();
  const companyName = String(input.companyName || "").trim();
  const contactName = String(input.contactName || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  if (!companyName || !contactName || !email.includes("@")) {
    throw new Error("Nom société, contact et email valides requis.");
  }
  const tokenBase = input.referralToken ? slugifyToken(input.referralToken) : slugifyToken(companyName);
  const apporteur: Apporteur = {
    id: newId("AP"),
    createdAt: now,
    updatedAt: now,
    active: true,
    companyName,
    contactName,
    email,
    phone: String(input.phone || "").trim() || undefined,
    type: input.type || "autre",
    referralToken: uniqueReferralToken(store, tokenBase),
    portalToken: generatePortalToken(),
    notifyEmailEnabled: true,
    notes: String(input.notes || "").trim() || undefined,
  };
  store.apporteurs.push(apporteur);
  await persistStore(store);
  return apporteur;
}

export async function updateApporteur(
  id: string,
  patch: Partial<
    Pick<
      Apporteur,
      | "companyName"
      | "contactName"
      | "email"
      | "phone"
      | "type"
      | "notes"
      | "active"
      | "notifyEmailEnabled"
      | "contractStatus"
      | "contractSignedAt"
    >
  >,
): Promise<Apporteur> {
  const store = await loadApporteurStore();
  const apporteur = store.apporteurs.find((a) => a.id === id);
  if (!apporteur) throw new Error("Apporteur introuvable.");
  if (patch.companyName != null) apporteur.companyName = String(patch.companyName).trim();
  if (patch.contactName != null) apporteur.contactName = String(patch.contactName).trim();
  if (patch.email != null) apporteur.email = String(patch.email).trim().toLowerCase();
  if (patch.phone != null) apporteur.phone = String(patch.phone).trim() || undefined;
  if (patch.type != null) apporteur.type = patch.type;
  if (patch.notes != null) apporteur.notes = String(patch.notes).trim() || undefined;
  if (patch.active != null) apporteur.active = Boolean(patch.active);
  if (patch.notifyEmailEnabled != null) apporteur.notifyEmailEnabled = Boolean(patch.notifyEmailEnabled);
  if (patch.contractStatus != null) {
    apporteur.contractStatus = patch.contractStatus;
    if (patch.contractStatus === "signed" && !apporteur.contractSignedAt) {
      apporteur.contractSignedAt = new Date().toISOString();
    }
  }
  if ((patch as any).contractSignedAt != null) {
    apporteur.contractSignedAt = (patch as any).contractSignedAt || undefined;
  }
  apporteur.updatedAt = new Date().toISOString();
  await persistStore(store);
  return apporteur;
}

export async function createReferral(input: {
  apporteurId: string;
  contact: ReferralContact;
  source?: ReferralSource;
  status?: ReferralStatus;
  dossierId?: string;
  actor?: string;
}): Promise<Referral> {
  const store = await loadApporteurStore();
  const apporteur = store.apporteurs.find((a) => a.id === input.apporteurId);
  if (!apporteur) throw new Error("Apporteur introuvable.");
  const now = new Date().toISOString();
  const status = input.status || "NOUVEAU";
  const referral: Referral = {
    id: newId("REF"),
    apporteurId: apporteur.id,
    createdAt: now,
    updatedAt: now,
    status,
    source: input.source || "admin",
    contact: {
      prenom: String(input.contact.prenom || "").trim() || undefined,
      nom: String(input.contact.nom || "").trim() || undefined,
      email: String(input.contact.email || "").trim().toLowerCase() || undefined,
      phone: String(input.contact.phone || "").trim() || undefined,
      notes: String(input.contact.notes || "").trim() || undefined,
    },
    dossierId: input.dossierId ? String(input.dossierId).trim() : undefined,
    events: [],
  };
  pushReferralEvent(
    referral,
    status,
    input.dossierId ? `Dossier lié : ${input.dossierId}` : "Recommandation créée",
    input.actor || "admin",
  );
  store.referrals.push(referral);
  await persistStore(store);
  await notifyAfterReferralChange(store, referral);

  const clientEmail = referral.contact.email;
  if (clientEmail && input.source === "apporteur_portal") {
    try {
      const { notifyReferredClientNewReferral } = await import("./apporteurNotify");
      const sent = await notifyReferredClientNewReferral({ apporteur, referral });
      if (sent) await persistStore(store);
    } catch (err: any) {
      console.warn("[Apporteurs] Email client recommandé:", err?.message || err);
    }
  }

  return referral;
}

export async function updateReferral(
  id: string,
  patch: {
    status?: ReferralStatus;
    contact?: Partial<ReferralContact>;
    dossierId?: string | null;
    actor?: string;
    note?: string;
  },
): Promise<Referral> {
  const store = await loadApporteurStore();
  const referral = store.referrals.find((r) => r.id === id);
  if (!referral) throw new Error("Recommandation introuvable.");
  const previousStatus = referral.status;
  if (patch.contact) {
    referral.contact = { ...referral.contact, ...patch.contact };
  }
  if (patch.dossierId !== undefined) {
    referral.dossierId = patch.dossierId ? String(patch.dossierId) : undefined;
  }
  if (patch.status && patch.status !== referral.status) {
    referral.status = patch.status;
    pushReferralEvent(referral, patch.status, patch.note, patch.actor || "admin");
  } else if (patch.note) {
    pushReferralEvent(referral, referral.status, patch.note, patch.actor || "admin");
  }
  referral.updatedAt = new Date().toISOString();
  await persistStore(store);
  if (patch.status && patch.status !== previousStatus) {
    await notifyAfterReferralChange(store, referral, previousStatus);
  }
  return referral;
}

export async function linkReferralToDossier(
  referralId: string,
  dossierId: string,
  actor = "admin",
): Promise<Referral> {
  return updateReferral(referralId, {
    dossierId,
    status: "DOSSIER_OUVERT",
    actor,
    note: `Rattaché au dossier ${dossierId}`,
  });
}

function inferReferralStatusFromDossier(dossier: Dossier): ReferralStatus | null {
  const status = String(dossier.status || "").toUpperCase();
  if (status === "REFUSÉ" || status === "REFUSE") return "REFUSE";
  if (status === "CLOS" && !clientHasAcceptedInsuranceChange(dossier)) return "PERDU";
  if (clientHasAcceptedInsuranceChange(dossier)) return "SIGNE";
  if (hasStudyBeenSent(dossier) || status === "MAIL_ENVOYÉ" || status === "MAIL_ENVOYE") {
    return "ETUDE_ENVOYEE";
  }
  if (dossier.id && !String(dossier.id).startsWith("LCIF-999")) return "DOSSIER_OUVERT";
  return null;
}

function statusRank(s: ReferralStatus): number {
  return REFERRAL_STATUS_ORDER.indexOf(s);
}

export async function syncReferralFromDossier(dossier: Dossier, actor = "system"): Promise<void> {
  const attr = (dossier as any).apporteur as DossierApporteurAttribution | undefined;
  if (!attr?.referralId && !attr?.apporteurId) return;

  const store = await loadApporteurStore();
  let referral =
    (attr.referralId && store.referrals.find((r) => r.id === attr.referralId)) ||
    store.referrals.find((r) => r.dossierId === dossier.id) ||
    null;

  const inferred = inferReferralStatusFromDossier(dossier);
  if (!referral && attr.apporteurId && inferred) {
    const assure = dossier.formData?.assures?.[0] || {};
    referral = {
      id: newId("REF"),
      apporteurId: attr.apporteurId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: inferred,
      source: "form_ref",
      contact: {
        prenom: assure.prenom,
        nom: assure.nom,
        email: assure.email,
        phone: assure.telephone,
      },
      dossierId: dossier.id,
      events: [],
    };
    pushReferralEvent(referral, inferred, `Créé depuis dossier ${dossier.id}`, actor);
    store.referrals.push(referral);
    attr.referralId = referral.id;
    await persistStore(store);
    await notifyAfterReferralChange(store, referral);
    return;
  }

  if (!referral) return;

  if (!referral.dossierId) referral.dossierId = dossier.id;
  if (!attr.referralId) attr.referralId = referral.id;

  if (inferred && statusRank(inferred) > statusRank(referral.status)) {
    const previousStatus = referral.status;
    referral.status = inferred;
    pushReferralEvent(referral, inferred, `Sync dossier ${dossier.id}`, actor);
    referral.updatedAt = new Date().toISOString();
    await persistStore(store);
    await notifyAfterReferralChange(store, referral, previousStatus);
  }
}

export async function attachApporteurToNewDossier(
  dossier: Dossier,
  refToken?: string,
): Promise<void> {
  const token = slugifyToken(refToken || "");
  if (!token) return;

  const apporteur = await findApporteurByToken(token);
  if (!apporteur) return;

  const assure = dossier.formData?.assures?.[0] || {};
  const email = String(assure.email || "").trim().toLowerCase();
  const store = await loadApporteurStore();

  let referral = store.referrals.find(
    (r) =>
      r.apporteurId === apporteur.id &&
      r.dossierId === dossier.id,
  );

  if (!referral && email) {
    referral = store.referrals.find(
      (r) =>
        r.apporteurId === apporteur.id &&
        !r.dossierId &&
        String(r.contact.email || "").toLowerCase() === email &&
        !["SIGNE", "REFUSE", "PERDU"].includes(r.status),
    );
  }

  if (!referral) {
    referral = await createReferral({
      apporteurId: apporteur.id,
      contact: {
        prenom: assure.prenom,
        nom: assure.nom,
        email: assure.email,
        phone: assure.telephone,
      },
      source: "form_ref",
      status: "DOSSIER_OUVERT",
      dossierId: dossier.id,
      actor: "formulaire",
    });
  } else {
    await updateReferral(referral.id, {
      dossierId: dossier.id,
      status: "DOSSIER_OUVERT",
      actor: "formulaire",
      note: `Formulaire client — dossier ${dossier.id}`,
    });
    referral = (await findReferralById(referral.id))!;
  }

  (dossier as any).apporteur = {
    apporteurId: apporteur.id,
    referralId: referral.id,
    apporteurLabel: apporteur.companyName,
    referralToken: apporteur.referralToken,
  } satisfies DossierApporteurAttribution;
}

export function buildApporteurReferralUrl(baseUrl: string, token: string): string {
  const base = String(baseUrl || "").replace(/\/$/, "");
  const t = slugifyToken(token);
  return `${base}/?ref=${encodeURIComponent(t)}`;
}

export async function getApporteurSummary() {
  const store = await loadApporteurStore();
  const kpis = computeAdminApporteurKpis(store.apporteurs, store.referrals);
  return {
    ...kpis,
    referrals: store.referrals.length,
    openReferrals: kpis.open,
    updatedAt: store.updatedAt,
  };
}

export function getApporteurKpisForReferrals(referrals: Referral[]) {
  return computeReferralKpis(referrals);
}

export function getRemunerationForApporteur(apporteur: Apporteur) {
  return getRemunerationConfig(apporteur.type);
}

/** Retire les recommandations liées à un dossier supprimé. */
export async function syncReferralsAfterDossierDeleted(dossierId: string): Promise<number> {
  const store = await loadApporteurStore();
  const before = store.referrals.length;
  store.referrals = store.referrals.filter((r) => r.dossierId !== dossierId);
  if (store.referrals.length < before) {
    await persistStore(store);
    return before - store.referrals.length;
  }
  return 0;
}

/** Nettoie les recommandations dont le dossier LCIF n'existe plus. */
export async function pruneReferralsWithMissingDossiers(): Promise<number> {
  const store = await loadApporteurStore();
  const { readDB } = await import("./db");
  const db = await readDB();
  const ids = new Set(db.dossiers.map((d) => d.id));
  const before = store.referrals.length;
  store.referrals = store.referrals.filter((r) => !r.dossierId || ids.has(r.dossierId));
  if (store.referrals.length < before) {
    await persistStore(store);
    return before - store.referrals.length;
  }
  return 0;
}
