import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateId() {
  // Simple UUID using math.random for the frontend
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

/**
 * Enregistrement des clics lien ?ref= — appelle toujours l'API Railway (CORS autorisé).
 * Le proxy Vercel /api/ref-click reste disponible en secours mais n'est plus utilisé par défaut.
 */
export function getRefClickUrl(): string {
  return getApiUrl("/api/ref-click");
}

export function getApiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  // VITE_API_URL: backend Railway/Render URL when frontend is on Vercel
  const apiBase = import.meta.env.VITE_API_URL as string | undefined;
  if (apiBase?.startsWith('http')) {
    const base = apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase;
    return `${base}${cleanPath}`;
  }

  // Fallback: same-origin (local dev or monolithic deploy)
  let detectedOrigin = '';
  try {
    const envAppUrl = (process.env as any).APP_URL;
    if (envAppUrl && envAppUrl.startsWith('http')) {
      detectedOrigin = envAppUrl;
    }
  } catch {
    // ignore
  }

  if (detectedOrigin) {
    const base = detectedOrigin.endsWith('/') ? detectedOrigin.slice(0, -1) : detectedOrigin;
    return `${base}${cleanPath}`;
  }

  return cleanPath;
}

export const CONSEILLER_SESSION_STORAGE_KEY = "lcif_conseiller_sess";

export function getConseillerSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(CONSEILLER_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setConseillerSessionToken(token: string): void {
  try {
    localStorage.setItem(CONSEILLER_SESSION_STORAGE_KEY, token);
  } catch {
    /* ignore */
  }
}

export function clearConseillerSessionToken(): void {
  try {
    localStorage.removeItem(CONSEILLER_SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Fetch API avec session conseiller (Bearer + cookie si disponible). */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const session = getConseillerSessionToken();
  if (session && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${session}`);
  }
  return fetch(getApiUrl(path), { ...init, credentials: "include", headers });
}
