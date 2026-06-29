import { FormErrors, InsuranceFormData } from '../types';
import { STATUT_PRO_OPTIONS } from '../constants';

function resolveAssureProfession(assure: { statutPro?: string; profession?: string }): string {
  if (assure.statutPro && assure.statutPro !== "autre") {
    return STATUT_PRO_OPTIONS.find((o) => o.value === assure.statutPro)?.label || assure.profession || "";
  }
  return assure.profession || "";
}

export const validateProjet = (formData: InsuranceFormData): FormErrors => {
  const errors: FormErrors = {};
  formData.prets.forEach((pret, index) => {
    if (!pret.capitalRestant || Number(pret.capitalRestant) <= 0) {
       errors[`capitalRestant_${index}`] = "Le capital restant dû est requis.";
    }
  });

  return errors;
};

export const validateCoordonnees = (assures: any[]): FormErrors => {
  const errors: FormErrors = {};

  assures.forEach((assure, idx) => {
    const prefix = `assure_${idx}_`;
    
    if (!assure.nom || assure.nom.trim().length < 2) {
      errors[`${prefix}nom`] = `Assuré ${idx + 1}: Le nom est requis et doit contenir au moins 2 caractères`;
    }
    
    if (!assure.prenom || assure.prenom.trim().length < 2) {
      errors[`${prefix}prenom`] = `Assuré ${idx + 1}: Le prénom est requis et doit contenir au moins 2 caractères`;
    }

    if (!assure.dateNaissance) {
      errors[`${prefix}dateNaissance`] = `Assuré ${idx + 1}: La date de naissance est requise`;
    } else {
      const birthDate = new Date(assure.dateNaissance);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      if (age < 18) {
        errors[`${prefix}dateNaissance`] = `Assuré ${idx + 1}: Vous devez avoir au moins 18 ans`;
      }
    }

    if (!assure.email) {
      errors[`${prefix}email`] = `Assuré ${idx + 1}: L'email est requis`;
    }

    if (!assure.telephone) {
      errors[`${prefix}telephone`] = `Assuré ${idx + 1}: Le téléphone est requis`;
    } else if (assure.telephone.replace(/[^0-9+]/g, '').length < 9) {
      errors[`${prefix}telephone`] = `Assuré ${idx + 1}: Le téléphone est invalide`;
    }
  });

  return errors;
};

export const validateInfoPerso = (assures: any[]): FormErrors => {
  const errors: FormErrors = {};

  assures.forEach((assure, idx) => {
    const prefix = `assure_${idx}_`;
    
    if (!assure.qualite) {
      errors[`${prefix}qualite`] = `Assuré ${idx + 1}: La qualité est requise`;
    }
    
    if (!assure.cpResidence || assure.cpResidence.length < 3) {
      errors[`${prefix}cpResidence`] = `Assuré ${idx + 1}: Le code postal est invalide`;
    }

    if (!assure.statutPro) {
      errors[`${prefix}statutPro`] = `Assuré ${idx + 1}: Le statut professionnel est obligatoire`;
    }

    const profession = resolveAssureProfession(assure);
    if (!profession || profession.length < 2) {
      errors[`${prefix}profession`] = `Assuré ${idx + 1}: La profession est obligatoire`;
    }

    if (assure.sportsRisque && assure.selectedSports.length > 10) {
      errors[`${prefix}sports`] = `Assuré ${idx + 1}: Maximum 10 sports autorisés`;
    }
  });

  return errors;
};
