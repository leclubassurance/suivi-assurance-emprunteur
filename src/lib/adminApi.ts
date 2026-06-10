import { getAccessToken } from "./auth";
import { getApiUrl } from "./utils";

/** Fetch admin API with Google OAuth Bearer token from Firebase sign-in. */
export async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (
    init.body &&
    !(init.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(getApiUrl(path), { ...init, headers });
}
