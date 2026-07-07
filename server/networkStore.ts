import fs from "fs";
import path from "path";
import type {
  NetworkMember,
  NetworkReferral,
  ReferralContact,
  ReferralSource,
  ReferralStatus,
} from "../shared/networkTypes";
import { REFERRAL_STATUS_ORDER } from "../shared/networkTypes";
import { computeAdminNetworkKpis } from "../shared/networkKpis";
import { computeReferralKpis } from "../shared/apporteurKpis";
import { getNetworkRemunerationConfig } from "../shared/networkRemuneration";
import type { Dossier } from "./dossierModel";
import { hasStudyBeenSent } from "./dossierLifecycle";
import { clientHasAcceptedInsuranceChange } from "./insuranceAcceptance";
import { generatePortalToken } from "./apporteurNotify";

export type NetworkStore = {
  version: 1;
  members: NetworkMember[];
  referrals: NetworkReferral[];
  updatedAt: string;
};

export type DossierNetworkAttribution = {
  memberId: string;
  referralId?: string;
  memberLabel?: string;
  referralToken?: string;
  sponsorId?: string;
};

const STORE_CACHE_MS = 10_000;
let cachedStore: NetworkStore | null = null;
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
    return path.join("/tmp", "data", "network.json");
  }
  return path.join(process.cwd(), "data", "network.json");
}

function emptyStore(): NetworkStore {
  return { version: 1, members: [], referrals: [], updatedAt: new Date().toISOString() };
}

function normalizeStore(raw: unknown): NetworkStore {
  const data = raw as NetworkStore | null;
  return {
    version: 1,
    members: Array.isArray(data?.members) ? data.members : [],
    referrals: Array.isArray(data?.referrals) ? data.referrals : [],
    updatedAt: data?.updatedAt || new Date().toISOString(),
  };
}

function loadStoreFromFile(): NetworkStore {
  try {
    const p = getStoreFilePath();
    if (!fs.existsSync(p)) return emptyStore();
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    return normalizeStore(raw);
  } catch {
    return emptyStore();
  }
}

async function loadStoreFromFirestore(): Promise<NetworkStore | null> {
  try {
    const { readNetworkStoreFromFirestore } = await import("./firebaseSync");
    const fromDedicated = await readNetworkStoreFromFirestore();
    if (fromDedicated && Array.isArray(fromDedicated.members)) return normalizeStore(fromDedicated);
  } catch {
    /* fallback file */
  }
  return null;
}

async function saveStoreToFirestore(store: NetworkStore) {
  const { writeNetworkStoreToFirestore, isFirebaseConfigured } = await import("./firebaseSync");
  if (!isFirebaseConfigured()) return;
  store.updatedAt = new Date().toISOString();
  await writeNetworkStoreToFirestore(store);
}

function invalidateCache() {
  cachedStore = null;
  cachedAt = 0;
}

async function ensureMemberFields(store: NetworkStore): Promise<void> {
  let changed = false;
  for (const member of store.members) {
    if (!member.portalToken) {
      member.portalToken = generatePortalToken();
      changed = true;
    }
    if (!member.joinToken) {
      member.joinToken = pickJoinToken(store, member.contactName, member.referralToken);
      changed = true;
    }
    if (member.notifyEmailEnabled === undefined) {
      member.notifyEmailEnabled = true;
      changed = true;
    }
  }
  if (changed) await persistStore(store);
}

export async function loadNetworkStore(): Promise<NetworkStore> {
  if (cachedStore && Date.now() - cachedAt < STORE_CACHE_MS) return cachedStore;
  const fromFirestore = await loadStoreFromFirestore();
  const store = fromFirestore || loadStoreFromFile();
  await ensureMemberFields(store);
  cachedStore = store;
  cachedAt = Date.now();
  return store;
}

async function persistStore(store: NetworkStore) {
  saveStoreToFile(store);
  try {
    await saveStoreToFirestore(store);
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error("[Réseau] Échec sauvegarde Firestore network_store:", msg);
    if (process.env.RAILWAY_ENVIRONMENT || process.env.FIREBASE_REQUIRED === "true") {
      throw new Error(
        `Impossible de persister le réseau dans Firestore (collection network_store). ${msg}`,
      );
    }
  }
  cachedStore = store;
  cachedAt = Date.now();
}

function saveStoreToFile(store: NetworkStore) {
  const p = getStoreFilePath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  store.updatedAt = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(store, null, 2), "utf-8");
}

async function isReferralTokenTakenGlobally(token: string, excludeMemberId?: string): Promise<boolean> {
  const store = await loadNetworkStore();
  if (store.members.some((m) => m.id !== excludeMemberId && m.referralToken === token)) return true;
  try {
    const { loadApporteurStore } = await import("./apporteurStore");
    const apStore = await loadApporteurStore();
    if (apStore.apporteurs.some((a) => a.referralToken === token)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

function buildReferralTokenCandidates(contactName: string): string[] {
  const contact = slugifyToken(contactName);
  return [...new Set([contact].filter(Boolean))];
}

async function pickReferralToken(store: NetworkStore, candidates: string[]): Promise<string> {
  for (const base of candidates) {
    const root = slugifyToken(base) || base;
    if (root && !(await isReferralTokenTakenGlobally(root))) return root;
  }
  const base = slugifyToken(candidates[0] || "membre") || "membre";
  let token = base;
  let n = 2;
  while (await isReferralTokenTakenGlobally(token)) {
    token = `${base}-${n}`;
    n += 1;
  }
  return token;
}

function pickJoinToken(store: NetworkStore, contactName: string, referralToken: string): string {
  const candidates = [
    `equipe-${referralToken}`,
    slugifyToken(`recrute-${contactName}`),
    `recrute-${referralToken}`,
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (!store.members.some((m) => m.joinToken === c)) return c;
  }
  let token = `${referralToken}-equipe`;
  let n = 2;
  while (store.members.some((m) => m.joinToken === token)) {
    token = `${referralToken}-equipe-${n}`;
    n += 1;
  }
  return token;
}

function pushReferralEvent(
  referral: NetworkReferral,
  status: ReferralStatus,
  message?: string,
  actor?: string,
) {
  referral.events = referral.events || [];
  referral.events.push({
    at: new Date().toISOString(),
    status,
    message,
    actor,
  });
  referral.events = referral.events.slice(-30);
}

export async function listNetworkMembers(): Promise<NetworkMember[]> {
  const store = await loadNetworkStore();
  return [...store.members].sort((a, b) => a.contactName.localeCompare(b.contactName, "fr"));
}

export async function listNetworkReferrals(filters?: { memberId?: string }): Promise<NetworkReferral[]> {
  const store = await loadNetworkStore();
  let items = [...store.referrals];
  if (filters?.memberId) {
    items = items.filter((r) => r.memberId === filters.memberId);
  }
  return items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function findNetworkMemberById(id: string): Promise<NetworkMember | null> {
  const store = await loadNetworkStore();
  return store.members.find((m) => m.id === id) || null;
}

export async function findNetworkMemberByToken(token: string): Promise<NetworkMember | null> {
  const t = slugifyToken(token);
  if (!t) return null;
  const store = await loadNetworkStore();
  return store.members.find((m) => m.active && m.referralToken === t) || null;
}

export async function findNetworkMemberByPortalToken(token: string): Promise<NetworkMember | null> {
  const t = String(token || "").trim();
  if (!t || t.length < 16) return null;
  const store = await loadNetworkStore();
  return store.members.find((m) => m.active && m.portalToken === t) || null;
}

export async function findNetworkMemberByJoinToken(token: string): Promise<NetworkMember | null> {
  const t = slugifyToken(token) || String(token || "").trim().toLowerCase();
  if (!t) return null;
  const store = await loadNetworkStore();
  return store.members.find((m) => m.active && m.joinToken === t) || null;
}

export async function findNetworkReferralById(id: string): Promise<NetworkReferral | null> {
  const store = await loadNetworkStore();
  return store.referrals.find((r) => r.id === id) || null;
}

export function listDirectDownline(store: NetworkStore, sponsorId: string): NetworkMember[] {
  return store.members.filter((m) => m.sponsorId === sponsorId && m.active);
}

export async function createNetworkMember(input: {
  contactName: string;
  email: string;
  phone?: string;
  sponsorId?: string;
  notes?: string;
  referralToken?: string;
  contractStatus?: NetworkMember["contractStatus"];
}): Promise<NetworkMember> {
  const store = await loadNetworkStore();
  const now = new Date().toISOString();
  const contactName = String(input.contactName || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  if (!contactName || !email.includes("@")) {
    throw new Error("Nom et email valides requis.");
  }
  if (input.sponsorId) {
    const sponsor = store.members.find((m) => m.id === input.sponsorId);
    if (!sponsor) throw new Error("Parrain introuvable.");
  }
  const tokenCandidates = input.referralToken?.trim()
    ? [slugifyToken(input.referralToken)]
    : buildReferralTokenCandidates(contactName);
  const referralToken = await pickReferralToken(store, tokenCandidates.filter(Boolean));
  const member: NetworkMember = {
    id: newId("NM"),
    createdAt: now,
    updatedAt: now,
    active: true,
    contactName,
    email,
    phone: String(input.phone || "").trim() || undefined,
    sponsorId: input.sponsorId || undefined,
    referralToken,
    joinToken: pickJoinToken(store, contactName, referralToken),
    portalToken: generatePortalToken(),
    notifyEmailEnabled: true,
    notes: String(input.notes || "").trim() || undefined,
    contractStatus: input.contractStatus || "none",
  };
  store.members.push(member);
  await persistStore(store);
  return member;
}

export async function enrollNetworkMemberViaJoin(input: {
  joinToken: string;
  contactName: string;
  email: string;
  phone?: string;
}): Promise<NetworkMember> {
  const sponsor = await findNetworkMemberByJoinToken(input.joinToken);
  if (!sponsor) throw new Error("Lien de recrutement invalide ou expiré.");
  const email = String(input.email || "").trim().toLowerCase();
  const store = await loadNetworkStore();
  if (store.members.some((m) => m.email === email)) {
    throw new Error("Un membre avec cet email existe déjà.");
  }
  return createNetworkMember({
    contactName: input.contactName,
    email: input.email,
    phone: input.phone,
    sponsorId: sponsor.id,
    contractStatus: "pending",
  });
}

export async function updateNetworkMember(
  id: string,
  patch: Partial<
    Pick<
      NetworkMember,
      | "contactName"
      | "email"
      | "phone"
      | "notes"
      | "active"
      | "notifyEmailEnabled"
      | "contractStatus"
      | "contractSignedAt"
      | "referralToken"
      | "sponsorId"
    >
  >,
): Promise<NetworkMember> {
  const store = await loadNetworkStore();
  const member = store.members.find((m) => m.id === id);
  if (!member) throw new Error("Membre introuvable.");
  if (patch.referralToken != null) {
    const next = slugifyToken(String(patch.referralToken));
    if (!next) throw new Error("Lien ?ref= invalide.");
    if (await isReferralTokenTakenGlobally(next, id)) {
      throw new Error("Ce lien ?ref= est déjà utilisé.");
    }
    member.referralToken = next;
  }
  if (patch.sponsorId !== undefined) {
    if (patch.sponsorId === id) throw new Error("Un membre ne peut pas être son propre parrain.");
    if (patch.sponsorId) {
      const sponsor = store.members.find((m) => m.id === patch.sponsorId);
      if (!sponsor) throw new Error("Parrain introuvable.");
    }
    member.sponsorId = patch.sponsorId || undefined;
  }
  if (patch.contactName != null) member.contactName = String(patch.contactName).trim();
  if (patch.email != null) member.email = String(patch.email).trim().toLowerCase();
  if (patch.phone != null) member.phone = String(patch.phone).trim() || undefined;
  if (patch.notes != null) member.notes = String(patch.notes).trim() || undefined;
  if (patch.active != null) member.active = Boolean(patch.active);
  if (patch.notifyEmailEnabled != null) member.notifyEmailEnabled = Boolean(patch.notifyEmailEnabled);
  if (patch.contractStatus != null) {
    member.contractStatus = patch.contractStatus;
    if (patch.contractStatus === "signed" && !member.contractSignedAt) {
      member.contractSignedAt = new Date().toISOString();
    }
  }
  if ((patch as any).contractSignedAt != null) {
    member.contractSignedAt = (patch as any).contractSignedAt || undefined;
  }
  member.updatedAt = new Date().toISOString();
  await persistStore(store);
  return member;
}

export async function createNetworkReferral(input: {
  memberId: string;
  contact: ReferralContact;
  source?: ReferralSource | "network_portal";
  status?: ReferralStatus;
  dossierId?: string;
  actor?: string;
}): Promise<NetworkReferral> {
  const store = await loadNetworkStore();
  const member = store.members.find((m) => m.id === input.memberId);
  if (!member) throw new Error("Membre introuvable.");
  const now = new Date().toISOString();
  const status = input.status || "NOUVEAU";
  const referral: NetworkReferral = {
    id: newId("NREF"),
    memberId: member.id,
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
  return referral;
}

export async function updateNetworkReferral(
  id: string,
  patch: {
    status?: ReferralStatus;
    contact?: Partial<ReferralContact>;
    dossierId?: string | null;
    actor?: string;
    note?: string;
  },
): Promise<NetworkReferral> {
  const store = await loadNetworkStore();
  const referral = store.referrals.find((r) => r.id === id);
  if (!referral) throw new Error("Recommandation introuvable.");
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
  return referral;
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

export async function syncNetworkReferralFromDossier(dossier: Dossier, actor = "system"): Promise<void> {
  const attr = (dossier as any).network as DossierNetworkAttribution | undefined;
  if (!attr?.referralId && !attr?.memberId) return;

  const store = await loadNetworkStore();
  let referral =
    (attr.referralId && store.referrals.find((r) => r.id === attr.referralId)) ||
    store.referrals.find((r) => r.dossierId === dossier.id) ||
    null;

  const inferred = inferReferralStatusFromDossier(dossier);
  if (!referral && attr.memberId && inferred) {
    const assure = dossier.formData?.assures?.[0] || {};
    referral = {
      id: newId("NREF"),
      memberId: attr.memberId,
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
    return;
  }

  if (!referral) return;

  if (!referral.dossierId) referral.dossierId = dossier.id;
  if (!attr.referralId) attr.referralId = referral.id;

  if (inferred && statusRank(inferred) > statusRank(referral.status)) {
    referral.status = inferred;
    pushReferralEvent(referral, inferred, `Sync dossier ${dossier.id}`, actor);
    referral.updatedAt = new Date().toISOString();
    await persistStore(store);
  }
}

/** Retourne true si un membre réseau a été rattaché (prioritaire sur apporteur B2B). */
export async function attachNetworkToNewDossier(
  dossier: Dossier,
  refToken?: string,
): Promise<boolean> {
  const token = slugifyToken(refToken || "");
  if (!token) return false;

  const member = await findNetworkMemberByToken(token);
  if (!member) return false;

  const assure = dossier.formData?.assures?.[0] || {};
  const email = String(assure.email || "").trim().toLowerCase();
  const store = await loadNetworkStore();

  let referral = store.referrals.find(
    (r) => r.memberId === member.id && r.dossierId === dossier.id,
  );

  if (!referral && email) {
    referral = store.referrals.find(
      (r) =>
        r.memberId === member.id &&
        !r.dossierId &&
        String(r.contact.email || "").toLowerCase() === email &&
        !["SIGNE", "REFUSE", "PERDU"].includes(r.status),
    );
  }

  if (!referral) {
    referral = await createNetworkReferral({
      memberId: member.id,
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
    await updateNetworkReferral(referral.id, {
      dossierId: dossier.id,
      status: "DOSSIER_OUVERT",
      actor: "formulaire",
      note: `Formulaire client — dossier ${dossier.id}`,
    });
    referral = (await findNetworkReferralById(referral.id))!;
  }

  (dossier as any).network = {
    memberId: member.id,
    referralId: referral.id,
    memberLabel: member.contactName,
    referralToken: member.referralToken,
    sponsorId: member.sponsorId,
  } satisfies DossierNetworkAttribution;

  return true;
}

export function buildNetworkReferralUrl(baseUrl: string, token: string): string {
  const base = String(baseUrl || "").replace(/\/$/, "");
  const t = slugifyToken(token);
  return `${base}/?ref=${encodeURIComponent(t)}`;
}

export function buildNetworkJoinUrl(baseUrl: string, joinToken: string): string {
  const base = String(baseUrl || "").replace(/\/$/, "");
  return `${base}/rejoindre/${encodeURIComponent(joinToken)}`;
}

export async function getNetworkSummary() {
  const store = await loadNetworkStore();
  const kpis = computeAdminNetworkKpis(store.members, store.referrals);
  return {
    ...kpis,
    referrals: store.referrals.length,
    openReferrals: kpis.open,
    updatedAt: store.updatedAt,
  };
}

export function getNetworkKpisForReferrals(referrals: NetworkReferral[]) {
  return computeReferralKpis(referrals);
}

export function getRemunerationForNetworkMember() {
  return getNetworkRemunerationConfig();
}

export async function syncNetworkReferralsAfterDossierDeleted(dossierId: string): Promise<number> {
  const store = await loadNetworkStore();
  const before = store.referrals.length;
  store.referrals = store.referrals.filter((r) => r.dossierId !== dossierId);
  if (store.referrals.length < before) {
    await persistStore(store);
    return before - store.referrals.length;
  }
  return 0;
}

export async function pruneNetworkReferralsWithMissingDossiers(): Promise<number> {
  const store = await loadNetworkStore();
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

export async function resolvePartnerRef(token: string): Promise<
  | { type: "network"; label: string; contactName: string }
  | { type: "apporteur"; label: string; companyName: string }
  | null
> {
  const member = await findNetworkMemberByToken(token);
  if (member) {
    return { type: "network", label: member.contactName, contactName: member.contactName };
  }
  const { findApporteurByToken } = await import("./apporteurStore");
  const apporteur = await findApporteurByToken(token);
  if (apporteur) {
    return { type: "apporteur", label: apporteur.companyName, companyName: apporteur.companyName };
  }
  return null;
}
