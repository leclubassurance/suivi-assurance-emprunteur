import React, { useState } from 'react';
import { motion } from 'motion/react';
import { InsuranceFormData, AppFile } from '../../types';
import { Upload, FileText, FileImage, Trash2, CheckCircle2, ArrowRight } from 'lucide-react';
import { generateId } from '../../lib/utils';
import { showToast } from '../../lib/toast';

interface Props {
  formData: InsuranceFormData;
  setFormData: React.Dispatch<React.SetStateAction<InsuranceFormData>>;
  onSubmit: () => void;
  isSubmitting?: boolean;
  submitStatus?: string;
}

export default function DocumentsStep({ formData, setFormData, onSubmit, isSubmitting, submitStatus }: Props) {
  const [dragActiveStates, setDragActiveStates] = useState<Record<string, boolean>>({});

  const handleDrag = (category: string, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActiveStates(prev => ({ ...prev, [category]: true }));
    } else if (e.type === "dragleave") {
      setDragActiveStates(prev => ({ ...prev, [category]: false }));
    }
  };

  const handleDrop = (category: string, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActiveStates(prev => ({ ...prev, [category]: false }));
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files, category);
    }
  };

  const handleFiles = (files: FileList | null, category: string) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    
    if (file.size > 50 * 1024 * 1024) {
      showToast(`Le fichier ${file.name} est trop volumineux (max 50 MB)`, 'error');
      return;
    }
    
    // Remove existing file for this category
    const filteredDocs = formData.documents.filter(d => (!d.id.startsWith(category)));
    
    const newFile: AppFile = {
      id: `${category}-${generateId()}`,
      name: file.name,
      size: file.size,
      type: file.type,
      uploadedAt: new Date().toISOString(),
      status: 'uploading',
      rawFile: file
    } as any;
    
    setFormData(prev => ({ ...prev, documents: [...filteredDocs, newFile] }));
    
    const reader = new FileReader();
    reader.onload = (e) => {
      setFormData(prev => ({
        ...prev,
        documents: prev.documents.map(d => 
          d.id === newFile.id 
            ? { ...d, status: 'success', base64Content: e.target?.result as string, rawFile: file } as any
            : d
        )
      }));
    };
    reader.readAsDataURL(file);
  };

  const removeDocument = (id: string) => {
    setFormData(prev => ({
      ...prev,
      documents: prev.documents.filter(d => d.id !== id)
    }));
  };

  const categories = [
    { id: 'offre', title: "Offre de prêt", desc: "Le contrat de prêt incluant les conditions (signée ou non)." },
    { id: 'tableau', title: "Tableau d'amortissement", desc: "Le tableau détaillé mois par mois sur la durée totale du prêt." },
    { id: 'fiche', title: "Fiche standardisée d'information", desc: "La fiche de synthèse récapitulative." }
  ];

  const isAnyFileUploading = formData.documents.some(d => d.status === 'uploading');

  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-8 space-y-10 pb-20">
      
      <section>
        <div className="text-center mb-8">
           <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-[#111318] mb-3">Vos documents</h2>
           <p className="text-slate-500 font-medium mt-1 text-[15px] max-w-xl mx-auto">Veuillez fournir les documents suivants pour démarrer l'analyse.</p>
        </div>

        <div className="space-y-5">
          {categories.map(category => {
            const existingDoc = formData.documents.find(d => d.id.startsWith(category.id));
            const isDragging = dragActiveStates[category.id] || false;

            return (
              <div key={category.id} className="bg-white border border-slate-200 rounded-[24px] p-6 shadow-sm overflow-hidden text-center md:text-left transition-all relative group">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  
                  <div className="md:w-1/2 shrink-0">
                    <h3 className="font-bold text-[16px] text-slate-800 mb-1">{category.title}</h3>
                    <p className="text-slate-500 text-[13px]">{category.desc}</p>
                  </div>

                  <div className="md:w-1/2 w-full">
                    {!existingDoc ? (
                      <div 
                        className={`border-2 border-dashed rounded-[20px] p-4 text-center transition-all bg-slate-50 relative ${isDragging ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}
                        onDragEnter={(e) => handleDrag(category.id, e)}
                        onDragLeave={(e) => handleDrag(category.id, e)}
                        onDragOver={(e) => handleDrag(category.id, e)}
                        onDrop={(e) => handleDrop(category.id, e)}
                      >
                        <Upload className="w-5 h-5 mx-auto mb-2 text-slate-400" />
                        <label className="cursor-pointer flex flex-col items-center justify-center gap-1 relative z-10 w-full h-full">
                          <span className="font-bold text-slate-700 hover:text-slate-900 text-[14px]">Cliquez ou glissez</span>
                          <span className="text-slate-400 text-[12px] font-medium hidden sm:block">Format PDF, JPG, PNG (Max 50MB)</span>
                          <input 
                            type="file" 
                            className="hidden" 
                            accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xlsx"
                            onChange={(e) => handleFiles(e.target.files, category.id)}
                          />
                        </label>
                      </div>
                    ) : (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="flex flex-col sm:flex-row justify-between items-center rounded-[20px] p-4 bg-slate-50 border border-slate-200 max-w-full overflow-hidden"
                      >
                        <div className="flex items-center gap-3 overflow-hidden min-w-0 md:max-w-[70%]">
                          {existingDoc.type.includes('image') && existingDoc.base64Content ? (
                            <img src={`data:${existingDoc.type};base64,${existingDoc.base64Content}`} alt="preview" className="w-[38px] h-[38px] object-cover rounded-[12px] shadow-sm shrink-0" />
                          ) : existingDoc.type.includes('pdf') ? (
                            <div className="bg-red-50 p-2.5 rounded-[12px] text-red-600 shadow-sm shrink-0">
                              <FileText className="w-[18px] h-[18px]" />
                            </div>
                          ) : (
                            <div className="bg-white p-2.5 rounded-[12px] text-blue-600 shadow-sm shrink-0">
                              <FileText className="w-[18px] h-[18px]" />
                            </div>
                          )}
                          <div className="min-w-0 text-left">
                            <p className="font-bold text-[13px] text-slate-800 truncate" title={existingDoc.name}>{existingDoc.name}</p>
                            <p className="text-[11px] font-bold text-slate-400">{(existingDoc.size / 1024 / 1024).toFixed(2)} MB</p>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-3 shrink-0 mt-3 sm:mt-0">
                          {existingDoc.status === 'success' && (
                            <CheckCircle2 className="w-5 h-5 text-green-500" />
                          )}
                          <button 
                            onClick={() => removeDocument(existingDoc.id)} 
                            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-slate-100 rounded-lg transition-colors bg-white shadow-sm sm:shadow-none sm:bg-transparent"
                            title="Supprimer"
                          >
                            <Trash2 className="w-[18px] h-[18px]" />
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Submission */}
      <div className="pt-8 border-t border-slate-200 flex flex-col items-center">
         <button 
           onClick={onSubmit} 
           disabled={formData.documents.length === 0 || isSubmitting || isAnyFileUploading} 
           className={`flex items-center justify-center gap-3 px-10 py-5 rounded-full font-bold text-[15px] transition-all shadow-sm w-full md:w-auto ${formData.documents.length === 0 || isSubmitting || isAnyFileUploading ? 'bg-slate-200 text-slate-500 cursor-not-allowed' : 'bg-[#111318] text-white hover:bg-slate-800'}`}
         >
           {isSubmitting ? (submitStatus || 'Envoi en cours...') : isAnyFileUploading ? 'Lecture du fichier...' : 'Valider mon dossier'} 
           {!isSubmitting && !isAnyFileUploading && <ArrowRight className="w-[18px] h-[18px]" strokeWidth={2.5} />}
         </button>
         <div className="mt-8 bg-blue-50/50 p-6 rounded-[24px] border border-blue-100/50 max-w-2xl text-center shadow-sm">
           <p className="text-slate-600 text-[14px] leading-relaxed font-medium">
             Un conseiller va prendre en charge votre dossier et revenir vers vous sous 48h ouvrées. Un e-mail automatique accusant réception vous sera envoyé.
           </p>
         </div>
      </div>

    </div>
  );
}

