import {
  buildGouvEntrepriseSearchQueries,
  buildGouvEntrepriseSearchUrl,
  GOUV_ENTREPRISE_USER_AGENT,
  parseGouvEntrepriseSearchResponse,
  type GouvEntrepriseMatch,
  type GouvSearchResponse,
} from "../shared/gouvEntrepriseSearch";
import { normalizeSiretInput } from "../shared/siret";
import { isInseeSireneConfigured, lookupFrenchCompanyViaInsee } from "./inseeSireneLookup";

export type SireneCompanyMatch = GouvEntrepriseMatch;

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; match: GouvEntrepriseMatch | null }>();

function cacheKey(normalized: string): string {
  return normalized;
}

function readCache(normalized: string): GouvEntrepriseMatch | null | undefined {
  const hit = cache.get(cacheKey(normalized));
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    cache.delete(cacheKey(normalized));
    return undefined;
  }
  return hit.match;
}

function writeCache(normalized: string, match: GouvEntrepriseMatch | null): void {
  cache.set(cacheKey(normalized), { expiresAt: Date.now() + CACHE_TTL_MS, match });
}

async function fetchGouvSearch(q: string): Promise<GouvSearchResponse> {
  const url = buildGouvEntrepriseSearchUrl(q);
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": GOUV_ENTREPRISE_USER_AGENT,
    },
    signal: AbortSignal.timeout(12_000),
  });

  if (res.status === 429) {
    const retryAfter = res.headers.get("Retry-After");
    throw new Error(
      retryAfter
        ? `Service gouv temporairement saturé. Réessayez dans ${retryAfter} secondes.`
        : "Service gouv temporairement saturé. Réessayez dans quelques instants.",
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn("[SIRET] API gouv erreur", res.status, q, body.slice(0, 200));
    throw new Error(
      res.status === 403
        ? "Accès refusé par l'API entreprises (souvent lié à l'hébergeur cloud). Réessayez depuis le bouton Vérifier."
        : `Service de vérification SIREN/SIRET indisponible (${res.status}).`,
    );
  }

  return (await res.json()) as GouvSearchResponse;
}

async function lookupFrenchCompanyViaGouv(normalized: string): Promise<GouvEntrepriseMatch | null> {
  const queries = buildGouvEntrepriseSearchQueries(normalized);
  let lastError: Error | null = null;

  for (const q of queries) {
    try {
      const data = await fetchGouvSearch(q);
      const match = parseGouvEntrepriseSearchResponse(data, normalized);
      if (match) return match;
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.message.includes("saturé") || lastError.message.includes("indisponible")) {
        throw lastError;
      }
    }
  }

  if (lastError && lastError.message.includes("Accès refusé")) throw lastError;
  return null;
}

export async function lookupFrenchCompany(query: string): Promise<SireneCompanyMatch | null> {
  const normalized = normalizeSiretInput(query);
  if (!/^\d{9}$/.test(normalized) && !/^\d{14}$/.test(normalized)) {
    throw new Error("Saisissez un SIREN (9 chiffres) ou un SIRET (14 chiffres).");
  }

  const cached = readCache(normalized);
  if (cached !== undefined) return cached;

  if (isInseeSireneConfigured()) {
    try {
      const match = await lookupFrenchCompanyViaInsee(normalized);
      writeCache(normalized, match);
      return match;
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[SIRET] API INSEE échec, repli API gouv:", msg);
      if (
        msg.includes("Clé API INSEE") ||
        msg.includes("non configurée") ||
        msg.includes("Quota API INSEE")
      ) {
        throw err;
      }
    }
  }

  const match = await lookupFrenchCompanyViaGouv(normalized);
  writeCache(normalized, match);
  return match;
}
