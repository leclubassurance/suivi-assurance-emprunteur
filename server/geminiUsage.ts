import fs from "fs";
import path from "path";

export type GeminiUsageEvent = {
  at: string;
  operation: "generate" | "embed";
  model: string;
  /** Tokens si fournis par l'API, sinon null. */
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  /** Estimation interne quand tokens inconnus. */
  estimatedTotalTokens: number | null;
  /** Estimation en USD (approx) quand tokens dispo ou estimés. */
  estimatedUsd: number | null;
  meta?: Record<string, unknown>;
};

export type GeminiUsageSummary = {
  sinceIso: string;
  events: GeminiUsageEvent[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedTotalTokens: number;
    estimatedUsd: number;
    byModel: Record<
      string,
      {
        calls: number;
        totalTokens: number;
        estimatedTotalTokens: number;
        estimatedUsd: number;
      }
    >;
    byOperation: Record<
      string,
      {
        calls: number;
        totalTokens: number;
        estimatedTotalTokens: number;
        estimatedUsd: number;
      }
    >;
  };
};

function usageLogPath(dataDir: string) {
  return path.join(dataDir, "gemini-usage.ndjson");
}

function clampEvents(events: GeminiUsageEvent[], max: number) {
  return events.length > max ? events.slice(events.length - max) : events;
}

function safeNumber(x: unknown): number | null {
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Approx tokens ~ chars/4 pour FR/EN (heuristique).
 * Suffisant pour un tableau de bord et trend, pas pour facturation officielle.
 */
export function estimateTokensFromText(text: string): number {
  const s = String(text || "");
  const chars = s.length;
  return Math.max(1, Math.round(chars / 4));
}

/**
 * Estimation USD très grossière (ordre de grandeur).
 * Objectif: détecter la conso "idle" et comparer avant/après optimisations.
 *
 * Les prix varient selon offres/projets. Ajustables via env.
 */
function estimateUsd(params: {
  operation: "generate" | "embed";
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedTotalTokens: number | null;
}): number | null {
  const inTok = params.inputTokens ?? null;
  const outTok = params.outputTokens ?? null;
  const tot = params.estimatedTotalTokens ?? (inTok != null && outTok != null ? inTok + outTok : null);
  if (tot == null) return null;

  const op = params.operation;
  // Defaults conservateurs (flash) — override par env si besoin.
  const genUsdPer1M =
    safeNumber(process.env.GEMINI_COST_GENERATE_USD_PER_1M) ?? 0.35;
  const embedUsdPer1M =
    safeNumber(process.env.GEMINI_COST_EMBED_USD_PER_1M) ?? 0.10;

  const usdPer1M = op === "embed" ? embedUsdPer1M : genUsdPer1M;
  return Math.round((tot / 1_000_000) * usdPer1M * 10000) / 10000;
}

export function recordGeminiUsageEvent(dataDir: string, ev: GeminiUsageEvent) {
  try {
    if (!dataDir) return;
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.appendFileSync(usageLogPath(dataDir), `${JSON.stringify(ev)}\n`, "utf-8");
  } catch {
    // best-effort: ne jamais casser l'app
  }
}

function readEvents(dataDir: string, sinceMs: number): GeminiUsageEvent[] {
  const p = usageLogPath(dataDir);
  if (!fs.existsSync(p)) return [];
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const out: GeminiUsageEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as GeminiUsageEvent;
        const t = new Date(row.at || 0).getTime();
        if (!Number.isFinite(t) || t < sinceMs) continue;
        out.push(row);
      } catch {
        // ignore bad line
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function buildGeminiUsageSummary(dataDir: string, days = 14): GeminiUsageSummary {
  const daysClamped = Number.isFinite(days) ? Math.min(90, Math.max(1, Math.round(days))) : 14;
  const sinceMs = Date.now() - daysClamped * 24 * 3600 * 1000;
  const events = clampEvents(readEvents(dataDir, sinceMs), 2000);

  const totals: GeminiUsageSummary["totals"] = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedTotalTokens: 0,
    estimatedUsd: 0,
    byModel: {},
    byOperation: {},
  };

  const bump = (
    bucket: Record<string, { calls: number; totalTokens: number; estimatedTotalTokens: number; estimatedUsd: number }>,
    key: string,
    row: GeminiUsageEvent,
  ) => {
    if (!bucket[key]) bucket[key] = { calls: 0, totalTokens: 0, estimatedTotalTokens: 0, estimatedUsd: 0 };
    bucket[key].calls += 1;
    bucket[key].totalTokens += row.totalTokens || 0;
    bucket[key].estimatedTotalTokens += row.estimatedTotalTokens || 0;
    bucket[key].estimatedUsd += row.estimatedUsd || 0;
  };

  for (const e of events) {
    totals.inputTokens += e.inputTokens || 0;
    totals.outputTokens += e.outputTokens || 0;
    totals.totalTokens += e.totalTokens || 0;
    totals.estimatedTotalTokens += e.estimatedTotalTokens || 0;
    totals.estimatedUsd += e.estimatedUsd || 0;
    bump(totals.byModel, e.model || "unknown", e);
    bump(totals.byOperation, e.operation || "unknown", e);
  }

  totals.estimatedUsd = Math.round(totals.estimatedUsd * 10000) / 10000;

  return {
    sinceIso: new Date(sinceMs).toISOString(),
    events,
    totals,
  };
}

export function extractUsageFromGenerateResponse(response: any): {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
} {
  const u =
    response?.usageMetadata ||
    response?.response?.usageMetadata ||
    response?.candidates?.[0]?.usageMetadata ||
    null;

  const inputTokens =
    safeNumber(u?.promptTokenCount) ??
    safeNumber(u?.inputTokenCount) ??
    safeNumber(u?.promptTokens) ??
    null;

  const outputTokens =
    safeNumber(u?.candidatesTokenCount) ??
    safeNumber(u?.outputTokenCount) ??
    safeNumber(u?.completionTokens) ??
    null;

  const totalTokens =
    safeNumber(u?.totalTokenCount) ??
    (inputTokens != null && outputTokens != null ? inputTokens + outputTokens : null);

  return { inputTokens, outputTokens, totalTokens };
}

export function extractUsageFromEmbedResponse(response: any): {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
} {
  const u = response?.usageMetadata || response?.response?.usageMetadata || null;
  const inputTokens = safeNumber(u?.promptTokenCount) ?? safeNumber(u?.inputTokenCount) ?? null;
  const totalTokens = safeNumber(u?.totalTokenCount) ?? inputTokens;
  return { inputTokens, outputTokens: 0, totalTokens };
}

export function makeUsageEvent(params: {
  operation: "generate" | "embed";
  model: string;
  responseUsage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
  estimatedTotalTokens: number | null;
  meta?: Record<string, unknown>;
}): GeminiUsageEvent {
  const { inputTokens, outputTokens, totalTokens } = params.responseUsage;
  const estimatedUsd = estimateUsd({
    operation: params.operation,
    model: params.model,
    inputTokens,
    outputTokens,
    estimatedTotalTokens: params.estimatedTotalTokens,
  });
  return {
    at: new Date().toISOString(),
    operation: params.operation,
    model: params.model || "unknown",
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedTotalTokens: params.estimatedTotalTokens,
    estimatedUsd,
    meta: params.meta,
  };
}

