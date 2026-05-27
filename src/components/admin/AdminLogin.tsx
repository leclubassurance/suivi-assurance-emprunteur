import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import { motion } from 'motion/react';
import { UserInfo } from '../../types';
import { googleSignIn } from '../../lib/auth';

export default function AdminLogin({ onLogin, onBack }: { onLogin: (user: UserInfo) => void, onBack: () => void }) {
  const [error, setError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setError('');
    try {
      const result = await googleSignIn();
      if (result) {
        if (result.user.email !== 'assurance@leclubimmobilier.fr') {
           setError('Accès refusé. Seul le compte assurance@leclubimmobilier.fr est autorisé.');
           return;
        }
        onLogin({ uid: result.user.uid, email: result.user.email || '', role: 'ADMIN', name: result.user.displayName || 'Administrateur' } as any);
      }
    } catch(e: any) {
       console.error(e);
       if (e.code === 'auth/user-cancelled' || e.code === 'auth/popup-closed-by-user') {
         // Silently handle user cancellation
         return;
       }
       if (e.message?.includes('IdP denied access')) {
         setError('L\'accès a été refusé. Veuillez accepter les permissions demandées pour continuer.');
       } else {
         setError('Erreur lors de la connexion via Google.');
       }
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="w-full flex-1 flex flex-col items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-sm bento-card"
      >
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-[#f8fafc] text-[#1a1a1b] rounded-full flex items-center justify-center shadow-sm border border-[#f1f5f9]">
            <Lock className="w-8 h-8" />
          </div>
        </div>
        <h2 className="text-2xl font-bold text-center tracking-tight text-[#1a1a1b] mb-2">Espace Collaborateurs</h2>
        <p className="text-[#64748b] text-center text-[14px] mb-8">Veuillez vous authentifier avec Google pour accéder à votre espace et obtenir les permissions nécessaires.</p>

        <div className="space-y-4">
          {error && <p className="text-red-500 text-sm font-medium text-center">{error}</p>}
          
          <button 
            className="gsi-material-button w-full flex items-center justify-center py-2 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            onClick={handleLogin}
            disabled={isLoggingIn}
          >
            <div className="gsi-material-button-state"></div>
            <div className="gsi-material-button-content-wrapper flex items-center gap-3">
              <div className="gsi-material-button-icon">
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="24" height="24">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                  <path fill="none" d="M0 0h48v48H0z"></path>
                </svg>
              </div>
              <span className="gsi-material-button-contents font-medium text-slate-700">{isLoggingIn ? "Connexion..." : "Continuer avec Google"}</span>
            </div>
          </button>
          
          <button 
            onClick={onBack}
            className="w-full text-center text-[13px] font-bold text-[#94a3b8] hover:text-[#1a1a1b] pt-4"
          >
            ← Retour à l'accueil
          </button>
        </div>
      </motion.div>
    </div>
  );
}
