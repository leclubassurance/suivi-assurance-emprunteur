import fs from "fs";
import path from "path";
import { CAMILLE_META_DOSSIER_ID as META_DOSSIER_ID } from "../shared/camilleMeta";
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
  seededAt?: string;
  seedVersion?: string;
};

const MAX_PLAYBOOKS = 500;
const MAX_PROMPT_PLAYBOOKS = 5;
const STORE_CACHE_MS = 15_000;

let cachedStore: PlaybookStore | null = null;
let cachedAt = 0;

const PLAYBOOK_SEED_VERSION = "2026-05-29-client-v2";

const DEFAULT_SEED_PLAYBOOKS: Array<Omit<CamillePlaybook, "id" | "approvedAt" | "useCount">> = [
  {
    tags: ["pre-etude", "documents-pret", "question-client"],
    situationSummary: "Client demande quels documents envoyer pour l'étude.",
    staffGuidance:
      "Offre de prêt + tableau d'amortissement complets en PDF depuis l'espace banque. Pas de CNI/RIB à ce stade.",
    clientMessagePattern: "quels documents envoyer offre pret tableau amortissement pieces",
    approvedReplyPlain:
      "Pour l'étude, nous avons besoin de deux documents en PDF depuis votre espace bancaire :\n\n• l'offre de prêt (ou convention de prêt) complète ;\n• le tableau d'amortissement complet.\n\nSi vous ne les avez pas encore sous la main, vous pouvez les récupérer sur votre espace client banque ou les demander à votre conseiller.",
  },
  {
    tags: ["pre-etude", "documents-pret", "question-client"],
    situationSummary: "Client dit avoir déjà envoyé les documents ou les pièces.",
    staffGuidance:
      "Accuser réception, confirmer analyse en cours si fichiers exploitables. Ne pas redemander offre/tableau si déjà présents.",
    clientMessagePattern: "deja envoye transmis pieces documents recu joint offre tableau",
    approvedReplyPlain:
      "Merci pour votre message.\n\nNous avons bien pris en compte votre envoi et nous vérifions que l'offre de prêt et le tableau d'amortissement sont complets et exploitables pour l'étude.\n\nCharles prépare votre analyse ; nous revenons vers vous par email dès que l'étude personnalisée est prête.\n\nSi un document manque ou est illisible, nous vous le signalerons clairement.",
  },
  {
    tags: ["pre-etude", "question-client"],
    situationSummary: "Client demande si l'étude est gratuite ou s'il y a des frais.",
    staffGuidance: "Confirmer gratuité et sans engagement. Pas de chiffre d'économie.",
    clientMessagePattern: "gratuit gratuitement frais cout combien payer engagement",
    approvedReplyPlain:
      "L'étude d'économie sur votre assurance emprunteur est entièrement gratuite et sans engagement.\n\nElle permet à Charles de comparer votre contrat actuel à des alternatives équivalentes. Vous décidez librement ensuite de poursuivre ou non.",
  },
  {
    tags: ["pre-etude", "changement-assurance", "question-client"],
    situationSummary: "Client pose une question sur la Loi Lemoine ou le changement d'assurance.",
    staffGuidance: "Expliquer le principe Lemoine sans éligibilité personnalisée. Pas de chiffres.",
    clientMessagePattern: "loi lemoine changer assurance substitution resilier banque deleguer",
    approvedReplyPlain:
      "La Loi Lemoine permet en principe de changer d'assurance emprunteur à tout moment, avec une équivalence de garanties et sans nouveau questionnaire médical dans la plupart des cas.\n\nChaque situation est unique : Charles vérifie votre contrat et votre offre de prêt lors de l'étude gratuite, puis vous présente les options adaptées.",
  },
  {
    tags: ["pre-etude", "question-client"],
    situationSummary: "Client demande comment fonctionne l'étude ou les prochaines étapes.",
    staffGuidance: "Parcours : documents → analyse Charles → étude par email. Pas de délai ferme.",
    clientMessagePattern: "comment ca marche etapes procedure fonctionnement demarche suite",
    approvedReplyPlain:
      "Voici comment cela se déroule :\n\n1. Nous analysons votre offre de prêt et votre tableau d'amortissement.\n2. Charles compare votre contrat actuel aux alternatives équivalentes.\n3. Vous recevez une étude personnalisée par email avec les économies possibles.\n\nL'étude est gratuite et sans engagement. Si les économies vous conviennent, nous vous accompagnons pour la substitution auprès de votre banque.",
  },
  {
    tags: ["pre-etude", "question-client"],
    situationSummary: "Client demande le délai pour recevoir l'étude.",
    staffGuidance: "Pas de délai garanti. Dossier en cours d'analyse.",
    clientMessagePattern: "delai combien temps quand etude recevoir attente",
    approvedReplyPlain:
      "Merci pour votre patience.\n\nDès que vos documents sont complets et exploitables, Charles prépare votre étude personnalisée. Le délai dépend du volume de dossiers en cours ; nous vous tenons informé par email.\n\nSi un document manque ou doit être complété, nous vous le signalons sans attendre.",
  },
  {
    tags: ["pre-etude", "question-client"],
    situationSummary: "Client demande qui est Camille ou Charles.",
    staffGuidance: "Camille = suivi email. Charles = conseiller étude. Ton humain, transparent.",
    clientMessagePattern: "qui etes vous camille charles conseiller humain robot",
    approvedReplyPlain:
      "Je suis Camille, assistante de Charles au Club Immobilier Français : je assure le suivi de votre dossier par email au quotidien.\n\nCharles Victor est le conseiller qui analyse votre contrat et prépare l'étude personnalisée d'économies sur votre assurance emprunteur.\n\nN'hésitez pas à nous écrire ici pour toute question sur votre dossier.",
  },
  {
    tags: ["post-etude", "remerciement"],
    situationSummary: "Client remercie après réception de l'étude.",
    staffGuidance: "Accuser réception chaleureusement. Proposer de répondre aux questions ou poursuivre.",
    clientMessagePattern: "merci bien recu etude message recu",
    approvedReplyPlain:
      "Je vous en prie, c'est avec plaisir.\n\nN'hésitez pas si vous avez des questions sur l'étude ou si vous souhaitez que nous poursuivions la démarche de changement d'assurance.",
  },
  {
    tags: ["post-etude", "question-client", "etude"],
    situationSummary: "Client confirme avoir bien reçu l'étude ou demande si on a des nouvelles.",
    staffGuidance: "Accuser réception. Inviter à poser questions ou confirmer accord pour substitution.",
    clientMessagePattern: "bien recu etude consulte lu parcouru nouvelles",
    approvedReplyPlain:
      "Merci pour votre retour.\n\nSi vous avez pu consulter l'étude, nous restons à votre disposition pour répondre à vos questions.\n\nLorsque vous souhaitez activer le changement d'assurance, répondez simplement à ce mail pour nous le confirmer : nous vous indiquerons alors les prochaines étapes.",
  },
  {
    tags: ["post-etude", "changement-assurance", "question-client"],
    situationSummary: "Client demande comment se passe la substitution après l'étude.",
    staffGuidance: "Expliquer les grandes étapes sans promettre de date. Pas de nom d'assureur.",
    clientMessagePattern: "substitution changement activer demarche banque etapes suite",
    approvedReplyPlain:
      "Si vous souhaitez poursuivre après l'étude, voici le principe :\n\n1. Vous nous confirmez par email que vous êtes d'accord pour avancer.\n2. Nous vous guidons pour la mise en place du nouveau contrat et les démarches auprès de votre banque.\n3. Nous restons disponibles par email à chaque étape.\n\nRépondez à ce mail lorsque vous êtes prêt(e) : nous adaptons la suite à votre situation.",
  },
  {
    tags: ["post-etude", "accord-client", "changement-assurance"],
    situationSummary: "Client donne son accord pour poursuivre le changement d'assurance.",
    staffGuidance: "Accuser accord. Prochaine étape : pièces identité si besoin, sans nom assureur.",
    clientMessagePattern: "accord d accord ok poursuivre valider accepter changement",
    approvedReplyPlain:
      "Merci pour votre confirmation, c'est bien noté.\n\nNous poursuivons la mise en place de votre dossier et nous revenons vers vous par email pour les prochaines étapes (documents complémentaires éventuels, formalités auprès de la banque).\n\nPour toute précision, répondez simplement à ce fil.",
  },
  {
    tags: ["post-etude", "identite", "accord-client"],
    situationSummary: "Client envoie ou demande quoi faire pour CNI et RIB après accord.",
    staffGuidance: "Accuser réception pièces identité. Pas de nom assureur.",
    clientMessagePattern: "cni rib identite iban passeport releve",
    approvedReplyPlain:
      "Merci pour votre message.\n\nSi vous nous transmettez votre pièce d'identité et votre RIB, nous les enregistrons pour la suite de votre dossier. Charles et notre équipe poursuivent la mise en place et vous recontactent par email pour la prochaine étape.\n\nPour toute question, répondez à ce mail.",
  },
  {
    tags: ["post-etude", "question-client", "kereis"],
    situationSummary: "Client a une question sur l'espace adhérent Kereis ou Docaposte.",
    staffGuidance: "Rassurer, renvoyer vers doc Drive espace adhérent. Pas de mot de passe par mail.",
    clientMessagePattern: "kereis adherent espace docaposte signature parcours etape",
    approvedReplyPlain:
      "Merci pour votre message.\n\nPour l'espace adhérent, suivez les étapes indiquées dans notre précédent email (parcours en plusieurs étapes, signature électronique si demandée).\n\nSi un message d'erreur s'affiche, décrivez-le en répondant à ce mail (capture d'écran utile) : nous vous guidons pas à pas.\n\nNe communiquez jamais de mot de passe par email.",
  },
  {
    tags: ["pre-etude", "remerciement"],
    situationSummary: "Client remercie ou accuse réception avant envoi de l'étude.",
    staffGuidance: "Réponse courte et chaleureuse. Rappeler que l'étude suivra.",
    clientMessagePattern: "merci bien recu message pris en compte",
    approvedReplyPlain:
      "Je vous en prie.\n\nVotre dossier est bien pris en charge : nous revenons vers vous par email dès que l'étude personnalisée est prête ou si nous avons besoin d'une précision sur vos documents.",
  },
  {
    tags: ["question-client"],
    situationSummary: "Client refuse poliment ou souhaite ne plus être contacté.",
    staffGuidance: "Respecter le choix sans insister. Clôturer poliment.",
    clientMessagePattern: "refus pas interesse stop ne plus contacter desistement",
    approvedReplyPlain:
      "Bien reçu, nous respectons tout à fait votre choix.\n\nNous clôturons le suivi de ce dossier côté assurance emprunteur. Si vous changez d'avis plus tard, vous pouvez nous réécrire à tout moment.\n\nJe vous souhaite une excellente continuation.",
  },
];

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
      seededAt: raw?.seededAt,
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

function invalidatePlaybookCache() {
  cachedStore = null;
  cachedAt = 0;
}

async function loadStoreFromFirestore(): Promise<PlaybookStore | null> {
  try {
    const { readDB } = await import("./db");
    const db = await readDB();
    const meta = db.dossiers.find((d: any) => d.id === META_DOSSIER_ID);
    const fromMeta = meta?.camillePlaybooksStore as PlaybookStore | undefined;
    if (fromMeta?.playbooks) return fromMeta;
  } catch {
    /* fallback */
  }
  return null;
}

async function saveStoreToFirestore(store: PlaybookStore) {
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

export async function loadPlaybookStore(): Promise<PlaybookStore> {
  if (cachedStore && Date.now() - cachedAt < STORE_CACHE_MS) return cachedStore;
  const fromFirestore = await loadStoreFromFirestore();
  const store = fromFirestore || loadStoreFromFile();
  cachedStore = store;
  cachedAt = Date.now();
  return store;
}

async function persistStore(store: PlaybookStore) {
  store.updatedAt = new Date().toISOString();
  saveStoreToFile(store);
  await saveStoreToFirestore(store);
  cachedStore = store;
  cachedAt = Date.now();
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
  if (/assurance|substitution|changement|activer|d.accord|lemoine/i.test(blob)) {
    tags.add("changement-assurance");
  }
  if (/[eé]conom|€|euro|tarif|co[uû]t|mensualit/i.test(blob)) tags.add("question-chiffrage");
  if (/question|savoir|inform|expliqu/i.test(blob)) tags.add("question-client");
  if (/merci|re[cç]u|bien re[cç]u/i.test(blob)) tags.add("remerciement");
  if (/kereis|docaposte|adh[eé]rent|espace adherent/i.test(blob)) tags.add("kereis");
  if (/etude|[eé]conom/i.test(blob)) tags.add("etude");
  if (/accord|valide|poursuiv|accepte/i.test(blob)) tags.add("accord-client");

  return [...tags];
}

function scorePlaybook(pb: CamillePlaybook, clientMessage: string, tags: string[]): number {
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

export async function findSimilarPlaybooks(
  clientMessage: string,
  dossier: any,
  limit = MAX_PROMPT_PLAYBOOKS,
): Promise<Array<{ playbook: CamillePlaybook; score: number }>> {
  const tags = extractSituationTags(dossier, clientMessage);
  const store = await loadPlaybookStore();
  return store.playbooks
    .map((pb) => ({ playbook: pb, score: scorePlaybook(pb, clientMessage, tags) }))
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function getPlaybookAutoReplyMinScore(): number {
  const n = Number(process.env.CAMILLE_PLAYBOOK_AUTO_SCORE || "6");
  return Number.isFinite(n) && n > 0 ? n : 6;
}

export function getPlaybookSeedVersion(): string {
  return PLAYBOOK_SEED_VERSION;
}

export async function tryPlaybookAutoReply(
  dossier: any,
  clientMessage: string,
): Promise<{ plain: string; playbook: CamillePlaybook } | null> {
  const store = await loadPlaybookStore();
  const tags = extractSituationTags(dossier, clientMessage);
  const matches = store.playbooks
    .map((pb) => ({ playbook: pb, score: scorePlaybook(pb, clientMessage, tags) }))
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 1);
  const top = matches[0];
  if (!top || top.score < getPlaybookAutoReplyMinScore()) return null;
  await incrementPlaybookUse(top.playbook.id);
  return { plain: top.playbook.approvedReplyPlain, playbook: top.playbook };
}

export async function buildPlaybooksPromptBlock(
  clientMessage: string,
  dossier: any,
): Promise<string> {
  const store = await loadPlaybookStore();
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

function anonymizeClientExcerpt(clientMessage: string): string {
  return String(clientMessage || "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(LCIF-\d{6})\b/gi, "[dossier]")
    .slice(0, 400);
}

export function htmlToPlainForPlaybook(html: string): string {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function saveApprovedPlaybook(params: {
  dossier: any;
  clientMessage: string;
  situationSummary: string;
  staffGuidance: string;
  approvedReplyPlain: string;
  approvedBy?: string;
  tags?: string[];
}): Promise<CamillePlaybook> {
  const store = await loadPlaybookStore();
  const tags =
    params.tags && params.tags.length > 0
      ? [...new Set(params.tags)]
      : extractSituationTags(params.dossier, params.clientMessage, params.staffGuidance);

  const pb: CamillePlaybook = {
    id: `pb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tags,
    situationSummary: params.situationSummary.slice(0, 500),
    staffGuidance: params.staffGuidance.slice(0, 800),
    clientMessagePattern: anonymizeClientExcerpt(params.clientMessage),
    approvedReplyPlain: params.approvedReplyPlain.slice(0, 4000),
    approvedAt: new Date().toISOString(),
    approvedBy: params.approvedBy,
    dossierId: params.dossier?.id,
    useCount: 0,
  };

  store.playbooks.unshift(pb);
  store.playbooks = store.playbooks.slice(0, MAX_PLAYBOOKS);
  await persistStore(store);
  console.log(`[Camille playbooks] enregistré ${pb.id} (${tags.join(", ")})`);
  return pb;
}

export async function updatePlaybook(
  id: string,
  patch: Partial<
    Pick<
      CamillePlaybook,
      | "tags"
      | "situationSummary"
      | "staffGuidance"
      | "clientMessagePattern"
      | "approvedReplyPlain"
    >
  >,
): Promise<CamillePlaybook | null> {
  const store = await loadPlaybookStore();
  const pb = store.playbooks.find((p) => p.id === id);
  if (!pb) return null;
  if (patch.tags) pb.tags = patch.tags.slice(0, 20);
  if (patch.situationSummary != null) pb.situationSummary = patch.situationSummary.slice(0, 500);
  if (patch.staffGuidance != null) pb.staffGuidance = patch.staffGuidance.slice(0, 800);
  if (patch.clientMessagePattern != null) {
    pb.clientMessagePattern = patch.clientMessagePattern.slice(0, 400);
  }
  if (patch.approvedReplyPlain != null) pb.approvedReplyPlain = patch.approvedReplyPlain.slice(0, 4000);
  await persistStore(store);
  return pb;
}

export async function deletePlaybook(id: string): Promise<boolean> {
  const store = await loadPlaybookStore();
  const before = store.playbooks.length;
  store.playbooks = store.playbooks.filter((p) => p.id !== id);
  if (store.playbooks.length === before) return false;
  await persistStore(store);
  return true;
}

async function incrementPlaybookUse(id: string) {
  const store = await loadPlaybookStore();
  const pb = store.playbooks.find((p) => p.id === id);
  if (!pb) return;
  pb.useCount = (pb.useCount || 0) + 1;
  pb.lastUsedAt = new Date().toISOString();
  await persistStore(store);
}

export async function listPlaybooks(limit = 50): Promise<CamillePlaybook[]> {
  const store = await loadPlaybookStore();
  return store.playbooks.slice(0, limit);
}

export async function seedDefaultPlaybooksIfEmpty(force = false): Promise<{ added: number; total: number }> {
  const store = await loadPlaybookStore();
  const versionStale = store.seedVersion !== PLAYBOOK_SEED_VERSION;

  let added = 0;
  for (const seed of DEFAULT_SEED_PLAYBOOKS) {
    const exists = store.playbooks.some(
      (pb) => normalizeText(pb.situationSummary) === normalizeText(seed.situationSummary),
    );
    if (exists && !force) continue;
    if (exists && force) continue;
    store.playbooks.push({
      ...seed,
      id: `pb_seed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      approvedAt: new Date().toISOString(),
      approvedBy: "system_seed",
      useCount: 0,
    });
    added += 1;
  }
  if (added > 0 || versionStale || force) {
    store.playbooks = store.playbooks.slice(0, MAX_PLAYBOOKS);
    store.seededAt = new Date().toISOString();
    store.seedVersion = PLAYBOOK_SEED_VERSION;
    await persistStore(store);
  }
  if (added > 0 || versionStale) {
    console.log(
      `[Camille playbooks] seed +${added} (version=${PLAYBOOK_SEED_VERSION}) total=${store.playbooks.length}`,
    );
  }
  return { added, total: store.playbooks.length };
}

/** Enregistre la dernière réponse Camille/équipe comme playbook depuis un dossier. */
export async function savePlaybookFromDossierLastReply(params: {
  dossier: any;
  situationSummary?: string;
  staffGuidance?: string;
  approvedBy?: string;
}): Promise<CamillePlaybook | null> {
  const comms = [...(params.dossier.communications || [])].sort(
    (a: any, b: any) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime(),
  );
  const lastOutbound = comms.find((c: any) => c.direction === "outbound");
  const lastInbound = comms.find((c: any) => c.direction === "inbound");
  if (!lastOutbound?.text) return null;

  return saveApprovedPlaybook({
    dossier: params.dossier,
    clientMessage: String(lastInbound?.text || lastInbound?.subject || ""),
    situationSummary:
      params.situationSummary ||
      `Mail client : « ${String(lastInbound?.text || lastInbound?.subject || "").slice(0, 120)} »`,
    staffGuidance:
      params.staffGuidance ||
      "Réponse validée par l'équipe — réutiliser le fond pour des situations similaires.",
    approvedReplyPlain: htmlToPlainForPlaybook(String(lastOutbound.text || "")),
    approvedBy: params.approvedBy,
  });
}

void seedDefaultPlaybooksIfEmpty().catch((e) => {
  console.warn("[Camille playbooks] seed init:", e?.message || e);
});
