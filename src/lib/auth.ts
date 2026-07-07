import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from "firebase/auth";
import type { FirebaseOptions } from "firebase/app";

function getFirebaseConfigFromEnv(): FirebaseOptions | null {
  // Vercel/Vite expose only VITE_* variables to the browser.
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined;
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined;

  if (!apiKey || !authDomain || !projectId) return null;
  if (apiKey.includes("dummy")) return null;

  return {
    apiKey,
    authDomain,
    projectId,
    appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID as string | undefined,
  };
}

const firebaseConfig = getFirebaseConfigFromEnv();
const isFirebaseValid = Boolean(firebaseConfig);

let auth: any = null;
let provider: any = null;

if (isFirebaseValid) {
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    provider = new GoogleAuthProvider();
    provider.setCustomParameters({
      prompt: "select_account",
      login_hint: "assurance@leclubimmobilier.fr",
    });
    // drive (not drive.file): required to create subfolders in the parent folder (ex. Dossiers Clients Assurance)
    provider.addScope("https://www.googleapis.com/auth/drive");
    provider.addScope("https://www.googleapis.com/auth/gmail.send");
    provider.addScope("https://www.googleapis.com/auth/gmail.readonly");
    provider.addScope("https://www.googleapis.com/auth/gmail.modify");
    provider.addScope("https://www.googleapis.com/auth/spreadsheets");
  } catch (err) {
    console.error("Firebase Auth initialization failed:", err);
  }
}

let isSigningIn = false;
let cachedAccessToken: string | null = null;

// Memory storage to persist simulated/mock auth state if firebase is dummy
let simulatedUser: any = null;
const SIM_USER_KEY = "simulated_user_auth";
const ADMIN_OAUTH_TOKEN_KEY = "lcif_admin_oauth_token";
try {
  const stored = sessionStorage.getItem(SIM_USER_KEY);
  if (stored) {
    const parsed = JSON.parse(stored);
    simulatedUser = parsed.user;
    cachedAccessToken = parsed.accessToken;
  }
} catch (e) {}

const listeners = new Set<Function>();

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  if (isFirebaseValid && auth) {
    return onAuthStateChanged(auth, async (user: User | null) => {
      if (user) {
        if (cachedAccessToken) {
          if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
        } else if (!isSigningIn) {
          cachedAccessToken = null;
          if (onAuthFailure) onAuthFailure();
        }
      } else {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    });
  } else {
    // Simulated auth
    const notify = () => {
      if (simulatedUser && cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(simulatedUser, cachedAccessToken);
      } else {
        if (onAuthFailure) onAuthFailure();
      }
    };
    listeners.add(notify);
    // Execute on next tick to simulate firebase async init
    setTimeout(notify, 10);
    return () => {
      listeners.delete(notify);
    };
  }
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  if (isFirebaseValid && auth && provider) {
    try {
      isSigningIn = true;
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.accessToken) {
        throw new Error("Failed to get access token from Firebase Auth");
      }

      cachedAccessToken = credential.accessToken;
      try {
        sessionStorage.setItem(ADMIN_OAUTH_TOKEN_KEY, cachedAccessToken);
      } catch {
        /* ignore */
      }
      return { user: result.user, accessToken: cachedAccessToken };
    } catch (error: any) {
      console.error("Firebase Sign in error details:", {
        code: error.code,
        message: error.message,
        stack: error.stack,
        customData: error.customData
      });
      throw error;
    } finally {
      isSigningIn = false;
    }
  } else {
    // Simulated auth bypass:
    // Auto-login as the authorized admin assurance@leclubimmobilier.fr
    // This makes sure they can access files and test everything instantly in simulation mode.
    const mockUser = {
      uid: "mock-uid-leclubimmobilier",
      email: "assurance@leclubimmobilier.fr",
      displayName: "Administrateur LCIF",
      photoURL: null,
      emailVerified: true,
    };
    const mockToken = "mock-gdrive-access-token-" + Date.now();
    simulatedUser = mockUser;
    cachedAccessToken = mockToken;
    try {
      sessionStorage.setItem(SIM_USER_KEY, JSON.stringify({ user: mockUser, accessToken: mockToken }));
      sessionStorage.setItem(ADMIN_OAUTH_TOKEN_KEY, mockToken);
    } catch (e) {}
    
    // Notify listeners
    for (const listener of listeners) {
      try { listener(); } catch (e) {}
    }
    
    return { user: mockUser as any, accessToken: mockToken };
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  if (cachedAccessToken) return cachedAccessToken;
  try {
    const stored = sessionStorage.getItem(ADMIN_OAUTH_TOKEN_KEY);
    if (stored) {
      cachedAccessToken = stored;
      return stored;
    }
  } catch {
    /* ignore */
  }
  return null;
};

export const logout = async () => {
  if (isFirebaseValid && auth) {
    await auth.signOut();
  }
  simulatedUser = null;
  cachedAccessToken = null;
  try {
    sessionStorage.removeItem(SIM_USER_KEY);
    sessionStorage.removeItem(ADMIN_OAUTH_TOKEN_KEY);
  } catch (e) {}
  for (const listener of listeners) {
    try { listener(); } catch (e) {}
  }
};

