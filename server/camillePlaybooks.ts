import fs from "fs";
import path from "path";
import { hasStudyBeenSent } from "./dossierLifecycle";
import { clientHasAcceptedInsuranceChange } from "./insuranceAcceptance";

export type CamillePlaybook = {
  id: string;
  tags: string[];
  /** Résumé de la situation (question Camille à l'équipe). */
  situationSummary: string;
  /** Consigne équipe validée. */
  staffGuidance: string;
  /** Extrait anonymisé du mail client. */
  clientMessagePattern: string;
  /** Réponse client approuvée (texte brut). */
  approvedReplyPlain: string;
  approvedAt: string;
  approvedBy?: string;
  dossierId?: string;
  useCount: number;
  lastUsedAt?: string;
};

type PlaybookStore = {
  version: 1;
  playbooks: CamillePlaybook[];
  updatedAt: string;
};

const MAX_PLAYBOOKS = 500;
const MAX_PROMPT_PLAYBOOKS = 5;
const META_DOSSIER_ID = "LCIF-999999";

function getPlaybooksFilePath() {
  if (process.env.VERCEL || process.env.RAILWAY_ENVIRONMENT) {
    return path.join("/tmp/data", "camille-playbooks.json");
  }
  return path.join(process.cwd(), "data", "camille-playbooks.json");
}

function normalizeText(s: string): string {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadStoreFromFile(): PlaybookStore {
  try {
    const p = getPlaybooksFilePath();
    if (!fs.existsSync(p)) {
      return { version: 1, playbooks: [], updatedAt: new Date().toISOString() };
    }
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
    return {
      version: 1,
      playbooks: Array.isArray(raw?.playbooks) ? raw.playbooks : [],
      updatedAt: raw?.updatedAt || new Date().toISOString(),
    };
  } catch {
    return { version: 1, playbooks: [], updatedAt: new Date().toISOString() };
  }
}

function saveStoreToFile(store: PlaybookStore) {
  const p = getPlaybooksFilePath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  store.updatedAt = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(store, null, 2), "utf-8");
}

async function loadStoreAsync(): Promise<PlaybookStore> {
  try {
    const { readDB } = await import("./db");
    const db = await readDB();
    const meta = db.dossiers.find((d: any) => d.id === META_DOSSIER_ID);
    const fromMeta = meta?.camillePlaybooksStore as PlaybookStore | undefined;
    if (fromMeta?.playbooks?.length) return fromMeta;
  } catch {
    /* fallback file */
  }
  return loadStoreFromFile();
}

async function saveStoreAsync(store: PlaybookStore) {
  store.updatedAt = new Date().toISOString();
  saveStoreToFile(store);
  try {
    const { readDB, writeDB } = await import("./db");
    const db = await readDB();
    let meta = db.dossiers.find((d: any) => d.id === META_DOSSIER_ID);
    if (!meta) {
      meta = {
        id: META_DOSSIER_ID,
        status: "CLOS",
        createdAt: store.updatedAt,
        updatedAt: store.updatedAt,
        formData: { assures: [{ prenom: "Camille", nom: "Playbooks", email: "internal@lcif.local" }] },
        camillePlaybooksStore: store,
      };
      db.dossiers.push(meta);
    } else {
      meta.camillePlaybooksStore = store;
      meta.updatedAt = store.updatedAt;
    }
    await writeDB(db, meta);
  } catch (e: any) {
    console.warn("[Camille playbooks] Firestore meta save:", e?.message || e);
  }
}

function loadStore(): PlaybookStore {
  return loadStoreFromFile();
}

function saveStore(store: PlaybookStore) {
  saveStoreToFile(store);
  void saveStoreAsync(store);
}

export function extractSituationTags(
  dossier: any,
  clientMessage: string,
  staffGuidance?: string,
): string[] {
  const tags = new Set<string>();
  const blob = normalizeText(`${clientMessage} ${staffGuidance || ""}`);

  if (hasStudyBeenSent(dossier)) tags.add("post-etude");
  else tags.add("pre-etude");

  if (clientHasAcceptedInsuranceChange(dossier)) tags.add("accord-client");
  if (/multi|monsieur|madame|second|autre pr[eê]t|co-emprunteur|conjoint/i.test(blob)) {
    tags.add("multi-contrat");
  }
  if (/\bcni\b|rib|identit|passeport|iban/i.test(blob)) tags.add("identite");
  if (/offre|tableau|amort|pdf|banque|document|pi[eè]ce/i.test(blob)) tags.add("documents-pret");
  if (/assurance|substitution|changement|activer|d.accord/i.test(blob)) tags.add("changement-assurance");
  if (/[eé]conom|€|euro|tarif|co[uû]t|mensualit/i.test(blob)) tags.add("question-chiffrage");
  if (/question|savoir|inform|expliqu/i.test(blob)) tags.add("question-client");
  if (/merci|re[cç]u|bien re[cç]u/i.test(blob)) tags.add("remerciement");

  return [...tags];
}

function scorePlaybook(
  pb: CamillePlaybook,
  clientMessage: string,
  tags: string[],
): number {
  let score = 0;
  for (const t of pb.tags || []) {
    if (tags.includes(t)) score += 3;
  }
  const msg = normalizeText(clientMessage);
  const pattern = normalizeText(pb.clientMessagePattern);
  if (!msg || !pattern) return score;

  const msgWords = new Set(msg.split(" ").filter((w) => w.length > 4));
  for (const w of pattern.split(" ").filter((x) => x.length > 4)) {
    if (msgWords.has(w)) score += 1;
  }
  if (pattern.length > 20 && msg.includes(pattern.slice(0, Math.min(40, pattern.length)))) {
    score += 4;
  }
  score += Math.min(3, Math.floor((pb.useCount || 0) / 5));
  return score;
}

export function findSimilarPlaybooks(
  clientMessage: string,
  dossier: any,
  limit = MAX_PROMPT_PLAYBOOKS,
): Array<{ playbook: CamillePlaybook; score: number }> {
  const tags = extractSituationTags(dossier, clientMessage);
  const store = loadStore();
  return store.playbooks
    .map((pb) => ({ playbook: pb, score: scorePlaybook(pb, clientMessage, tags) }))
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function getPlaybookAutoReplyMinScore(): number {
  const n = Number(process.env.CAMILLE_PLAYBOOK_AUTO_SCORE || "8");
  return Number.isFinite(n) && n > 0 ? n : 8;
}

export async function tryPlaybookAutoReply(
  dossier: any,
  clientMessage: string,
): Promise<{ plain: string; playbook: CamillePlaybook } | null> {
  const store = await loadStoreAsync();
  const tags = extractSituationTags(dossier, clientMessage);
  const matches = store.playbooks
    .map((pb) => ({ playbook: pb, score: scorePlaybook(pb, clientMessage, tags) }))
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 1);
  const top = matches[0];
  if (!top || top.score < getPlaybookAutoReplyMinScore()) return null;
  incrementPlaybookUse(top.playbook.id);
  return { plain: top.playbook.approvedReplyPlain, playbook: top.playbook };
}

export async function buildPlaybooksPromptBlock(
  clientMessage: string,
  dossier: any,
): Promise<string> {
  const store = await loadStoreAsync();
  const tags = extractSituationTags(dossier, clientMessage);
  const matches = store.playbooks
    .map((pb) => ({ playbook: pb, score: scorePlaybook(pb, clientMessage, tags) }))
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PROMPT_PLAYBOOKS);
  if (!matches.length) return "";

  const lines = matches.map(({ playbook: pb, score }, i) => {
    return [
      `Cas ${i + 1} (score ${score}) — tags: ${(pb.tags || []).join(", ")}`,
      `Situation: ${pb.situationSummary}`,
      `Consigne équipe validée: ${pb.staffGuidance}`,
      `Réponse client approuvée (s'inspirer du fond, adapter au mail actuel):`,
      `"""${pb.approvedReplyPlain.slice(0, 1200)}"""`,
    ].join("\n");
  });

  return [
    "PLAYBOOKS VALIDÉS PAR L'ÉQUIPE (réutiliser le fond si la situation est similaire — adapter au mail actuel, ne pas copier mot pour mot):",
    ...lines,
  ].join("\n\n");
}

export function saveApprovedPlaybook(params: {
  dossier: any;
  clientMessage: string;
  situationSummary: string;
  staffGuidance: string;
  approvedReplyPlain: string;
  approvedBy?: string;
}): CamillePlaybook {
  const store = loadStore();
  const tags = extractSituationTags(
    params.dossier,
    params.clientMessage,
    params.staffGuidance,
  );
  const excerpt = String(params.clientMessage || "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(LCIF-\d{6})\b/gi, "[dossier]")
    .slice(0, 400);

  const pb: CamillePlaybook = {
    id: `pb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tags,
    situationSummary: params.situationSummary.slice(0, 500),
    staffGuidance: params.staffGuidance.slice(0, 800),
    clientMessagePattern: excerpt,
    approvedReplyPlain: params.approvedReplyPlain.slice(0, 4000),
    approvedAt: new Date().toISOString(),
    approvedBy: params.approvedBy,
    dossierId: params.dossier?.id,
    useCount: 0,
  };

  store.playbooks.unshift(pb);
  store.playbooks = store.playbooks.slice(0, MAX_PLAYBOOKS);
  saveStore(store);
  return pb;
}

function incrementPlaybookUse(id: string) {
  const store = loadStore();
  const pb = store.playbooks.find((p) => p.id === id);
  if (!pb) return;
  pb.useCount = (pb.useCount || 0) + 1;
  pb.lastUsedAt = new Date().toISOString();
  saveStore(store);
}

export function listPlaybooks(limit = 20): CamillePlaybook[] {
  return loadStore().playbooks.slice(0, limit);
}
