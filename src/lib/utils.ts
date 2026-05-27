import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateId() {
  // Simple UUID using math.random for the frontend
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

export function getApiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  
  // Default to relative path which is most reliable in proxied environments
  // Only use absolute origin if APP_URL is correctly set and we are in a context where relative won't work
  let detectedOrigin = '';

  try {
    const envAppUrl = (process.env as any).APP_URL;
    if (envAppUrl && envAppUrl.startsWith('http')) {
      detectedOrigin = envAppUrl;
    }
  } catch (e) {}

  if (detectedOrigin) {
    const base = detectedOrigin.endsWith('/') ? detectedOrigin.slice(0, -1) : detectedOrigin;
    return `${base}${cleanPath}`;
  }
  
  return cleanPath;
}
