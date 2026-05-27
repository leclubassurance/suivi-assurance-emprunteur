import React from 'react';
import { motion } from 'motion/react';
import { InsuranceFormData, FormErrors } from '../../types';
import { INITIAL_ASSURE } from '../../constants';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Plus, Trash2, ArrowRight } from 'lucide-react';
import { generateId } from '../../lib/utils';

interface Props {
  formData: InsuranceFormData;
  setFormData: React.Dispatch<React.SetStateAction<InsuranceFormData>>;
  errors: FormErrors;
  onNext: () => void;
}

export default function CoordonneesStep({ formData, setFormData, errors, onNext }: Props) {
  
  const addAssure = () => {
    if (formData.assures.length < 2) {
      setFormData(prev => ({
        ...prev,
        assures: [...prev.assures, { ...INITIAL_ASSURE, id: generateId() }]
      }));
    }
  };

  const removeAssure = (index: number) => {
    if (index > 0) {
      setFormData(prev => ({
        ...prev,
        assures: prev.assures.filter((_, i) => i !== index)
      }));
    }
  };

  const updateAssure = (index: number, field: string, value: any) => {
    setFormData(prev => {
      const newAssures = [...prev.assures];
      newAssures[index] = { ...newAssures[index], [field]: value };
      return { ...prev, assures: newAssures };
    });
  };

  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-8 space-y-6 pb-20">
      <div className="text-center mb-8">
         <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-[#111318] mb-3">Vos coordonnées</h2>
         <p className="text-slate-500 font-medium mt-1 text-[15px]">Renseignez vos informations de contact.</p>
      </div>

      {formData.assures.map((assure, index) => (
        <motion.div 
          key={assure.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white border border-slate-200/60 rounded-[28px] p-6 md:p-8 shadow-sm"
        >
          <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100">
            <span className="text-[11px] uppercase tracking-wider font-bold text-slate-500">Assuré {index + 1}</span>
            {index > 0 && (
              <button 
                onClick={() => removeAssure(index)}
                className="text-slate-400 hover:text-red-500 p-1 rounded-lg transition-colors"
                title="Supprimer l'assuré"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Select 
              label="Civilité"
              value={assure.civilite}
              onChange={(e) => updateAssure(index, 'civilite', e.target.value)}
              options={[{value: 'Madame', label: 'Madame'}, {value: 'Monsieur', label: 'Monsieur'}]}
            />
            <div className="hidden md:block"></div>

            <Input 
              label="Nom *"
              placeholder="Votre nom de famille"
              value={assure.nom}
              onChange={(e) => updateAssure(index, 'nom', e.target.value)}
              error={errors[`assure_${index}_nom`]}
            />
            
            <Input 
              label="Prénom *"
              placeholder="Votre prénom"
              value={assure.prenom}
              onChange={(e) => updateAssure(index, 'prenom', e.target.value)}
              error={errors[`assure_${index}_prenom`]}
            />

            <Input 
              label="Date de naissance *"
              type="date"
              max={new Date().toISOString().split("T")[0]}
              value={assure.dateNaissance}
              onChange={(e) => updateAssure(index, 'dateNaissance', e.target.value)}
              error={errors[`assure_${index}_dateNaissance`]}
            />
            <div className="hidden md:block"></div>

            <Input 
              label="Email"
              type="email"
              placeholder="votre.email@example.com"
              value={assure.email}
              onChange={(e) => updateAssure(index, 'email', e.target.value)}
              error={errors[`assure_${index}_email`]}
            />

            <Input 
              label="Téléphone"
              type="tel"
              placeholder="06 XX XX XX XX"
              value={assure.telephone}
              onChange={(e) => updateAssure(index, 'telephone', e.target.value)}
            />
          </div>
        </motion.div>
      ))}

      {formData.assures.length < 2 && (
        <button 
          onClick={addAssure}
          className="w-full py-4 border-2 border-dashed border-slate-200 rounded-[24px] text-slate-500 font-bold hover:border-slate-300 hover:text-slate-700 hover:bg-slate-50 transition-all flex items-center justify-center gap-2 bg-white shadow-sm"
        >
          <Plus className="w-5 h-5" />
          Ajouter un 2ème assuré
        </button>
      )}

      <div className="flex justify-end pt-6">
        <button 
          onClick={onNext}
          className="bg-[#111318] text-white hover:bg-slate-800 flex items-center justify-center gap-3 px-8 py-4 rounded-full font-bold text-[15px] transition-all shadow-sm w-full sm:w-auto"
        >
          Continuer <ArrowRight className="w-[18px] h-[18px]" strokeWidth={2.5} />
        </button>
      </div>

    </div>
  );
}
