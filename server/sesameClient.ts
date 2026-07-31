/**
 * Client HTTP Sésame (Kereis) — Basic Auth.
 * Lab / test : SESAME_ENV=test (défaut). Pas d'appels prod depuis le lab.
 */
export type SesameEnvMode = "test" | "production";

export type SesameConfigStatus = {
  env: SesameEnvMode;
  baseUrl: string;
  basicAuthConfigured: boolean;
  codeEntite: string | null;
  defaultCodeOffre: string | null;
  labAllowed: boolean;
  missing: string[];
};

export type SesameRequestResult<T = unknown> = {
  ok: boolean;
  status: number;
  durationMs: number;
  requestId?: string;
  data?: T;
  error?: string;
  contentType?: string;
  /** Réponse binaire (PDF devis) en base64 */
  binaryBase64?: string;
};

function env(name: string): string {
  return String((process.env as any)[name] || "").trim();
}

export function getSesameEnvMode(): SesameEnvMode {
  const raw = env("SESAME_ENV").toLowerCase();
  return raw === "production" ? "production" : "test";
}

export function getSesameBaseUrl(): string {
  return (
    env("SESAME_BASE_URL").replace(/\/$/, "") ||
    "https://wwwsesame-r1.cbp-solutions.fr"
  );
}

export function getSesameConfigStatus(): SesameConfigStatus {
  const mode = getSesameEnvMode();
  const user = env("SESAME_BASIC_USER");
  const pass = env("SESAME_BASIC_PASSWORD");
  const codeEntite = env("SESAME_CODE_ENTITE") || null;
  const defaultCodeOffre = env("SESAME_DEFAULT_CODE_OFFRE") || null;
  const missing: string[] = [];
  if (!user) missing.push("SESAME_BASIC_USER");
  if (!pass) missing.push("SESAME_BASIC_PASSWORD");
  if (!codeEntite) missing.push("SESAME_CODE_ENTITE");
  return {
    env: mode,
    baseUrl: getSesameBaseUrl(),
    basicAuthConfigured: Boolean(user && pass),
    codeEntite,
    defaultCodeOffre,
    labAllowed: mode !== "production",
    missing,
  };
}

function basicAuthHeader(): string | null {
  const user = env("SESAME_BASIC_USER");
  const pass = env("SESAME_BASIC_PASSWORD");
  if (!user || !pass) return null;
  return `Basic ${Buffer.from(`${user}:${pass}`, "utf8").toString("base64")}`;
}

export function assertSesameLabAllowed(): void {
  if (getSesameEnvMode() === "production") {
    throw new Error(
      "Lab Sésame désactivé : SESAME_ENV=production. Passez SESAME_ENV=test pour le lab admin.",
    );
  }
  const auth = basicAuthHeader();
  if (!auth) {
    throw new Error("Credentials Sésame manquants (SESAME_BASIC_USER / SESAME_BASIC_PASSWORD).");
  }
}

const PARTENAIRES_PREFIX = "/sesame/public/secure/services/partenaires";

function formatSesameErrorMessage(status: number, payload: any, rawText?: string): string {
  if (payload && typeof payload === "object") {
    const parts: string[] = [];
    const main = payload.message || payload.error || payload.title || payload.detail;
    if (main) parts.push(String(main));
    const errors = payload.errors || payload.violations || payload.fieldErrors;
    if (Array.isArray(errors) && errors.length) {
      parts.push(
        errors
          .slice(0, 8)
          .map((e: any) => {
            if (typeof e === "string") return e;
            const field = e?.field || e?.path || e?.property || e?.code || "";
            const msg = e?.message || e?.defaultMessage || e?.msg || JSON.stringify(e);
            return field ? `${field}: ${msg}` : String(msg);
          })
          .join(" · "),
      );
    }
    if (parts.length) return parts.join(" — ");
  }
  if (rawText?.trim()) return rawText.trim().slice(0, 500);
  return `HTTP ${status}`;
}

export async function sesameFetchJson<T = unknown>(params: {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  timeoutMs?: number;
}): Promise<SesameRequestResult<T>> {
  assertSesameLabAllowed();
  const auth = basicAuthHeader()!;
  const base = getSesameBaseUrl();
  const path = params.path.startsWith("/") ? params.path : `/${params.path}`;
  const url = new URL(`${base}${PARTENAIRES_PREFIX}${path}`);
  if (params.query) {
    for (const [k, v] of Object.entries(params.query)) {
      if (v != null && v !== "") url.searchParams.set(k, v);
    }
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 60_000);

  try {
    const res = await fetch(url.toString(), {
      method: params.method,
      headers: {
        Authorization: auth,
        Accept: "application/json",
        ...(params.body != null ? { "Content-Type": "application/json" } : {}),
      },
      body: params.body != null ? JSON.stringify(params.body) : undefined,
      signal: controller.signal,
    });
    const durationMs = Date.now() - started;
    const contentType = res.headers.get("content-type") || "";
    const requestId =
      res.headers.get("x-request-id") ||
      res.headers.get("request-id") ||
      undefined;

    if (contentType.includes("application/pdf") || contentType.includes("octet-stream")) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          durationMs,
          requestId,
          contentType,
          error: `HTTP ${res.status} (réponse binaire)`,
        };
      }
      return {
        ok: true,
        status: res.status,
        durationMs,
        requestId,
        contentType,
        binaryBase64: buf.toString("base64"),
      };
    }

    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text ? { raw: text.slice(0, 2000) } : null;
    }

    const errMsg = !res.ok ? formatSesameErrorMessage(res.status, data, text) : undefined;

    return {
      ok: res.ok,
      status: res.status,
      durationMs,
      requestId: requestId || (data && data.requestId) || undefined,
      data: data as T,
      contentType,
      error: errMsg,
    };
  } catch (err: any) {
    const durationMs = Date.now() - started;
    const aborted = err?.name === "AbortError";
    return {
      ok: false,
      status: 0,
      durationMs,
      error: aborted ? `Timeout (${params.timeoutMs ?? 60_000}ms)` : err?.message || String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function sesameFetchPdf(params: {
  path: string;
  body: unknown;
  query?: Record<string, string | undefined>;
  timeoutMs?: number;
}): Promise<SesameRequestResult> {
  assertSesameLabAllowed();
  const auth = basicAuthHeader()!;
  const base = getSesameBaseUrl();
  const path = params.path.startsWith("/") ? params.path : `/${params.path}`;
  const url = new URL(`${base}${PARTENAIRES_PREFIX}${path}`);
  if (params.query) {
    for (const [k, v] of Object.entries(params.query)) {
      if (v != null && v !== "") url.searchParams.set(k, v);
    }
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 90_000);

  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: auth,
        Accept: "application/pdf, application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params.body),
      signal: controller.signal,
    });
    const durationMs = Date.now() - started;
    const contentType = res.headers.get("content-type") || "";
    const requestId =
      res.headers.get("x-request-id") ||
      res.headers.get("request-id") ||
      undefined;

    if (!res.ok) {
      const text = await res.text();
      let parsed: any = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      console.warn(
        `[Sesame] ${params.path} → ${res.status} (${durationMs}ms)`,
        formatSesameErrorMessage(res.status, parsed, text),
      );
      return {
        ok: false,
        status: res.status,
        durationMs,
        requestId: requestId || parsed?.requestId,
        error: formatSesameErrorMessage(res.status, parsed, text),
        data: parsed || (text ? { raw: text.slice(0, 2000) } : undefined),
        contentType,
      };
    }

    const buf = Buffer.from(await res.arrayBuffer());
    return {
      ok: true,
      status: res.status,
      durationMs,
      requestId,
      contentType,
      binaryBase64: buf.toString("base64"),
    };
  } catch (err: any) {
    const durationMs = Date.now() - started;
    const aborted = err?.name === "AbortError";
    return {
      ok: false,
      status: 0,
      durationMs,
      error: aborted ? `Timeout (${params.timeoutMs ?? 90_000}ms)` : err?.message || String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}
