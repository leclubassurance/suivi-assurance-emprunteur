import React from 'react';
import { motion } from 'motion/react';
import { InsuranceFormData, FormErrors } from '../../types';
import { Button } from '../ui/Button';
import { Plus, Trash2, ArrowRight } from 'lucide-react';

interface Props {
  formData: InsuranceFormData;
  setFormData: React.Dispatch<React.SetStateAction<InsuranceFormData>>;
  errors: FormErrors;
  onNext: () => void;
}

export default function ProjetStep({ formData, setFormData, errors, onNext }: Props) {
  
  const updateCrd = (index: number, value: string) => {
    setFormData(prev => {
      const newPrets = [...prev.prets];
      newPrets[index] = { ...newPrets[index], capitalRestant: value as unknown as number };
      return { ...prev, prets: newPrets };
    });
  };

  const addPret = () => {
    setFormData(prev => ({
      ...prev,
      prets: [...prev.prets, { capitalRestant: 0 }]
    }));
  };

  const removePret = (index: number) => {
    setFormData(prev => {
      const newPrets = [...prev.prets];
      if (newPrets.length > 1) {
        newPrets.splice(index, 1);
      } else {
        newPrets[0] = { capitalRestant: 0 };
      }
      return { ...prev, prets: newPrets };
    });
  };

  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-8 flex flex-col justify-center pb-20">
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="text-center mb-8">
           <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-[#111318] mb-3">Votre Projet</h2>
           <p className="text-slate-500 font-medium mt-1 text-[15px]">
             Indiquez le <strong>capital restant dû à ce jour</strong> : en clair, combien il vous reste à rembourser actuellement (valeur affichée dans votre application bancaire).
           </p>
        </div>

        <div className="bg-white border border-slate-200/60 rounded-[28px] p-6 md:p-8 shadow-sm space-y-6">
          {formData.prets.map((pret, index) => (
            <div key={index} className="p-5 md:p-6 border border-slate-200 rounded-[20px] bg-slate-50 relative">
              {formData.prets.length > 1 && (
                 <div className="flex justify-between items-center mb-4">
                  <span className="text-[11px] uppercase tracking-wider font-bold text-slate-500">Prêt {index + 1}</span>
                  <button 
                    onClick={() => removePret(index)}
                    className="text-slate-400 hover:text-red-500 transition-colors p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-2">
                <div>
                  <label className="text-[13px] font-bold text-slate-700 block mb-2">
                    Capital restant dû {formData.prets.length === 1 ? '' : '*'}
                  </label>
                  <input 
                    type="number"
                    placeholder="Ex: 150000"
                    value={pret.capitalRestant?.toString() === '0' && index === 0 ? '' : pret.capitalRestant?.toString() || ''}
                    onChange={(e) => updateCrd(index, e.target.value)}
                    className={`bento-input bg-white ${errors[`capitalRestant_${index}`] || (index === 0 && errors.capitalRestant) ? 'border-red-300 ring-1 ring-red-100' : ''}`}
                  />
                  {(errors[`capitalRestant_${index}`] || (index === 0 && errors.capitalRestant)) && (
                     <p className="text-red-500 text-xs mt-1.5 font-medium">
                       {errors[`capitalRestant_${index}`] || (index === 0 && errors.capitalRestant)}
                     </p>
                  )}
                </div>
                <div>
                  <label className="text-[13px] font-bold text-slate-700 block mb-2">
                    Banque prêteuse
                  </label>
                  <input 
                    type="text"
                    placeholder="Ex: LCL, Crédit Agricole..."
                    value={pret.banquePreteuse || ''}
                    onChange={(e) => {
                      const newPrets = [...formData.prets];
                      newPrets[index] = { ...newPrets[index], banquePreteuse: e.target.value };
                      setFormData(prev => ({ ...prev, prets: newPrets }));
                    }}
                    className={`bento-input bg-white`}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-[13px] font-bold text-slate-700 block mb-2">
                    Date de 1ère échéance (facultatif)
                  </label>
                  <input 
                    type="month"
                    value={pret.datePremiereEcheance || ''}
                    onChange={(e) => {
                      const newPrets = [...formData.prets];
                      newPrets[index] = { ...newPrets[index], datePremiereEcheance: e.target.value };
                      setFormData(prev => ({ ...prev, prets: newPrets }));
                    }}
                    className={`bento-input bg-white`}
                  />
                </div>
              </div>
              <p className="text-[13px] text-slate-500 mt-3 flex gap-2">
                <span className="text-[15px]">💡</span>
                <span>
                  Vous le trouverez dans votre application bancaire (rubrique <strong>Crédit</strong> / <strong>Prêt immobilier</strong>) ou sur votre échéancier. À défaut, une estimation suffit.
                </span>
              </p>
            </div>
          ))}

          <button 
            type="button" 
            onClick={addPret} 
            className="w-full py-4 border-2 border-dashed border-slate-200 rounded-[20px] text-slate-500 font-bold hover:border-slate-300 hover:text-slate-700 hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Ajouter un autre prêt
          </button>
        </div>

        <div className="flex justify-end pt-6">
          <button 
            onClick={onNext}
            className="bg-[#111318] text-white hover:bg-slate-800 flex items-center justify-center gap-3 px-8 py-4 rounded-full font-bold text-[15px] transition-all shadow-sm w-full sm:w-auto"
          >
            Continuer <ArrowRight className="w-[18px] h-[18px]" strokeWidth={2.5} />
          </button>
        </div>
      </motion.div>
    </div>
  );
}
