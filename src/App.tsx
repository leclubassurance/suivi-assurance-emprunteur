/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Step, InsuranceFormData, FormErrors, Dossier, UserInfo } from './types';
import {
  INITIAL_FORM_DATA,
  CLIENT_PORTAL_URL_KEY,
  APPORTEUR_REF_SESSION_KEY,
  APPORTEUR_REF_STORAGE_KEY,
  STATUT_PRO_OPTIONS,
} from './constants';
import LandingStep from './components/steps/LandingStep';
import type { LandingReferralProfile } from './components/LandingReferralBanner';
import PreparationStep from './components/steps/PreparationStep';
import ProjetStep from './components/steps/ProjetStep';
import CoordonneesStep from './components/steps/CoordonneesStep';
import InfoPersoStep from './components/steps/InfoPersoStep';
import DocumentsStep from './components/steps/DocumentsStep';
import SuccessStep from './components/steps/SuccessStep';
import AdminLogin from './components/admin/AdminLogin';
import AdminDashboard from './components/admin/AdminDashboard';
import AdminApporteursPanel from './components/admin/AdminApporteursPanel';
import AdminClientLandingPreview from './components/admin/AdminClientLandingPreview';
import AdminSesameLab from './components/admin/AdminSesameLab';
import ClientPortalPage from './components/portal/ClientPortalPage';
import ClientPortalDemoPage from './components/portal/ClientPortalDemoPage';
import ApporteurPortalPage from './components/portal/ApporteurPortalPage';
import ConseillerPortalLoginPage from './components/portal/ConseillerPortalLoginPage';
import ConseillerEspacePage from './components/portal/ConseillerEspacePage';
import MentionsLegalesPage from './pages/MentionsLegalesPage';
import PolitiqueConfidentialitePage from './pages/PolitiqueConfidentialitePage';
import { validateCoordonnees, validateInfoPerso, validateProjet } from './lib/validation';
import { AlertCircle } from 'lucide-react';
import { showToast } from './lib/toast';
import { getApiUrl, getRefClickUrl, clearConseillerSessionToken } from './lib/utils';
import { buildClientPrivacyConsentPayload } from '../shared/privacyConsent';

const STORAGE_KEY = 'insurance-form-draft';
const STATUT_PRO_DRAFT_VALUES = new Set(
  STATUT_PRO_OPTIONS.flatMap((option) => [option.value, option.label]),
);

function purgeLegacyApporteurRefStorage(): void {
  try {
    localStorage.removeItem(APPORTEUR_REF_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function readStoredApporteurRef(): string | undefined {
  try {
    const fromSession = sessionStorage.getItem(APPORTEUR_REF_SESSION_KEY)?.trim();
    if (fromSession) return fromSession.toLowerCase();
  } catch {
    /* ignore */
  }
  return undefined;
}

function persistApporteurRef(raw: string): string {
  const normalized = raw.trim().toLowerCase();
  try {
    sessionStorage.setItem(APPORTEUR_REF_SESSION_KEY, normalized);
  } catch {
    /* ignore */
  }
  // Ne plus écrire en localStorage global (causait : site principal → Jean).
  purgeLegacyApporteurRefStorage();
  return normalized;
}

function clearStoredApporteurRef(): void {
  try {
    sessionStorage.removeItem(APPORTEUR_REF_SESSION_KEY);
  } catch {
    /* ignore */
  }
  purgeLegacyApporteurRefStorage();
}

function sanitizeAssuresDraft(assures: any[] = []) {
  return assures.map((assure) => {
    const profession = String(assure?.profession || "").trim();
    return {
      ...assure,
      profession: STATUT_PRO_DRAFT_VALUES.has(profession) ? "" : profession,
    };
  });
}

export type LegalView = 'mentions' | 'privacy' | null;

function resolveLegalViewFromPath(path: string): LegalView {
  if (path === '/mentions-legales') return 'mentions';
  if (path === '/politique-confidentialite' || path === '/confidentialite') return 'privacy';
  return null;
}

const SUCCESS_PAYLOAD_KEY = "lcif_success_payload";

function hasUploadableDocument(doc: { rawFile?: unknown; base64Content?: string } | null | undefined): boolean {
  if (!doc) return false;
  if ((doc as any).rawFile) return true;
  const b64 = typeof doc.base64Content === "string" ? doc.base64Content : "";
  return b64.includes(",") || b64.length > 64;
}

export default function App() {
  const [legalView, setLegalView] = useState<LegalView>(() =>
    typeof window !== 'undefined' ? resolveLegalViewFromPath(window.location.pathname) : null,
  );
  const [currentStep, setCurrentStep] = useState<Step>(Step.LANDING);
  const [formData, setFormData] = useState<InsuranceFormData>(INITIAL_FORM_DATA);
  const [errors, setErrors] = useState<FormErrors>({});
  const [currentUser, setCurrentUser] = useState<UserInfo | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<any>('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [portalToken, setPortalToken] = useState<string | null>(null);
  const [portalDemo, setPortalDemo] = useState(false);
  const [apporteurPortalToken, setApporteurPortalToken] = useState<string | null>(null);
  const [showConseillerLogin, setShowConseillerLogin] = useState(false);
  const [showConseillerEspace, setShowConseillerEspace] = useState(false);
  const [conseillerLoginToken, setConseillerLoginToken] = useState<string | null>(null);
  const [adminPartnersView, setAdminPartnersView] = useState<'none' | 'apporteurs' | 'conseillers'>('none');
  const [showClientLandingPreview, setShowClientLandingPreview] = useState(false);
  const [showSesameLab, setShowSesameLab] = useState(false);
  const [referralProfile, setReferralProfile] = useState<LandingReferralProfile | null>(null);

  const goHome = () => {
    setLegalView(null);
    setPortalDemo(false);
    setPortalToken(null);
    setApporteurPortalToken(null);
    setShowConseillerLogin(false);
    setShowConseillerEspace(false);
    setConseillerLoginToken(null);
    setAdminPartnersView('none');
    setShowClientLandingPreview(false);
    setShowSesameLab(false);
    setCurrentStep(Step.LANDING);
    try {
      sessionStorage.removeItem(SUCCESS_PAYLOAD_KEY);
    } catch {
      /* ignore */
    }
    window.history.pushState({}, '', '/');
  };

  const openLegal = (view: Exclude<LegalView, null>) => {
    const path = view === 'mentions' ? '/mentions-legales' : '/politique-confidentialite';
    setLegalView(view);
    window.history.pushState({}, '', path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** Retour depuis mentions / privacy sans réinitialiser le parcours formulaire. */
  const closeLegal = () => {
    setLegalView(null);
    const stayOnSuccess = currentStep === Step.SUCCESS;
    window.history.pushState({}, '', stayOnSuccess ? '/merci' : '/');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    const syncRoute = () => {
      const path = window.location.pathname;
      const legal = resolveLegalViewFromPath(path);
      if (legal) {
        setLegalView(legal);
        return;
      }
      setLegalView(null);
      if (path === "/admin/apporteurs" || path === "/admin/reseau") {
        setAdminPartnersView('apporteurs');
        setShowClientLandingPreview(false);
        setShowSesameLab(false);
        setPortalDemo(false);
        setApporteurPortalToken(null);
        setPortalToken(null);
        return;
      }
      if (path === "/admin/conseillers-club" || path === "/admin/conseillers") {
        setAdminPartnersView('conseillers');
        setShowClientLandingPreview(false);
        setShowSesameLab(false);
        setPortalDemo(false);
        setApporteurPortalToken(null);
        setPortalToken(null);
        return;
      }
      if (path === "/admin/lab-sesame" || path === "/admin/sesame-lab") {
        setShowSesameLab(true);
        setShowClientLandingPreview(false);
        setAdminPartnersView('none');
        setPortalDemo(false);
        setApporteurPortalToken(null);
        setPortalToken(null);
        return;
      }
      if (path === "/admin/preview-site-client" || path === "/admin/preview-landing-client") {
        setShowClientLandingPreview(true);
        setShowSesameLab(false);
        setAdminPartnersView('none');
        setPortalDemo(false);
        setApporteurPortalToken(null);
        setPortalToken(null);
        return;
      }
      setShowClientLandingPreview(false);
      setShowSesameLab(false);
      setAdminPartnersView('none');
      if (path === "/demo/suivi" || path === "/apercu-suivi-client") {
        setPortalDemo(true);
        return;
      }
      setPortalDemo(false);
      const conseillerConnexionMatch = path.match(/^\/conseiller\/connexion\/([a-f0-9]{32,128})$/i);
      if (path === "/conseiller/espace") {
        setShowConseillerEspace(true);
        setShowConseillerLogin(false);
        setConseillerLoginToken(null);
        setApporteurPortalToken(null);
        setPortalToken(null);
        return;
      }
      if (path === "/conseiller" || conseillerConnexionMatch) {
        setShowConseillerLogin(true);
        setShowConseillerEspace(false);
        setConseillerLoginToken(conseillerConnexionMatch ? conseillerConnexionMatch[1] : null);
        setApporteurPortalToken(null);
        setPortalToken(null);
        return;
      }
      setShowConseillerLogin(false);
      setShowConseillerEspace(false);
      setConseillerLoginToken(null);
      const apporteurMatch = path.match(/^\/(?:apporteur|reseau)\/([a-f0-9]{32,64})$/i);
      if (apporteurMatch) {
        setApporteurPortalToken(apporteurMatch[1]);
        setPortalToken(null);
        return;
      }
      setApporteurPortalToken(null);
      const m = path.match(/^\/suivi\/([a-f0-9]{32,64})$/i);
      if (m) {
        setPortalToken(m[1]);
        setCurrentStep(Step.CLIENT_PORTAL);
        return;
      }
      if (path === "/merci" || path === "/dossier-envoye") {
        try {
          const raw = sessionStorage.getItem(SUCCESS_PAYLOAD_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.id) setSubmitStatus(parsed);
          }
        } catch {
          /* ignore */
        }
        setCurrentStep(Step.SUCCESS);
        return;
      }
    };
    syncRoute();
    let urlRef: string | undefined;
    try {
      const ref = new URLSearchParams(window.location.search).get("ref");
      if (ref && ref.trim()) urlRef = ref.trim().toLowerCase();
    } catch {
      /* ignore */
    }

    let draftRef: string | undefined;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const t = String(parsed?.apporteurRefToken || "").trim().toLowerCase();
        if (t) draftRef = t;
      }
    } catch {
      /* ignore */
    }

    if (urlRef) {
      const normalized = persistApporteurRef(urlRef);
      setFormData((prev) => ({ ...prev, apporteurRefToken: normalized }));
      try {
        const sessionKey = "lcif_ref_click_session";
        let sessionId = sessionStorage.getItem(sessionKey);
        if (!sessionId) {
          sessionId =
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `s-${Date.now()}`;
          sessionStorage.setItem(sessionKey, sessionId);
        }
        fetch(getRefClickUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ref: normalized, sessionId }),
        }).catch(() => {});
      } catch {
        /* ignore */
      }
      fetch(getApiUrl(`/api/public/apporteur-ref/${encodeURIComponent(normalized)}`))
        .then((r) => r.json())
        .then((json) => {
          if (json?.ok && json.publicProfile) {
            setReferralProfile({
              contactName: String(json.contactName || "").trim() || "Votre conseiller",
              companyName: json.companyName || null,
              profile: {
                photoUrl: json.publicProfile.photoUrl,
                title: json.publicProfile.title,
                bio: json.publicProfile.bio,
              },
            });
          } else {
            setReferralProfile(null);
          }
        })
        .catch(() => setReferralProfile(null));
    } else {
      // Visite organique : ne jamais réactiver un ref uniquement présent dans le brouillon localStorage.
      // Un ref en sessionStorage (même onglet, après ?ref=) reste valide.
      const sessionRef = readStoredApporteurRef();
      if (sessionRef) {
        setFormData((prev) => ({ ...prev, apporteurRefToken: sessionRef }));
      } else {
        clearStoredApporteurRef();
        setReferralProfile(null);
        setFormData((prev) => ({ ...prev, apporteurRefToken: undefined }));
        if (draftRef) {
          // Purge le token fantôme du brouillon pour éviter une réattribution au prochain chargement.
          try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
              const parsed = JSON.parse(saved);
              delete parsed.apporteurRefToken;
              localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
            }
          } catch {
            /* ignore */
          }
        }
      }
    }
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);

  // Load from LocalStorage on mount
  useEffect(() => {
    (window as any).showAppToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
      setToast({ message, type });
    };
    
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed) {
          let urlRef: string | undefined;
          try {
            const ref = new URLSearchParams(window.location.search).get("ref");
            if (ref?.trim()) urlRef = ref.trim().toLowerCase();
          } catch {
            /* ignore */
          }
          // Attribution : URL ou session uniquement — jamais le token figé dans le brouillon.
          const token = urlRef || readStoredApporteurRef() || undefined;
          const hadGhostDocs = Array.isArray(parsed.documents) && parsed.documents.length > 0;
          setFormData({
            ...parsed,
            documents: [],
            assures: sanitizeAssuresDraft(parsed.assures || []),
            ...(token ? { apporteurRefToken: token } : { apporteurRefToken: undefined }),
          });
          if (hadGhostDocs) {
            setTimeout(() => {
              setToast({
                message: "Vos documents n'ont pas pu être conservés entre deux sessions. Merci de les déposer à nouveau.",
                type: "info",
              });
            }, 400);
          }
        }
      } catch (e) {
        console.error('Failed to parse draft from local storage');
      }
    }

    return () => {
      delete (window as any).showAppToast;
    };
  }, []);

  // Save to LocalStorage on change
  useEffect(() => {
    // Strip personal info for RGPD
    const assuresSanitized = sanitizeAssuresDraft(formData.assures).map(a => ({
      ...a,
      nom: '',
      prenom: '',
      email: '',
      telephone: '',
      dateNaissance: ''
    }));
    
    // Ne jamais persister les binaires (ni métadonnées docs) : au rechargement ils seraient
    // des « fantômes » sans rawFile et feraient échouer la soumission.
    // Attribution : sessionStorage uniquement (pas le brouillon).
    const formDataToSave = {
      ...formData,
      assures: assuresSanitized,
      documents: [],
    };
    delete (formDataToSave as any).apporteurRefToken;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(formDataToSave));
    } catch (e) {
      console.warn("Storage limits reached for draft saving", e);
    }
  }, [formData]);

  // Toast timer-out
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);


  const goToStep = (step: Step) => {
    setErrors({});
    setCurrentStep(step);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNext = () => {
    let newErrors = {};
    if (currentStep === Step.PROJET) {
      newErrors = validateProjet(formData);
      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        return;
      }
      goToStep(Step.COORDONNEES);
    } else if (currentStep === Step.COORDONNEES) {
      newErrors = validateCoordonnees(formData.assures);
      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        return;
      }
      goToStep(Step.INFO_PERSO);
    } else if (currentStep === Step.INFO_PERSO) {
      newErrors = validateInfoPerso(formData.assures);
      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        return;
      }
      goToStep(Step.DOCUMENTS);
    }
  };

  const handlePrev = () => {
    setErrors({});
    if (currentStep === Step.PREPARATION) goToStep(Step.LANDING);
    if (currentStep === Step.PROJET) goToStep(Step.PREPARATION);
    if (currentStep === Step.COORDONNEES) goToStep(Step.PROJET);
    if (currentStep === Step.INFO_PERSO) goToStep(Step.COORDONNEES);
    if (currentStep === Step.DOCUMENTS) goToStep(Step.INFO_PERSO);
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    
    if (formData.documents.length === 0) {
      showToast("Veuillez ajouter au moins un document avant de valider.", "error");
      return;
    }

    const ghostDocs = formData.documents.filter((d) => !hasUploadableDocument(d as any));
    if (ghostDocs.length > 0) {
      showToast(
        "Certains documents doivent être déposés à nouveau (contenu non disponible après reprise). Supprimez-les puis rechargez-les.",
        "error",
      );
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus("Initialisation...");
    
    try {
      // Convert base64 docs back to Blobs for multipart upload or use rawFile
      const documentBlobs: { blob: Blob; name: string }[] = [];
      for (const file of formData.documents) {
        if ((file as any).rawFile) {
          documentBlobs.push({ blob: (file as any).rawFile, name: file.name });
        } else if (file.base64Content) {
          setSubmitStatus(`Préparation du fichier ${file.name}...`);
          const base64Parts = file.base64Content.split(',');
          if (base64Parts.length > 1) {
            const mimeType = base64Parts[0].match(/:(.*?);/)?.[1] || 'application/octet-stream';
            const byteString = atob(base64Parts[1]);
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) {
              ia[i] = byteString.charCodeAt(i);
            }
            const blob = new Blob([ab], { type: mimeType });
            documentBlobs.push({ blob, name: file.name });
          } else {
            throw new Error(`Le document "${file.name}" a perdu son contenu. Veuillez le supprimer et le rajouter.`);
          }
        } else {
          throw new Error(`Le document "${file.name}" est incomplet. Veuillez le supprimer et le rajouter.`);
        }
      }

      // Strip large base64Content and rawFile from JSON payload before sending to server
      const strippedDocuments = formData.documents.map(doc => {
        const { base64Content, rawFile, ...rest } = doc as any;
        return rest;
      });
      let apporteurRefToken: string | undefined;
      try {
        const fromForm = String((formData as any).apporteurRefToken || "").trim().toLowerCase();
        apporteurRefToken = fromForm || readStoredApporteurRef();
      } catch {
        apporteurRefToken = undefined;
      }
      const cleanedFormData: Record<string, unknown> = {
        ...formData,
        documents: strippedDocuments,
        privacyConsent: buildClientPrivacyConsentPayload(),
      };
      if (apporteurRefToken) cleanedFormData.apporteurRefToken = apporteurRefToken;
      else delete cleanedFormData.apporteurRefToken;

      const formPayload = new FormData();
      formPayload.append("formData", JSON.stringify(cleanedFormData));

      for (const item of documentBlobs) {
        formPayload.append("documents", item.blob, item.name);
      }

      setSubmitStatus("Envoi en cours...");
      const controller = new AbortController();
      // PDFs lourds + réseau mobile : 3 min (au lieu de 60s)
      const timeoutId = setTimeout(() => controller.abort(), 180_000);
      
      const res = await fetch(getApiUrl("/api/dossiers"), {
        method: "POST",
        body: formPayload,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      if (!res.ok) {
        let detail = "";
        try {
          const errBody = await res.json();
          detail = errBody?.error ? `: ${errBody.error}` : "";
        } catch {
          detail = res.status === 404 ? " (API introuvable — vérifiez VITE_API_URL sur Vercel)" : "";
        }
        throw new Error(`Erreur serveur lors de l'enregistrement du dossier${detail}`);
      }
      
      const result = await res.json();
      const successPayload = {
        id: result.dossierId,
        name: formData.assures[0].prenom || formData.assures[0].nom,
        email: formData.assures[0].email,
        portalUrl: result.portalUrl,
      };
      setSubmitStatus(successPayload as any);

      if (result.portalUrl) {
        try {
          localStorage.setItem(CLIENT_PORTAL_URL_KEY, result.portalUrl);
        } catch {
          /* ignore quota */
        }
      }
      try {
        sessionStorage.setItem(SUCCESS_PAYLOAD_KEY, JSON.stringify(successPayload));
      } catch {
        /* ignore */
      }
      
      goToStep(Step.SUCCESS);
      window.history.pushState({}, '', '/merci');
      localStorage.removeItem(STORAGE_KEY);
      clearStoredApporteurRef();
      showToast("Votre dossier a été soumis avec succès !", "success");
    } catch (error: any) {
      console.error("Erreur critique soumission:", error);
      if (error.name === 'AbortError') {
        showToast("L'envoi a pris trop de temps (délai dépassé). Vérifiez votre connexion ou réduisez la taille des fichiers, puis réessayez.", "error");
      } else {
        showToast(`Erreur : ${error.message || "Une erreur est survenue"}. Vérifiez votre connexion et réessayez.`, "error");
      }
    } finally {
      setIsSubmitting(false);
      // Ne pas vider submitStatus: SuccessStep en dépend pour afficher un numéro stable
      // (sinon il regénère un LCIF-* aléatoire à chaque render/clic).
    }
  };

  const resetForm = () => {
    setFormData(INITIAL_FORM_DATA);
    clearStoredApporteurRef();
    setReferralProfile(null);
    try {
      sessionStorage.removeItem(SUCCESS_PAYLOAD_KEY);
    } catch {
      /* ignore */
    }
    goToStep(Step.LANDING);
    window.history.pushState({}, '', '/');
  }

  // Admin access function passed to LandingStep
  const goToAdmin = () => goToStep(Step.ADMIN_LOGIN);

  const handleLogin = (user: UserInfo) => {
    setCurrentUser(user);
    if ((adminPartnersView !== 'none' || showClientLandingPreview || showSesameLab) && user.role === 'ADMIN') {
      goToStep(Step.ADMIN_DASHBOARD);
      return;
    }
    if (user.role === 'ADMIN') {
      goToStep(Step.ADMIN_DASHBOARD);
    } else {
      goToStep(Step.CONSEILLER_DASHBOARD);
    }
  };

  const closeAdminClientLandingPreview = () => {
    setShowClientLandingPreview(false);
    window.history.pushState({}, '', '/');
    if (currentUser) {
      goToStep(currentUser.role === 'ADMIN' ? Step.ADMIN_DASHBOARD : Step.CONSEILLER_DASHBOARD);
    }
  };

  const openAdminSesameLab = () => {
    setShowSesameLab(true);
    setShowClientLandingPreview(false);
    setAdminPartnersView('none');
    window.history.pushState({}, '', '/admin/lab-sesame');
    if (currentUser?.role === 'ADMIN') {
      goToStep(Step.ADMIN_DASHBOARD);
    } else {
      goToStep(Step.ADMIN_LOGIN);
    }
  };

  const closeAdminSesameLab = () => {
    setShowSesameLab(false);
    window.history.pushState({}, '', '/');
    if (currentUser) {
      goToStep(currentUser.role === 'ADMIN' ? Step.ADMIN_DASHBOARD : Step.CONSEILLER_DASHBOARD);
    }
  };

  const openAdminApporteurs = () => {
    setAdminPartnersView('apporteurs');
    window.history.pushState({}, '', '/admin/apporteurs');
    if (currentUser?.role === 'ADMIN') {
      goToStep(Step.ADMIN_DASHBOARD);
    } else {
      goToStep(Step.ADMIN_LOGIN);
    }
  };

  const openAdminConseillersClub = () => {
    setAdminPartnersView('conseillers');
    window.history.pushState({}, '', '/admin/conseillers-club');
    if (currentUser?.role === 'ADMIN') {
      goToStep(Step.ADMIN_DASHBOARD);
    } else {
      goToStep(Step.ADMIN_LOGIN);
    }
  };

  const closeAdminPartners = () => {
    setAdminPartnersView('none');
    window.history.pushState({}, '', '/');
    if (currentUser) {
      goToStep(currentUser.role === 'ADMIN' ? Step.ADMIN_DASHBOARD : Step.CONSEILLER_DASHBOARD);
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    goToStep(Step.LANDING);
  };

  const openConseillerLogin = () => {
    clearConseillerSessionToken();
    setShowConseillerEspace(false);
    setShowConseillerLogin(true);
    setConseillerLoginToken(null);
    setApporteurPortalToken(null);
    window.history.pushState({}, '', '/conseiller');
  };

  if (showConseillerEspace) {
    return (
      <ConseillerEspacePage
        onSessionExpired={openConseillerLogin}
      />
    );
  }

  if (showConseillerLogin && !apporteurPortalToken) {
    return (
      <ConseillerPortalLoginPage
        loginToken={conseillerLoginToken}
        onAuthenticated={() => {
          setShowConseillerLogin(false);
          setConseillerLoginToken(null);
          setShowConseillerEspace(true);
          window.history.replaceState({}, '', `/conseiller/espace`);
        }}
      />
    );
  }

  if (apporteurPortalToken) {
    return <ApporteurPortalPage token={apporteurPortalToken} />;
  }

  if (showSesameLab) {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return <AdminLogin onLogin={handleLogin} onBack={closeAdminSesameLab} />;
    }
    return <AdminSesameLab onBack={closeAdminSesameLab} />;
  }

  if (showClientLandingPreview) {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return <AdminLogin onLogin={handleLogin} onBack={closeAdminClientLandingPreview} />;
    }
    return (
      <AdminClientLandingPreview
        onBack={closeAdminClientLandingPreview}
        onStartStudy={() => {
          setShowClientLandingPreview(false);
          window.history.pushState({}, '', '/');
          goToStep(Step.PREPARATION);
        }}
      />
    );
  }

  if (adminPartnersView !== 'none') {
    if (!currentUser || currentUser.role !== 'ADMIN') {
      return <AdminLogin onLogin={handleLogin} onBack={closeAdminPartners} />;
    }
    return (
      <AdminApporteursPanel
        onBack={closeAdminPartners}
        segment={adminPartnersView === 'conseillers' ? 'conseiller_club' : 'business'}
      />
    );
  }

  if (portalDemo) {
    return <ClientPortalDemoPage />;
  }

  if (legalView === 'mentions') {
    return <MentionsLegalesPage onBack={closeLegal} />;
  }

  if (legalView === 'privacy') {
    return <PolitiqueConfidentialitePage onBack={closeLegal} />;
  }

  return (
    <div className="min-h-[100dvh] flex flex-col w-full overflow-x-hidden">
      
      {/* Header Progress for Steps */}
      {[Step.PREPARATION, Step.PROJET, Step.COORDONNEES, Step.INFO_PERSO, Step.DOCUMENTS].includes(currentStep) && (
        <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-neutral-100">
          <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
            <button onClick={handlePrev} className="text-neutral-500 hover:text-neutral-900 text-[14px] font-semibold transition-colors flex items-center gap-1.5">
              <span>←</span> Retour
            </button>
            <div className="flex-1 max-w-[200px] mx-4">
              <div className="h-1.5 w-full bg-neutral-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-neutral-900 transition-all duration-500 ease-out rounded-full"
                  style={{ 
                    width: currentStep === Step.PREPARATION ? '20%' :
                           currentStep === Step.PROJET ? '40%' :
                           currentStep === Step.COORDONNEES ? '60%' : 
                           currentStep === Step.INFO_PERSO ? '80%' : '100%'
                  }}
                />
              </div>
            </div>
            <div className="w-[70px] text-right text-[12px] font-semibold text-neutral-400">
              {currentStep === Step.PREPARATION ? '1 / 5' :
               currentStep === Step.PROJET ? '2 / 5' :
               currentStep === Step.COORDONNEES ? '3 / 5' : 
               currentStep === Step.INFO_PERSO ? '4 / 5' : '5 / 5'}
            </div>
          </div>
        </header>
      )}

      {/* Global Errors */}
      {Object.keys(errors).length > 0 && (
        <div className="bg-[#fef2f2] p-4 border-b border-[#fecaca]">
          <div className="max-w-4xl mx-auto flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-[#ef4444] flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-[14px] font-bold text-[#991b1b]">Veuillez corriger {Object.keys(errors).length} erreur(s) :</h3>
              <ul className="mt-1 text-[13px] text-[#b91c1c] list-disc list-inside font-medium">
                {Object.entries(errors).map(([key, msg]) => (
                  <li key={key}>{msg}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <main
        className={`flex-1 w-full min-h-0 flex flex-col bg-transparent ${
          currentStep === Step.LANDING ? "pt-0" : "pt-4 md:pt-8"
        }`}
      >
        {currentStep === Step.LANDING && (
          <LandingStep 
            onStart={() => goToStep(Step.PREPARATION)} 
            onAdminAccess={goToAdmin}
            onLegalMentions={() => openLegal('mentions')}
            onLegalPrivacy={() => openLegal('privacy')}
            referralProfile={referralProfile}
          />
        )}
        
        {currentStep === Step.PREPARATION && (
          <PreparationStep 
            onNext={() => goToStep(Step.PROJET)} 
          />
        )}
        
        {currentStep === Step.PROJET && (
          <ProjetStep 
            formData={formData} 
            setFormData={setFormData}
            errors={errors}
            onNext={handleNext}
          />
        )}
        
        {currentStep === Step.COORDONNEES && (
          <CoordonneesStep 
            formData={formData} 
            setFormData={setFormData}
            errors={errors}
            onNext={handleNext}
          />
        )}
        
        {currentStep === Step.INFO_PERSO && (
          <InfoPersoStep 
            formData={formData} 
            setFormData={setFormData}
            errors={errors}
            onNext={handleNext}
          />
        )}
        
        {currentStep === Step.DOCUMENTS && (
          <DocumentsStep 
            formData={formData} 
            setFormData={setFormData}
            onSubmit={handleSubmit}
            isSubmitting={isSubmitting}
            submitStatus={submitStatus}
            onOpenPrivacy={() => openLegal('privacy')}
          />
        )}

        {currentStep === Step.SUCCESS && (
          <SuccessStep data={submitStatus as any} onReset={resetForm}/>
        )}

        {currentStep === Step.CLIENT_PORTAL && portalToken && (
          <ClientPortalPage token={portalToken} />
        )}

        {currentStep === Step.ADMIN_LOGIN && (
          <AdminLogin onLogin={handleLogin} onBack={() => goToStep(Step.LANDING)} />
        )}

        {(currentStep === Step.ADMIN_DASHBOARD || currentStep === Step.CONSEILLER_DASHBOARD) && currentUser && (
          <AdminDashboard
            user={currentUser}
            onLogout={handleLogout}
            onOpenApporteurs={openAdminApporteurs}
            onOpenConseillersClub={openAdminConseillersClub}
            onOpenSesameLab={openAdminSesameLab}
          />
        )}
      </main>

      {/* Custom Toast Notification Component */}
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className="fixed bottom-6 right-6 z-[9999] max-w-sm w-full bg-white border border-neutral-200/80 rounded-[20px] shadow-2xl p-4 flex items-start gap-3.5"
        >
          <div className={`p-2 rounded-xl shrink-0 ${
            toast.type === 'success' ? 'bg-green-50 text-green-600 border border-green-100' :
            toast.type === 'error' ? 'bg-red-50 text-red-600 border border-red-100' :
            'bg-blue-50 text-blue-600 border border-blue-100'
          }`}>
            {toast.type === 'success' ? (
              <svg className="w-5 h-5 font-bold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : toast.type === 'error' ? (
              <svg className="w-5 h-5 font-bold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-5 h-5 font-bold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-[13px] font-bold text-neutral-800">
              {toast.type === 'success' ? 'Succès' : toast.type === 'error' ? 'Erreur' : 'Information'}
            </h4>
            <p className="text-[12px] font-medium text-neutral-500 mt-0.5 leading-relaxed">{toast.message}</p>
          </div>
          <button onClick={() => setToast(null)} className="text-neutral-400 hover:text-neutral-600 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </motion.div>
      )}

    </div>
  );
}
