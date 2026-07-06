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
 * Clics lien ?ref= : en prod Vercel, passe par /api/ref-click (fonction edge MaxMind)
 * au lieu d'appeler Railway directement (geoip-lite moins précis).
 */
export function getRefClickUrl(): string {
  const apiBase = import.meta.env.VITE_API_URL as string | undefined;
  if (import.meta.env.PROD && apiBase?.startsWith("http") && typeof window !== "undefined") {
    try {
      if (new URL(apiBase).host !== window.location.host) {
        return "/api/ref-click";
      }
    } catch {
      /* ignore */
    }
  }
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

/** Fetch API avec cookie de session conseiller (cross-origin Railway). */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(getApiUrl(path), { ...init, credentials: "include" });
}
