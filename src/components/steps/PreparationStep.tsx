import React from 'react';
import { motion } from 'motion/react';
import { ArrowRight, FileText, CheckCircle2 } from 'lucide-react';

export default function PreparationStep({ onNext }: { onNext: () => void }) {
  const [isChecked, setIsChecked] = React.useState(false);

  return (
    <div className="w-full max-w-4xl mx-auto px-4 gap-6 pb-20 flex-1 flex flex-col justify-center">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-8"
      >
        <div className="text-[11px] uppercase tracking-[0.15em] text-slate-500 font-bold mb-3">
          Prérequis
        </div>
        <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-[#111318] mb-4">Avant de commencer...</h2>
        <p className="text-slate-500 text-[15px] font-medium max-w-lg mx-auto">Veuillez rassembler les documents suivants pour une analyse de votre dossier. Vous pourrez les déposer à la fin du formulaire.</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="bg-white border border-slate-200/60 rounded-[24px] shadow-sm flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-slate-100 overflow-hidden mb-8">
          <div className="flex-1 p-8 text-center flex flex-col items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center mb-5">
              <FileText className="w-8 h-8 text-[#2563eb]" />
            </div>
            <h3 className="font-bold text-[#111318] text-[17px] mb-2 leading-snug">L'offre de prêt</h3>
            <p className="text-slate-500 text-[14px]">Document détaillé remis par votre banque lors de l'octroi du crédit.</p>
          </div>
          
          <div className="flex-1 p-8 text-center flex flex-col items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center mb-5">
              <FileText className="w-8 h-8 text-[#2563eb]" />
            </div>
            <h3 className="font-bold text-[#111318] text-[17px] mb-2 leading-snug">Tableau d'amortissement</h3>
            <p className="text-slate-500 text-[14px]">L'échéancier complet, détaillé jusqu'à la dernière échéance du prêt.</p>
          </div>

          <div className="flex-1 p-8 text-center flex flex-col items-center justify-center bg-slate-50">
            <div className="w-16 h-16 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center mb-5">
              <CheckCircle2 className="w-8 h-8 text-[#2563eb]" />
            </div>
            <h3 className="font-bold text-[#111318] text-[17px] mb-2 leading-snug">C'est tout !</h3>
            <p className="text-slate-500 text-[14px]">Vous pourrez les prendre en photo ou les importer en PDF à la dernière étape.</p>
          </div>
        </div>

        <div className="flex flex-col items-center gap-6">
          <label className="flex items-center gap-3 cursor-pointer group bg-white border border-slate-200 rounded-2xl p-4 max-w-lg w-full shadow-sm hover:border-slate-300 transition-all select-none">
            <input 
              type="checkbox" 
              checked={isChecked}
              onChange={(e) => setIsChecked(e.target.checked)}
              className="w-5 h-5 rounded text-indigo-600 border-slate-300 focus:ring-indigo-500 transition-all cursor-pointer"
            />
            <span className="text-slate-600 text-xs sm:text-[13px] font-medium leading-relaxed">
              Je confirme avoir en ma possession au moins l'un de ces documents (Offre de prêt ou Tableau d'amortissement) pour finaliser ma demande d'étude.
            </span>
          </label>

          <button 
            disabled={!isChecked}
            onClick={onNext}
            className={`flex items-center justify-center gap-3 px-8 py-4 rounded-full font-bold text-[15px] transition-all shadow-sm w-full md:w-auto min-w-[280px] ${
              isChecked 
                ? "bg-[#111318] text-white hover:bg-slate-800 cursor-pointer" 
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            J'ai mes documents, on commence <ArrowRight className="w-[18px] h-[18px]" strokeWidth={2.5} />
          </button>
        </div>
      </motion.div>
    </div>
  );
}
