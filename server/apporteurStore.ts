import fs from "fs";
import path from "path";
import { APPORTEUR_META_DOSSIER_ID } from "../shared/apporteurMeta";
import type {
  Apporteur,
  ApporteurType,
  PartnerRecruitRequest,
  PartnerRecruitStatus,
  Referral,
  ReferralContact,
  ReferralSource,
  ReferralStatus,
} from "../shared/apporteurTypes";
import { buildContactNameFromParts, normalizeApporteurProfileInput, validateApporteurProfileForContract, type ApporteurProfileInput } from "../shared/apporteurProfile";
import { extractSirenFromSiret } from "../shared/siret";
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
  partnerRecruits: PartnerRecruitRequest[];
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
  return { version: 1, apporteurs: [], referrals: [], partnerRecruits: [], updatedAt: new Date().toISOString() };
}

function normalizeStore(raw: unknown): ApporteurStore {
  const data = raw as ApporteurStore | null;
  return {
    version: 1,
    apporteurs: Array.isArray(data?.apporteurs) ? data.apporteurs : [],
    referrals: Array.isArray(data?.referrals) ? data.referrals : [],
    partnerRecruits: Array.isArray(data?.partnerRecruits) ? data.partnerRecruits : [],
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
  const { writeApporteurStoreToFirestore, isFirebaseConfigured } = await import("./firebaseSync");
  if (!isFirebaseConfigured()) return;
  store.updatedAt = new Date().toISOString();
  await writeApporteurStoreToFirestore(store);
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
  try {
    await saveStoreToFirestore(store);
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error("[Apporteurs] Échec sauvegarde Firestore apporteur_store:", msg);
    if (process.env.RAILWAY_ENVIRONMENT || process.env.FIREBASE_REQUIRED === "true") {
      throw new Error(
        `Impossible de persister les apporteurs dans Firestore (collection apporteur_store). ${msg}`,
      );
    }
  }
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

/** Candidats ?ref= : contact en priorité (évite les conflits même société), puis contact+société. */
function buildReferralTokenCandidates(contactName: string, companyName: string): string[] {
  const contact = slugifyToken(contactName);
  const company = slugifyToken(companyName);
  const candidates: string[] = [];
  if (contact) candidates.push(contact);
  if (contact && company) {
    const combined = slugifyToken(`${contactName} ${companyName}`) || `${contact}-${company}`.slice(0, 48);
    if (combined && combined !== contact) candidates.push(combined);
  }
  if (company) candidates.push(company);
  return [...new Set(candidates.filter(Boolean))];
}

function pickReferralToken(store: ApporteurStore, candidates: string[]): string {
  for (const base of candidates) {
    const root = slugifyToken(base) || base;
    if (root && !store.apporteurs.some((a) => a.referralToken === root)) return root;
  }
  return uniqueReferralToken(store, candidates[0] || "partenaire");
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

export async function createApporteur(input: ApporteurProfileInput & {
  notes?: string;
  referralToken?: string;
  sponsorId?: string;
  contractStatus?: Apporteur["contractStatus"];
  contractSignedAt?: string;
}): Promise<Apporteur> {
  const store = await loadApporteurStore();
  const now = new Date().toISOString();
  const normalized = normalizeApporteurProfileInput(input);
  const companyName = String(normalized.companyName || "").trim() || normalized.contactName || "";
  const contactName = String(normalized.contactName || "").trim();
  const email = String(normalized.email || "").trim().toLowerCase();
  if (!contactName || !email.includes("@")) {
    throw new Error("Prénom, nom et email valides requis.");
  }
  if (normalized.type === "autre" && !normalized.typeCustomLabel) {
    throw new Error("Précisez le statut professionnel (champ « Autre »).");
  }
  if (normalized.legalForm === "autre" && !normalized.legalFormOther) {
    throw new Error("Précisez la forme juridique (champ « Autre »).");
  }
  if (input.sponsorId) {
    const sponsor = store.apporteurs.find((a) => a.id === input.sponsorId);
    if (!sponsor) throw new Error("Parrain introuvable.");
  }
  if (store.apporteurs.some((a) => a.email === email)) {
    throw new Error("Un apporteur avec cet email existe déjà.");
  }
  const tokenCandidates = input.referralToken?.trim()
    ? [slugifyToken(input.referralToken)]
    : buildReferralTokenCandidates(contactName, companyName);
  const contractStatus = input.contractStatus || "none";
  const apporteur: Apporteur = {
    id: newId("AP"),
    createdAt: now,
    updatedAt: now,
    active: true,
    companyName,
    contactName,
    contactPrenom: normalized.contactPrenom,
    contactNom: normalized.contactNom,
    email,
    phone: normalized.phone,
    addressLine: normalized.addressLine,
    postalCode: normalized.postalCode,
    city: normalized.city,
    siret: normalized.siret,
    siren: normalized.siren,
    companyLegalName: normalized.companyLegalName,
    legalForm: normalized.legalForm,
    legalFormOther: normalized.legalFormOther,
    type: normalized.type || "apporteur_affaires",
    typeCustomLabel: normalized.typeCustomLabel,
    referralToken: pickReferralToken(store, tokenCandidates.filter(Boolean)),
    portalToken: generatePortalToken(),
    notifyEmailEnabled: true,
    notes: String(input.notes || "").trim() || undefined,
    sponsorId: input.sponsorId || undefined,
    contractStatus,
    contractSignedAt:
      input.contractSignedAt ||
      (contractStatus === "signed" ? now : undefined),
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
      | "contactPrenom"
      | "contactNom"
      | "email"
      | "phone"
      | "addressLine"
      | "postalCode"
      | "city"
      | "siret"
      | "siren"
      | "companyLegalName"
      | "siretVerifiedAt"
      | "legalForm"
      | "legalFormOther"
      | "type"
      | "typeCustomLabel"
      | "notes"
      | "active"
      | "notifyEmailEnabled"
      | "contractStatus"
      | "contractSignedAt"
      | "contractSignature"
      | "driveFolderId"
      | "referralToken"
      | "sponsorId"
    >
  >,
): Promise<Apporteur> {
  const store = await loadApporteurStore();
  const apporteur = store.apporteurs.find((a) => a.id === id);
  if (!apporteur) throw new Error("Apporteur introuvable.");
  if (patch.sponsorId !== undefined) {
    if (patch.sponsorId === id) throw new Error("Un apporteur ne peut pas être son propre parrain.");
    if (patch.sponsorId) {
      const sponsor = store.apporteurs.find((a) => a.id === patch.sponsorId);
      if (!sponsor) throw new Error("Parrain introuvable.");
    }
    apporteur.sponsorId = patch.sponsorId || undefined;
  }
  if (patch.referralToken != null) {
    const next = slugifyToken(String(patch.referralToken));
    if (!next) throw new Error("Lien ?ref= invalide.");
    if (store.apporteurs.some((a) => a.id !== id && a.referralToken === next)) {
      throw new Error("Ce lien ?ref= est déjà utilisé par un autre apporteur.");
    }
    apporteur.referralToken = next;
  }
  if (patch.companyName != null) apporteur.companyName = String(patch.companyName).trim();
  if (patch.contactPrenom != null) apporteur.contactPrenom = String(patch.contactPrenom).trim() || undefined;
  if (patch.contactNom != null) apporteur.contactNom = String(patch.contactNom).trim() || undefined;
  if (patch.contactName != null) apporteur.contactName = String(patch.contactName).trim();
  if (patch.contactPrenom != null || patch.contactNom != null) {
    const fromParts = buildContactNameFromParts(apporteur.contactPrenom, apporteur.contactNom);
    if (fromParts) apporteur.contactName = fromParts;
  }
  if (patch.email != null) apporteur.email = String(patch.email).trim().toLowerCase();
  if (patch.phone != null) apporteur.phone = String(patch.phone).trim() || undefined;
  if (patch.addressLine != null) apporteur.addressLine = String(patch.addressLine).trim() || undefined;
  if (patch.postalCode != null) apporteur.postalCode = String(patch.postalCode).trim() || undefined;
  if (patch.city != null) apporteur.city = String(patch.city).trim() || undefined;
  if (patch.siret != null) apporteur.siret = String(patch.siret).replace(/\s/g, "").trim() || undefined;
  if (patch.siren != null) apporteur.siren = String(patch.siren).replace(/\s/g, "").trim() || undefined;
  if (patch.companyLegalName != null) {
    apporteur.companyLegalName = String(patch.companyLegalName).trim() || undefined;
  }
  if (patch.siretVerifiedAt != null) {
    apporteur.siretVerifiedAt = patch.siretVerifiedAt || undefined;
  }
  if (patch.siret != null || patch.siren != null) {
    const siren = extractSirenFromSiret(apporteur.siret || apporteur.siren || "");
    if (siren) apporteur.siren = siren;
  }
  if (patch.legalForm != null) apporteur.legalForm = String(patch.legalForm).trim() || undefined;
  if (patch.legalFormOther != null) {
    apporteur.legalFormOther = String(patch.legalFormOther).trim() || undefined;
  }
  if (patch.type != null) {
    apporteur.type = patch.type;
    if (patch.type !== "autre") apporteur.typeCustomLabel = undefined;
  }
  if (patch.typeCustomLabel != null) {
    apporteur.typeCustomLabel =
      apporteur.type === "autre" ? String(patch.typeCustomLabel).trim() || undefined : undefined;
  }
  if (patch.type === "autre" && patch.typeCustomLabel === "") {
    apporteur.typeCustomLabel = undefined;
  }
  if (patch.legalForm != null && patch.legalForm !== "autre") {
    apporteur.legalFormOther = undefined;
  }
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
  if (patch.contractSignature !== undefined) {
    apporteur.contractSignature = patch.contractSignature || undefined;
  }
  if (patch.driveFolderId !== undefined) {
    apporteur.driveFolderId = patch.driveFolderId || undefined;
  }
  apporteur.updatedAt = new Date().toISOString();
  await persistStore(store);
  return apporteur;
}

export async function updateApporteurProfileFromPortal(
  portalToken: string,
  input: ApporteurProfileInput,
): Promise<Apporteur> {
  const apporteur = await findApporteurByPortalToken(portalToken);
  if (!apporteur) throw new Error("Lien portail invalide.");
  if ((apporteur.contractStatus || "none") === "signed") {
    throw new Error("Contrat déjà signé — profil non modifiable.");
  }
  const normalized = normalizeApporteurProfileInput({
    ...input,
    email: input.email || apporteur.email,
  });
  const merged: Apporteur = { ...apporteur, ...normalized, companyName: normalized.companyName || apporteur.companyName };
  const check = validateApporteurProfileForContract(merged);
  if (!check.ok) throw new Error(check.error);

  let siretVerifiedAt: string | undefined;
  if (merged.companyName && merged.siret) {
    try {
      const { lookupFrenchCompany } = await import("./sireneLookup");
      const match = await lookupFrenchCompany(merged.siret);
      if (!match) throw new Error("SIREN/SIRET introuvable au registre national des entreprises.");
      if (!match.isActive) throw new Error("L'établissement associé à ce SIRET est inactif ou radié.");
      normalized.companyLegalName = match.name;
      normalized.siren = match.siren;
      normalized.siret = match.siret || merged.siret;
      siretVerifiedAt = new Date().toISOString();
    } catch (err: any) {
      const msg = String(err?.message || "");
      const infraBlocked =
        msg.includes("saturé") || msg.includes("Accès refusé") || msg.includes("indisponible");
      if (infraBlocked) {
        console.warn("[SIRET] Vérification registre non joignable depuis le serveur:", msg);
        normalized.companyLegalName = normalized.companyLegalName || merged.companyName;
        normalized.siren = normalized.siren || extractSirenFromSiret(merged.siret || "");
      } else {
        throw new Error(msg || "Impossible de vérifier le SIRET.");
      }
    }
  }

  return updateApporteur(apporteur.id, { ...normalized, siretVerifiedAt });
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

export function listDirectDownlineApporteurs(store: ApporteurStore, sponsorId: string): Apporteur[] {
  return store.apporteurs.filter((a) => a.sponsorId === sponsorId && a.active);
}

export function getTeamReferralsForApporteur(store: ApporteurStore, apporteurId: string): Referral[] {
  const downlineIds = new Set(listDirectDownlineApporteurs(store, apporteurId).map((a) => a.id));
  return store.referrals.filter((r) => downlineIds.has(r.apporteurId));
}

export function enrichDownlineForPortal(store: ApporteurStore, downline: Apporteur[]) {
  return downline.map((a) => {
    const refs = store.referrals.filter((r) => r.apporteurId === a.id);
    const stats = computeReferralKpis(refs);
    const lastActivityAt =
      refs.length > 0
        ? refs.reduce(
            (max, r) => (new Date(r.updatedAt).getTime() > new Date(max).getTime() ? r.updatedAt : max),
            refs[0].updatedAt,
          )
        : a.createdAt;
    const contractStatus = a.contractStatus || "none";
    let activityLabel: "active" | "pending_contract" | "inactive" = "pending_contract";
    if (!a.active) activityLabel = "inactive";
    else if (contractStatus === "signed") activityLabel = "active";
    return {
      id: a.id,
      contactName: a.contactName,
      companyName: a.companyName,
      createdAt: a.createdAt,
      active: a.active,
      contractStatus,
      activityLabel,
      clientReferrals: stats.total,
      openReferrals: stats.open,
      signedReferrals: stats.signed,
      lastActivityAt,
    };
  });
}

function pushRecruitEvent(
  recruit: PartnerRecruitRequest,
  status: PartnerRecruitStatus,
  message?: string,
  actor?: string,
) {
  recruit.events = recruit.events || [];
  recruit.events.push({
    at: new Date().toISOString(),
    status: status as ReferralStatus,
    message,
    actor,
  });
  recruit.events = recruit.events.slice(-30);
}

export async function listPartnerRecruits(filters?: {
  sponsorApporteurId?: string;
  status?: PartnerRecruitStatus;
}): Promise<PartnerRecruitRequest[]> {
  const store = await loadApporteurStore();
  let items = [...store.partnerRecruits];
  if (filters?.sponsorApporteurId) {
    items = items.filter((r) => r.sponsorApporteurId === filters.sponsorApporteurId);
  }
  if (filters?.status) {
    items = items.filter((r) => r.status === filters.status);
  }
  return items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function createPartnerRecruit(input: {
  sponsorApporteurId: string;
  contactName?: string;
  contactPrenom?: string;
  contactNom?: string;
  email: string;
  phone?: string;
  companyName?: string;
  siret?: string;
  siren?: string;
  companyLegalName?: string;
  notes?: string;
  actor?: string;
}): Promise<PartnerRecruitRequest> {
  const store = await loadApporteurStore();
  const sponsor = store.apporteurs.find((a) => a.id === input.sponsorApporteurId);
  if (!sponsor) throw new Error("Apporteur parrain introuvable.");
  if ((sponsor.contractStatus || "none") !== "signed") {
    throw new Error("Contrat apporteur signé requis pour recommander un partenaire.");
  }
  const email = String(input.email || "").trim().toLowerCase();
  const contactPrenom = String(input.contactPrenom || "").trim();
  const contactNom = String(input.contactNom || "").trim();
  const contactName =
    buildContactNameFromParts(contactPrenom, contactNom) ||
    String(input.contactName || "").trim();
  if (!contactName || !email.includes("@")) {
    throw new Error("Prénom, nom et email valides requis.");
  }
  if (!contactPrenom || contactPrenom.length < 2) throw new Error("Le prénom est requis.");
  if (!contactNom || contactNom.length < 2) throw new Error("Le nom de famille est requis.");
  if (store.apporteurs.some((a) => a.email === email)) {
    throw new Error("Cette personne est déjà apporteur LCIF.");
  }
  const pending = store.partnerRecruits.find(
    (r) =>
      r.email === email &&
      !["CONTRAT_SIGNE", "REFUSE"].includes(r.status),
  );
  if (pending) {
    throw new Error("Une candidature est déjà en cours pour cet email.");
  }
  const now = new Date().toISOString();
  const recruit: PartnerRecruitRequest = {
    id: newId("PRE"),
    sponsorApporteurId: sponsor.id,
    createdAt: now,
    updatedAt: now,
    status: "NOUVEAU",
    contactName,
    contactPrenom,
    contactNom,
    email,
    phone: String(input.phone || "").trim() || undefined,
    companyName: String(input.companyName || "").trim() || undefined,
    siret: String(input.siret || "").replace(/\s/g, "").trim() || undefined,
    siren: String(input.siren || "").replace(/\s/g, "").trim() || undefined,
    companyLegalName: String(input.companyLegalName || "").trim() || undefined,
    notes: String(input.notes || "").trim() || undefined,
    events: [],
  };
  pushRecruitEvent(recruit, "NOUVEAU", "Candidature partenaire via portail apporteur", input.actor || "apporteur_portal");
  store.partnerRecruits.push(recruit);
  await persistStore(store);
  try {
    const { notifyTelegramPartnerRecruit } = await import("./telegramNotify");
    await notifyTelegramPartnerRecruit({
      recruit,
      sponsorName: sponsor.contactName,
      sponsorCompany: sponsor.companyName,
    });
  } catch (err: any) {
    console.warn("[Apporteurs] Telegram candidature:", err?.message || err);
  }
  return recruit;
}

async function ensureApporteurForRecruit(
  recruit: PartnerRecruitRequest,
  contractStatus: Apporteur["contractStatus"] = "sent",
): Promise<Apporteur> {
  if (recruit.createdApporteurId) {
    const existing = await findApporteurById(recruit.createdApporteurId);
    if (existing) {
      if ((existing.contractStatus || "none") !== "signed") {
        return updateApporteur(existing.id, { contractStatus });
      }
      return existing;
    }
  }
  const apporteur = await createApporteur({
    companyName: recruit.companyName || recruit.contactName,
    contactPrenom: recruit.contactPrenom,
    contactNom: recruit.contactNom,
    contactName: recruit.contactName,
    email: recruit.email,
    phone: recruit.phone,
    siret: recruit.siret,
    siren: recruit.siren,
    companyLegalName: recruit.companyLegalName,
    type: "apporteur_affaires",
    notes: recruit.notes
      ? `Reco parrain : ${recruit.sponsorApporteurId}. ${recruit.notes}`
      : `Reco parrain : ${recruit.sponsorApporteurId}`,
    sponsorId: recruit.sponsorApporteurId,
    contractStatus,
  });
  const store = await loadApporteurStore();
  const r = store.partnerRecruits.find((x) => x.id === recruit.id);
  if (r) {
    r.createdApporteurId = apporteur.id;
    r.updatedAt = new Date().toISOString();
    await persistStore(store);
  }
  return apporteur;
}

async function createApporteurFromRecruit(recruit: PartnerRecruitRequest): Promise<Apporteur> {
  if (recruit.createdApporteurId) {
    const existing = await findApporteurById(recruit.createdApporteurId);
    if (existing) {
      if ((existing.contractStatus || "none") !== "signed") {
        return updateApporteur(existing.id, { contractStatus: "signed" });
      }
      return existing;
    }
  }
  return ensureApporteurForRecruit(recruit, "signed");
}

export async function finalizeRecruitAfterOnlineSignature(apporteurId: string): Promise<void> {
  const store = await loadApporteurStore();
  const recruit = store.partnerRecruits.find(
    (r) =>
      r.createdApporteurId === apporteurId &&
      r.status !== "CONTRAT_SIGNE" &&
      r.status !== "REFUSE",
  );
  if (!recruit) return;

  const previousStatus = recruit.status;
  recruit.status = "CONTRAT_SIGNE";
  pushRecruitEvent(recruit, "CONTRAT_SIGNE", "Contrat signé en ligne — apporteur activé", "contract_sign");
  recruit.updatedAt = new Date().toISOString();
  await persistStore(store);

  if (previousStatus !== "CONTRAT_SIGNE") {
    try {
      const { notifyTelegramPartnerRecruitConverted } = await import("./telegramNotify");
      const apporteur = store.apporteurs.find((a) => a.id === apporteurId);
      const sponsor = store.apporteurs.find((a) => a.id === recruit.sponsorApporteurId);
      if (apporteur) {
        await notifyTelegramPartnerRecruitConverted({
          recruit,
          apporteur,
          sponsorName: sponsor?.contactName || recruit.sponsorApporteurId,
        });
      }
    } catch (err: any) {
      console.warn("[Apporteurs] Telegram conversion signature:", err?.message || err);
    }
  }
}

export async function updatePartnerRecruit(
  id: string,
  patch: {
    status?: PartnerRecruitStatus;
    note?: string;
    actor?: string;
  },
): Promise<PartnerRecruitRequest> {
  const store = await loadApporteurStore();
  const recruit = store.partnerRecruits.find((r) => r.id === id);
  if (!recruit) throw new Error("Candidature introuvable.");
  const previousStatus = recruit.status;
  if (patch.status && patch.status !== recruit.status) {
    recruit.status = patch.status;
    pushRecruitEvent(recruit, patch.status, patch.note, patch.actor || "admin");
  } else if (patch.note) {
    pushRecruitEvent(recruit, recruit.status, patch.note, patch.actor || "admin");
  }
  recruit.updatedAt = new Date().toISOString();
  await persistStore(store);

  if (patch.status === "CONTRAT_ENVOYE" && previousStatus !== "CONTRAT_ENVOYE") {
    const apporteur = await ensureApporteurForRecruit(recruit, "sent");
    try {
      const { sendApporteurContractSigningInvite } = await import("./apporteurNotify");
      await sendApporteurContractSigningInvite(apporteur);
    } catch (err: any) {
      console.warn("[Apporteurs] Email signature contrat:", err?.message || err);
    }
  }

  if (patch.status === "CONTRAT_SIGNE" && previousStatus !== "CONTRAT_SIGNE") {
    const apporteur = await createApporteurFromRecruit(recruit);
    try {
      const { notifyTelegramPartnerRecruitConverted } = await import("./telegramNotify");
      const sponsor = store.apporteurs.find((a) => a.id === recruit.sponsorApporteurId);
      await notifyTelegramPartnerRecruitConverted({
        recruit,
        apporteur,
        sponsorName: sponsor?.contactName || recruit.sponsorApporteurId,
      });
    } catch (err: any) {
      console.warn("[Apporteurs] Telegram conversion:", err?.message || err);
    }
    const refreshed = await loadApporteurStore();
    return refreshed.partnerRecruits.find((r) => r.id === id)!;
  }
  return recruit;
}

/** Suppression définitive d'un apporteur (reco, candidatures liées ; filleuls détachés). */
export async function deleteApporteurPermanently(id: string): Promise<void> {
  const store = await loadApporteurStore();
  const apporteur = store.apporteurs.find((a) => a.id === id);
  if (!apporteur) throw new Error("Apporteur introuvable.");

  for (const a of store.apporteurs) {
    if (a.sponsorId === id) {
      a.sponsorId = undefined;
      a.updatedAt = new Date().toISOString();
    }
  }
  store.apporteurs = store.apporteurs.filter((a) => a.id !== id);
  store.referrals = store.referrals.filter((r) => r.apporteurId !== id);
  store.partnerRecruits = store.partnerRecruits.filter(
    (r) => r.sponsorApporteurId !== id && r.createdApporteurId !== id,
  );
  await persistStore(store);
}
