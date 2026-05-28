/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Step, InsuranceFormData, FormErrors, Dossier, UserInfo } from './types';
import { INITIAL_FORM_DATA } from './constants';
import LandingStep from './components/steps/LandingStep';
import PreparationStep from './components/steps/PreparationStep';
import ProjetStep from './components/steps/ProjetStep';
import CoordonneesStep from './components/steps/CoordonneesStep';
import InfoPersoStep from './components/steps/InfoPersoStep';
import DocumentsStep from './components/steps/DocumentsStep';
import SuccessStep from './components/steps/SuccessStep';
import AdminLogin from './components/admin/AdminLogin';
import AdminDashboard from './components/admin/AdminDashboard';
import ClientPortalPage from './components/portal/ClientPortalPage';
import ClientPortalDemoPage from './components/portal/ClientPortalDemoPage';
import { validateCoordonnees, validateInfoPerso, validateProjet } from './lib/validation';
import { AlertCircle } from 'lucide-react';
import { showToast } from './lib/toast';
import { getApiUrl } from './lib/utils';

const STORAGE_KEY = 'insurance-form-draft';

export default function App() {
  const [currentStep, setCurrentStep] = useState<Step>(Step.LANDING);
  const [formData, setFormData] = useState<InsuranceFormData>(INITIAL_FORM_DATA);
  const [errors, setErrors] = useState<FormErrors>({});
  const [currentUser, setCurrentUser] = useState<UserInfo | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<any>('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [portalToken, setPortalToken] = useState<string | null>(null);
  const [portalDemo, setPortalDemo] = useState(false);

  useEffect(() => {
    const path = window.location.pathname;
    if (path === "/demo/suivi" || path === "/apercu-suivi-client") {
      setPortalDemo(true);
      return;
    }
    const m = path.match(/^\/suivi\/([a-f0-9]{32,64})$/i);
    if (m) {
      setPortalToken(m[1]);
      setCurrentStep(Step.CLIENT_PORTAL);
    }
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
          setFormData(parsed);
          // Don't restore step automatically to avoid getting stuck, or we could if we saved it.
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
    const assuresSanitized = formData.assures.map(a => ({
      ...a,
      nom: '',
      prenom: '',
      email: '',
      telephone: '',
      dateNaissance: ''
    }));
    
    const strippedDocuments = formData.documents.map(doc => {
      const { base64Content, rawFile, ...rest } = doc as any;
      return rest;
    });
    const formDataToSave = { ...formData, assures: assuresSanitized, documents: strippedDocuments };
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
      const cleanedFormData = { ...formData, documents: strippedDocuments };

      const formPayload = new FormData();
      formPayload.append("formData", JSON.stringify(cleanedFormData));

      for (const item of documentBlobs) {
        formPayload.append("documents", item.blob, item.name);
      }

      setSubmitStatus("Envoi en cours...");
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);
      
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
      setSubmitStatus({
        id: result.dossierId,
        name: formData.assures[0].prenom || formData.assures[0].nom,
        email: formData.assures[0].email,
        portalUrl: result.portalUrl,
      } as any);
      
      goToStep(Step.SUCCESS);
      localStorage.removeItem(STORAGE_KEY);
      showToast("Votre dossier a été soumis avec succès !", "success");
    } catch (error: any) {
      console.error("Erreur critique soumission:", error);
      if (error.name === 'AbortError') {
        showToast("L'envoi a pris trop de temps (délai dépassé). Veuillez réessayer avec des fichiers plus petits.", "error");
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
    goToStep(Step.LANDING);
  }

  // Admin access function passed to LandingStep
  const goToAdmin = () => goToStep(Step.ADMIN_LOGIN);

  const handleLogin = (user: UserInfo) => {
    setCurrentUser(user);
    if (user.role === 'ADMIN') {
      goToStep(Step.ADMIN_DASHBOARD);
    } else {
      goToStep(Step.CONSEILLER_DASHBOARD);
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    goToStep(Step.LANDING);
  };

  if (portalDemo) {
    return <ClientPortalDemoPage />;
  }

  return (
    <div className="min-h-[100dvh] flex flex-col w-full h-full">
      
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

      <main className="flex-1 w-full flex flex-col pt-4 md:pt-8 bg-transparent">
        {currentStep === Step.LANDING && (
          <LandingStep 
            onStart={() => goToStep(Step.PREPARATION)} 
            onAdminAccess={goToAdmin}
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
          <AdminDashboard user={currentUser} onLogout={handleLogout} />
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
