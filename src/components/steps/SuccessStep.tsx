import React, { useMemo, useRef } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, FilePlus, ExternalLink } from 'lucide-react';
import { Button } from '../ui/Button';
import { showToast } from '../../lib/toast';

export default function SuccessStep({ onReset, data }: { onReset: () => void, data?: { id?: string, name?: string, email?: string, portalUrl?: string } }) {
  const generatedId = useMemo(
    () => `LCIF-${Math.floor(Math.random() * 1000000).toString().padStart(6, '0')}`,
    [],
  );
  const STORAGE_KEY = "last_submitted_dossier_id";
  const initialId = useMemo(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored && /^LCIF-\d{6}$/.test(stored)) return stored;
    } catch {}
    return data?.id || generatedId;
  }, [data?.id, generatedId]);
  const initialIdRef = useRef<string>(initialId);
  const dossierId = data?.id || initialIdRef.current;

  try {
    if (dossierId && /^LCIF-\d{6}$/.test(dossierId)) {
      sessionStorage.setItem(STORAGE_KEY, dossierId);
    }
  } catch {}

  const copyToClipboard = () => {
    navigator.clipboard.writeText(dossierId);
    showToast("Numéro de dossier copié.", "success");
  };

  return (
    <div className="w-full h-full flex-1 flex flex-col items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="w-full max-w-lg bg-white border border-slate-200/60 rounded-[32px] p-8 md:p-12 text-center shadow-sm"
      >
        <motion.div
           initial={{ scale: 0 }}
           animate={{ scale: 1 }}
           transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.2 }}
           className="w-20 h-20 bg-green-50 border border-green-100 rounded-[20px] flex items-center justify-center mx-auto mb-6"
        >
          <CheckCircle2 className="w-10 h-10 text-green-500" strokeWidth={2.5} />
        </motion.div>
        
        <h1 className="text-3xl font-bold tracking-tight text-[#111318] mb-3">Demande bien reçue</h1>
        <p className="text-slate-500 text-[15px] font-medium mb-8">
          {data?.name ? `Merci ${data.name},` : "Merci,"} nous avons bien reçu vos informations et vos documents.
        </p>

        <div className="bg-[#111318] rounded-[24px] p-6 text-left relative overflow-hidden mb-8 shadow-sm">
           <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl -mr-8 -mt-8"></div>
           <p className="text-[12px] uppercase tracking-widest font-bold text-white/50 mb-2">N° de dossier</p>
           <div className="flex items-center gap-3">
             <span className="text-2xl font-mono font-bold text-white select-text">{dossierId}</span>
             <button
               type="button"
               onClick={copyToClipboard}
               className="text-[12px] font-bold text-white/80 hover:text-blue-300 transition-colors border border-white/20 rounded-full px-3 py-1.5"
               title="Copier le numéro"
             >
               Copier
             </button>
           </div>
           <p className="text-[14px] text-white/70 mt-5 leading-relaxed font-medium">
             Nous revenons vers vous par email (<strong className="text-white">{data?.email || "votre adresse"}</strong>) sous 48h ouvrées.
           </p>
        </div>

        <div className="mb-6 rounded-[20px] border border-blue-100 bg-blue-50/90 px-5 py-4 text-left">
          <p className="text-[14px] font-bold text-[#1E3A8A] mb-1.5">Suivi de votre dossier</p>
          <p className="text-[13px] text-slate-600 leading-relaxed font-medium">
            {data?.portalUrl ? (
              <>
                Votre lien personnel de suivi est prêt — conservez-le pour revenir à tout moment.
                Aucun mot de passe n&apos;est nécessaire.
              </>
            ) : (
              <>
                Vous allez recevoir par email un lien personnel pour suivre l&apos;avancement de votre dossier
                {data?.email ? (
                  <> à l&apos;adresse <strong className="text-slate-800">{data.email}</strong></>
                ) : null}
                . Aucun mot de passe n&apos;est nécessaire.
              </>
            )}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {data?.portalUrl && (
            <a
              href={data.portalUrl}
              className="w-full py-4 bg-[#1E3A8A] hover:bg-[#172554] text-white rounded-[20px] font-bold text-[15px] transition-all flex items-center justify-center gap-2"
            >
              Accéder à mon suivi <ExternalLink className="w-[18px] h-[18px]" />
            </a>
          )}
          <button 
            onClick={onReset}
            className="w-full py-4 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-[20px] font-bold text-[15px] transition-all flex items-center justify-center gap-2"
          >
            <FilePlus className="w-[18px] h-[18px]" strokeWidth={2.5} />
            Déposer un nouveau dossier
          </button>
        </div>

      </motion.div>
    </div>
  );
}

