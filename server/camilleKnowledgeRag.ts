import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import { isProcessKnowledgeFile } from "./camilleKnowledgeDrive";
import {
  extractUsageFromEmbedResponse,
  makeUsageEvent,
  recordGeminiUsageEvent,
} from "./geminiUsage";

export type KnowledgeChunk = {
  id: string;
  fileName: string;
  kind: "process" | "product";
  tags: string[];
  text: string;
  embedding: number[];
};

export type KnowledgeIndex = {
  syncedAt: string;
  folderId: string;
  embedModel: string;
  chunkCount: number;
  chunks: KnowledgeChunk[];
};

export type ParsedKnowledgeFile = {
  name: string;
  text: string;
  kind: "process" | "product";
};

const DEFAULT_EMBED_MODEL = "gemini-embedding-001";
const CHUNK_TARGET = 750;
const CHUNK_MAX = 1_100;
const EMBED_BATCH = 16;

function getIndexPath(dataDir: string) {
  return path.join(dataDir, "camille-knowledge-index.json");
}

function ragEnabled(): boolean {
  const raw = String(process.env.CAMILLE_KNOWLEDGE_RAG_ENABLED ?? "true").toLowerCase();
  return raw !== "false" && raw !== "0";
}

function getEmbedModel(): string {
  return process.env.CAMILLE_KNOWLEDGE_EMBED_MODEL || DEFAULT_EMBED_MODEL;
}

function getTopK(): number {
  const n = Number(process.env.CAMILLE_KNOWLEDGE_RAG_TOP_K || 5);
  return Number.isFinite(n) ? Math.min(8, Math.max(2, n)) : 5;
}

function getMaxRetrievedChars(): number {
  const n = Number(process.env.CAMILLE_KNOWLEDGE_RAG_MAX_CHARS || 9_000);
  return Number.isFinite(n) ? n : 9_000;
}

function normalizeForMatch(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function inferChunkTags(fileName: string, text: string): string[] {
  const blob = normalizeForMatch(`${fileName} ${text.slice(0, 400)}`);
  const tags = new Set<string>();
  if (isProcessKnowledgeFile(fileName)) tags.add("process");
  else tags.add("product");
  if (/kereis|espace.adherent|espace adherent|docaposte|attestation/.test(blob)) tags.add("kereis");
  if (/script|objection|ade|lemoine|frais|courtage/.test(blob)) tags.add("scripts");
  if (/substitution|resiliation|iban|delegation/.test(blob)) tags.add("substitution");
  if (/questionnaire|sante|aeras|medical/.test(blob)) tags.add("sante");
  if (/garantie|decès|deces|ipt|itt|ptia|notice|dip/.test(blob)) tags.add("garanties");
  if (/delai|semaine|jour|effet/.test(blob)) tags.add("delais");
  return [...tags];
}

/** Découpe un texte long en chunks ~750 caractères (paragraphes). */
export function chunkKnowledgeText(fileName: string, fullText: string, kind: "process" | "product"): Omit<KnowledgeChunk, "embedding">[] {
  const clean = fullText.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  const paragraphs = clean.split(/\n{2,}/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  const chunks: string[] = [];
  let buf = "";

  const flush = () => {
    const t = buf.trim();
    if (t.length >= 80) chunks.push(t);
    buf = "";
  };

  for (const p of paragraphs) {
    if (p.length > CHUNK_MAX) {
      flush();
      for (let i = 0; i < p.length; i += CHUNK_TARGET) {
        chunks.push(p.slice(i, i + CHUNK_MAX));
      }
      continue;
    }
    if ((buf + "\n\n" + p).length > CHUNK_TARGET && buf) flush();
    buf = buf ? `${buf}\n\n${p}` : p;
  }
  flush();

  if (chunks.length === 0 && clean.length >= 40) chunks.push(clean.slice(0, CHUNK_MAX));

  return chunks.map((text, idx) => ({
    id: `${fileName}#${idx}`,
    fileName,
    kind,
    tags: inferChunkTags(fileName, text),
    text,
  }));
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes("MY_GEMINI")) {
    throw new Error("GEMINI_API_KEY manquante pour les embeddings RAG");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = getEmbedModel();
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const res = await ai.models.embedContent({
      model,
      contents: batch,
      config: { taskType: "RETRIEVAL_DOCUMENT" },
    });
    try {
      const usage = extractUsageFromEmbedResponse(res);
      recordGeminiUsageEvent(
        dataDirFallback(),
        makeUsageEvent({
          operation: "embed",
          model,
          responseUsage: usage,
          estimatedTotalTokens: usage.totalTokens,
          meta: { taskType: "RETRIEVAL_DOCUMENT", batchSize: batch.length },
        }),
      );
    } catch {
      /* best-effort */
    }
    const embeddings = res.embeddings || [];
    for (const emb of embeddings) {
      out.push(emb.values || []);
    }
  }
  return out;
}

async function embedQuery(text: string): Promise<number[]> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const res = await ai.models.embedContent({
    model: getEmbedModel(),
    contents: [text.slice(0, 2_000)],
    config: { taskType: "RETRIEVAL_QUERY" },
  });
  try {
    const usage = extractUsageFromEmbedResponse(res);
    recordGeminiUsageEvent(
      dataDirFallback(),
      makeUsageEvent({
        operation: "embed",
        model: getEmbedModel(),
        responseUsage: usage,
        estimatedTotalTokens: usage.totalTokens,
        meta: { taskType: "RETRIEVAL_QUERY" },
      }),
    );
  } catch {
    /* best-effort */
  }
  return res.embeddings?.[0]?.values || [];
}

function dataDirFallback(): string {
  try {
    // same base as DB file (Railway/Vercel: /tmp/data/db.json)
    const { getDbFilePath } = require("./db") as typeof import("./db");
    return path.dirname(getDbFilePath());
  } catch {
    return process.env.VERCEL || process.env.RAILWAY_ENVIRONMENT ? "/tmp/data" : path.join(process.cwd(), "data");
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function keywordBoost(queryNorm: string, tags: string[]): number {
  let boost = 0;
  if (tags.includes("kereis") && /kereis|espace|adhesion|adherent|docaposte|cgu|attestation/.test(queryNorm)) {
    boost += 0.12;
  }
  if (tags.includes("scripts") && /pourquoi|legal|lemoine|frais|banque|objection|gratuit|economi/.test(queryNorm)) {
    boost += 0.1;
  }
  if (tags.includes("substitution") && /substitut|changer|delegation|banque/.test(queryNorm)) boost += 0.08;
  if (tags.includes("sante") && /sante|medical|questionnaire|aeras/.test(queryNorm)) boost += 0.1;
  if (tags.includes("garanties") && /garantie|deces|ipt|itt|couverture/.test(queryNorm)) boost += 0.08;
  if (tags.includes("process") && /ou en|etape|dossier|suite|apres/.test(queryNorm)) boost += 0.06;
  return boost;
}

export function loadKnowledgeIndex(dataDir: string): KnowledgeIndex | null {
  try {
    const p = getIndexPath(dataDir);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8")) as KnowledgeIndex;
  } catch {
    return null;
  }
}

export function saveKnowledgeIndex(dataDir: string, index: KnowledgeIndex) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(getIndexPath(dataDir), JSON.stringify(index), "utf-8");
}

export async function buildKnowledgeIndexFromFiles(
  files: ParsedKnowledgeFile[],
  folderId: string,
  dataDir: string,
): Promise<KnowledgeIndex> {
  const bareChunks: Omit<KnowledgeChunk, "embedding">[] = [];
  for (const f of files) {
    bareChunks.push(...chunkKnowledgeText(f.name, f.text, f.kind));
  }

  const texts = bareChunks.map((c) => c.text);
  const embeddings = texts.length ? await embedTexts(texts) : [];

  const chunks: KnowledgeChunk[] = bareChunks.map((c, i) => ({
    ...c,
    embedding: embeddings[i] || [],
  }));

  const index: KnowledgeIndex = {
    syncedAt: new Date().toISOString(),
    folderId,
    embedModel: getEmbedModel(),
    chunkCount: chunks.length,
    chunks,
  };

  saveKnowledgeIndex(dataDir, index);
  console.log(`[Camille knowledge RAG] Index : ${chunks.length} chunk(s), modèle ${index.embedModel}.`);
  return index;
}

export type RetrieveKnowledgeOptions = {
  clientMessage?: string;
  subscriptionPhase?: string | null;
  studySent?: boolean;
  topK?: number;
};

export type RetrievedChunk = {
  id: string;
  fileName: string;
  score: number;
  text: string;
  tags: string[];
};

function buildRetrievalQuery(options: RetrieveKnowledgeOptions): string {
  const parts: string[] = [];
  if (options.clientMessage?.trim()) parts.push(options.clientMessage.trim());
  if (options.studySent) parts.push("étude assurance emprunteur envoyée substitution souscription");
  if (options.subscriptionPhase) {
    parts.push(`phase souscription ${options.subscriptionPhase}`);
  }
  return parts.join("\n").slice(0, 2_500) || "assurance emprunteur documentation";
}

export async function retrieveKnowledgeChunks(
  dataDir: string,
  options: RetrieveKnowledgeOptions,
): Promise<RetrievedChunk[]> {
  if (!ragEnabled()) return [];

  const index = loadKnowledgeIndex(dataDir);
  if (!index?.chunks?.length) return [];

  const query = buildRetrievalQuery(options);
  const queryNorm = normalizeForMatch(query);

  let queryEmbedding: number[] = [];
  try {
    queryEmbedding = await embedQuery(query);
  } catch (e: any) {
    console.warn("[Camille knowledge RAG] Embedding requête:", e?.message || e);
    return lexicalFallback(index, queryNorm, options.topK || getTopK());
  }

  const scored = index.chunks
    .map((c) => {
      const sim = cosineSimilarity(queryEmbedding, c.embedding);
      const boost = keywordBoost(queryNorm, c.tags);
      const processBoost = c.kind === "process" && /kereis|espace|script|substitution|adhesion/.test(queryNorm) ? 0.05 : 0;
      return {
        id: c.id,
        fileName: c.fileName,
        text: c.text,
        tags: c.tags,
        score: sim + boost + processBoost,
      };
    })
    .sort((a, b) => b.score - a.score);

  const topK = options.topK || getTopK();
  const maxChars = getMaxRetrievedChars();
  const picked: RetrievedChunk[] = [];
  let used = 0;

  for (const row of scored) {
    if (picked.length >= topK) break;
    if (used + row.text.length > maxChars && picked.length > 0) break;
    picked.push(row);
    used += row.text.length;
  }

  return picked;
}

function lexicalFallback(
  index: KnowledgeIndex,
  queryNorm: string,
  topK: number,
): RetrievedChunk[] {
  const terms = queryNorm.split(/[^a-z0-9]+/).filter((t) => t.length > 3);
  if (!terms.length) return [];

  return index.chunks
    .map((c) => {
      const blob = normalizeForMatch(c.text);
      let score = 0;
      for (const t of terms) {
        if (blob.includes(t)) score += 1;
      }
      score += keywordBoost(queryNorm, c.tags);
      return { id: c.id, fileName: c.fileName, text: c.text, tags: c.tags, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export function formatRetrievedChunksForPrompt(chunks: RetrievedChunk[]): string {
  if (!chunks.length) return "";
  const lines = chunks.map(
    (c, i) =>
      `[${i + 1}] ${c.fileName} (score ${c.score.toFixed(3)}, tags: ${c.tags.join(", ") || "—"})\n${c.text}`,
  );
  return [
    "EXTRAITS DOCUMENTATION DRIVE (sélection RAG — les plus pertinents pour CE mail, utiliser en priorité) :",
    lines.join("\n\n"),
  ].join("\n");
}

export function getKnowledgeIndexStatus(dataDir: string) {
  const index = loadKnowledgeIndex(dataDir);
  return {
    ragEnabled: ragEnabled(),
    embedModel: getEmbedModel(),
    chunkCount: index?.chunkCount ?? 0,
    syncedAt: index?.syncedAt ?? null,
    folderId: index?.folderId ?? null,
  };
}
