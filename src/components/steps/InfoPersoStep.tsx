import React, { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { InsuranceFormData, FormErrors } from '../../types';
import { QUALITE_OPTIONS, STATUT_PRO_OPTIONS, PROFESSION_RISQUE_OPTIONS, DEPLACEMENTS_PRO_OPTIONS, SPORTS_RISQUE_CATEGORIES } from '../../constants';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Checkbox } from '../ui/Checkbox';
import { X, Search, ArrowRight } from 'lucide-react';

interface Props {
  formData: InsuranceFormData;
  setFormData: React.Dispatch<React.SetStateAction<InsuranceFormData>>;
  errors: FormErrors;
  onNext: () => void;
}

export default function InfoPersoStep({ formData, setFormData, errors, onNext }: Props) {
  
  const [sportsSearch, setSportsSearch] = useState('');

  const updateAssure = (index: number, field: string, value: any) => {
    setFormData(prev => {
      const newAssures = [...prev.assures];
      newAssures[index] = { ...newAssures[index], [field]: value };
      return { ...prev, assures: newAssures };
    });
  };

  const updateStatutPro = (index: number, statutPro: string) => {
    setFormData(prev => {
      const newAssures = [...prev.assures];
      const previousStatutLabel = STATUT_PRO_OPTIONS.find(
        (o) => o.value === newAssures[index]?.statutPro,
      )?.label;
      const currentProfession = String(newAssures[index]?.profession || "").trim();
      const professionLooksAutoFilled =
        currentProfession &&
        (currentProfession === previousStatutLabel ||
          STATUT_PRO_OPTIONS.some((o) => o.label === currentProfession || o.value === currentProfession));
      const assure = {
        ...newAssures[index],
        statutPro,
        profession: professionLooksAutoFilled ? "" : currentProfession,
      };
      newAssures[index] = assure;
      return { ...prev, assures: newAssures };
    });
  };

  const toggleSport = (assureIndex: number, sportName: string) => {
    setFormData(prev => {
      const newAssures = [...prev.assures];
      const assure = newAssures[assureIndex];
      let newSports = [...assure.selectedSports];
      
      if (newSports.includes(sportName)) {
        newSports = newSports.filter(s => s !== sportName);
      } else {
        if (newSports.length < 10) {
          newSports.push(sportName);
        }
      }
      
      newAssures[assureIndex] = { ...assure, selectedSports: newSports };
      return { ...prev, assures: newAssures };
    });
  };

  const filteredSports = useMemo<Record<string, string[]>>(() => {
    if (!sportsSearch) return SPORTS_RISQUE_CATEGORIES;
    
    const result: Record<string, string[]> = {};
    const searchLower = sportsSearch.toLowerCase();
    
    Object.entries(SPORTS_RISQUE_CATEGORIES).forEach(([category, sports]) => {
      const matched = sports.filter(s => s.toLowerCase().includes(searchLower));
      if (matched.length > 0) {
        result[category] = matched;
      }
    });
    return result;
  }, [sportsSearch]);

  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-8 space-y-6 pb-20">
      <div className="text-center mb-8">
         <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-[#111318] mb-3">Informations Personnelles</h2>
         <p className="text-slate-500 font-medium mt-1 text-[15px]">Détails sur votre situation et profession.</p>
      </div>

      {formData.assures.map((assure, index) => (
        <motion.div 
          key={assure.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white border border-slate-200/60 rounded-[28px] p-6 md:p-8 shadow-sm space-y-8"
        >
          <div className="border-b border-slate-100 pb-4">
            <span className="text-[11px] uppercase tracking-wider font-bold text-slate-500">
              Assuré {index + 1} {assure.prenom ? `- ${assure.prenom} ${assure.nom}` : ''}
            </span>
          </div>

          <div className="space-y-6">
            <h4 className="text-[14px] font-bold text-slate-800">Qualité & Résidence</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <Select 
                  label="Qualité *"
                  value={assure.qualite}
                  onChange={(e) => updateAssure(index, 'qualite', e.target.value)}
                  options={QUALITE_OPTIONS}
                  error={errors[`assure_${index}_qualite`]}
                />
              </div>
              <Input 
                label="Pays de résidence"
                value={assure.paysResidence}
                onChange={(e) => updateAssure(index, 'paysResidence', e.target.value)}
              />
              <Input 
                label="Code Postal de résidence *"
                value={assure.cpResidence}
                onChange={(e) => updateAssure(index, 'cpResidence', e.target.value)}
                error={errors[`assure_${index}_cpResidence`]}
              />
            </div>
          </div>

          <div className="space-y-6">
            <h4 className="text-[14px] font-bold text-slate-800 border-t border-slate-100 pt-6">Situation professionnelle</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Select 
                label="Statut professionnel *"
                value={assure.statutPro}
                onChange={(e) => updateStatutPro(index, e.target.value)}
                options={STATUT_PRO_OPTIONS}
                error={errors[`assure_${index}_statutPro`]}
              />
              <div>
                <Input 
                  label="Métier exercé *"
                  placeholder="Ex: infirmière, ingénieur, artisan..."
                  value={assure.profession}
                  onChange={(e) => updateAssure(index, 'profession', e.target.value)}
                  autoComplete="off"
                  error={errors[`assure_${index}_profession`]}
                />
                <p className="mt-1.5 text-[12px] text-slate-500 leading-relaxed">
                  Indiquez votre métier précis, pas uniquement votre statut professionnel.
                </p>
              </div>
              <div className="md:col-span-2">
                <Select 
                  label="Profession à risque"
                  value={assure.professionRisque}
                  onChange={(e) => updateAssure(index, 'professionRisque', e.target.value)}
                  options={PROFESSION_RISQUE_OPTIONS}
                />
              </div>
              
              <div className="space-y-4 md:col-span-2 bg-slate-50 p-5 rounded-2xl border border-slate-200">
                <Checkbox 
                  label="Exercer une profession manuelle"
                  checked={assure.professionManuelle}
                  onChange={(e) => updateAssure(index, 'professionManuelle', e.target.checked)}
                />
                <Checkbox 
                  label="Effectuer des travaux en hauteur (> 2m d'altitude)"
                  checked={assure.travauxHauteur}
                  onChange={(e) => updateAssure(index, 'travauxHauteur', e.target.checked)}
                />
              </div>

              <div className="md:col-span-2">
                <Select 
                  label="Déplacements professionnels"
                  value={assure.deplacementsPro}
                  onChange={(e) => updateAssure(index, 'deplacementsPro', e.target.value)}
                  options={DEPLACEMENTS_PRO_OPTIONS}
                />
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <h4 className="text-[14px] font-bold text-slate-800 border-t border-slate-100 pt-6">Santé & Loisirs</h4>
            <div className="space-y-4 px-1">
              <Checkbox 
                label="Je suis fumeur"
                checked={assure.fumeur}
                onChange={(e) => updateAssure(index, 'fumeur', e.target.checked)}
              />
              <Checkbox 
                label="Je pratique des sports à risque"
                checked={assure.sportsRisque}
                onChange={(e) => {
                  updateAssure(index, 'sportsRisque', e.target.checked);
                  // Resets selected sports if unchecking
                  if (!e.target.checked) updateAssure(index, 'selectedSports', []);
                }}
              />

              {assure.sportsRisque && (
                 <div className="mt-4 p-5 border border-slate-200 rounded-[16px] bg-slate-50 space-y-4">
                   <div className="relative">
                     <Search className="absolute left-4 top-3.5 w-5 h-5 text-slate-400" />
                     <input 
                       type="text"
                       placeholder="Rechercher un sport..."
                       value={sportsSearch}
                       onChange={e => setSportsSearch(e.target.value)}
                       className="w-full h-[46px] pl-[42px] pr-4 rounded-[12px] border border-slate-200 bg-white transition-all outline-none hover:border-slate-300 focus:border-slate-400 text-[14px] shadow-sm"
                     />
                   </div>
                   
                   {assure.selectedSports.length > 0 && (
                     <div className="flex flex-wrap gap-2">
                       {assure.selectedSports.map(sport => (
                         <span key={sport} className="inline-flex items-center px-3 py-1.5 rounded-full text-[12px] bg-blue-100 text-[#1e40af] font-bold border border-blue-200">
                           {sport}
                           <button 
                             onClick={() => toggleSport(index, sport)}
                             className="ml-2 hover:bg-blue-200 rounded-full p-0.5 transition-colors"
                           >
                             <X className="w-3 h-3" />
                           </button>
                         </span>
                       ))}
                     </div>
                   )}

                   {errors[`assure_${index}_sports`] && (
                     <p className="text-[13px] text-red-500 font-medium">{errors[`assure_${index}_sports`]}</p>
                   )}

                   <div className="max-h-64 overflow-y-auto space-y-6 pr-2 custom-scrollbar">
                      {Object.keys(filteredSports).length === 0 ? (
                        <p className="text-slate-500 text-center py-4 text-[14px] font-medium">Aucun sport trouvé</p>
                      ) : (
                        Object.entries(filteredSports).map(([cat, sports]) => (
                          <div key={cat}>
                            <h5 className="font-bold text-slate-800 capitalize mb-3 text-[13px] tracking-wide">{cat}</h5>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {(sports as string[]).map(sport => (
                                <Checkbox 
                                  key={sport} 
                                  label={sport}
                                  checked={assure.selectedSports.includes(sport)}
                                  onChange={() => toggleSport(index, sport)}
                                  disabled={!assure.selectedSports.includes(sport) && assure.selectedSports.length >= 10}
                                />
                              ))}
                            </div>
                          </div>
                        ))
                      )}
                   </div>
                 </div>
              )}
            </div>
          </div>
        </motion.div>
      ))}

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
