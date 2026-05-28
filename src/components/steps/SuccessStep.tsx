import React, { useMemo, useRef } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, FilePlus } from 'lucide-react';
import { Button } from '../ui/Button';
import { showToast } from '../../lib/toast';

export default function SuccessStep({ onReset, data }: { onReset: () => void, data?: { id?: string, name?: string, email?: string } }) {
  const generatedId = useMemo(
    () => `LCIF-${Math.floor(Math.random() * 1000000).toString().padStart(6, '0')}`,
    [],
  );
  const initialIdRef = useRef<string>(data?.id || generatedId);
  const dossierId = data?.id || initialIdRef.current;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(dossierId);
    showToast('Numéro copié !', 'success');
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
        
        <h1 className="text-3xl font-bold tracking-tight text-[#111318] mb-3">Dossier reçu !</h1>
        <p className="text-slate-500 text-[15px] font-medium mb-8">
          {data?.name ? `Merci ${data.name}, vos informations` : "Vos informations"} et documents ont bien été transmis à notre équipe d'experts.
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
             Vous recevrez une réponse à votre adresse <strong className="text-white">{data?.email || "email"}</strong> sous 48h ouvrées. Un système de notification vous informera de l'avancement. 
           </p>
        </div>

        <div className="flex flex-col gap-3">
          <button 
            onClick={onReset}
            className="w-full py-4 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-[20px] font-bold text-[15px] transition-all flex items-center justify-center gap-2"
          >
            <FilePlus className="w-[18px] h-[18px]" strokeWidth={2.5} />
            Créer une nouvelle demande
          </button>
        </div>

      </motion.div>
    </div>
  );
}

