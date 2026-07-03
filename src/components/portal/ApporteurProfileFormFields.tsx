import React from "react";
import type { ApporteurType } from "../../../shared/apporteurTypes";
import { APPORTEUR_TYPE_LABELS } from "../../../shared/apporteurTypes";
import { APPORTEUR_LEGAL_FORM_OPTIONS } from "../../../shared/apporteurProfile";
import { resolveCompanyNamesFromRegistryLookup } from "../../../shared/companyRegistryName";
import SiretLookupField, { type SiretLookupResult } from "./SiretLookupField";

export type ApporteurProfileFormState = {
  contactPrenom: string;
  contactNom: string;
  companyName: string;
  companyLegalName: string;
  email: string;
  phone: string;
  addressLine: string;
  postalCode: string;
  city: string;
  siret: string;
  siren: string;
  legalForm: string;
  legalFormOther: string;
  type: ApporteurType;
  typeCustomLabel: string;
};

export const EMPTY_APPORTEUR_PROFILE_FORM: ApporteurProfileFormState = {
  contactPrenom: "",
  contactNom: "",
  companyName: "",
  companyLegalName: "",
  email: "",
  phone: "",
  addressLine: "",
  postalCode: "",
  city: "",
  siret: "",
  siren: "",
  legalForm: "",
  legalFormOther: "",
  type: "apporteur_affaires",
  typeCustomLabel: "",
};

export function apporteurToProfileForm(
  apporteur: Partial<ApporteurProfileFormState> & { contactName?: string },
): ApporteurProfileFormState {
  const prenom = apporteur.contactPrenom || "";
  const nom = apporteur.contactNom || "";
  let contactPrenom = prenom;
  let contactNom = nom;
  if (!prenom && !nom && apporteur.contactName) {
    const parts = apporteur.contactName.trim().split(/\s+/);
    contactPrenom = parts[0] || "";
    contactNom = parts.slice(1).join(" ");
  }
  return {
    contactPrenom,
    contactNom,
    companyName: apporteur.companyName || "",
    companyLegalName: apporteur.companyLegalName || "",
    email: apporteur.email || "",
    phone: apporteur.phone || "",
    addressLine: apporteur.addressLine || "",
    postalCode: apporteur.postalCode || "",
    city: apporteur.city || "",
    siret: apporteur.siret || "",
    siren: apporteur.siren || "",
    legalForm: apporteur.legalForm || "",
    legalFormOther: apporteur.legalFormOther || "",
    type: (apporteur.type as ApporteurType) || "apporteur_affaires",
    typeCustomLabel: apporteur.typeCustomLabel || "",
  };
}

function Field({
  label,
  value,
  onChange,
  required,
  placeholder,
  type = "text",
  disabled,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className="text-xs font-bold text-slate-600 block">
      {label}
      {required ? <span className="text-red-500"> *</span> : null}
      <input
        type={type}
        inputMode="text"
        autoComplete="off"
        className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-normal disabled:bg-slate-100 disabled:text-slate-500"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        readOnly={disabled}
      />
      {hint ? <span className="mt-1 block text-[10px] font-normal text-slate-500">{hint}</span> : null}
    </label>
  );
}

export default function ApporteurProfileFormFields({
  value,
  onChange,
  emailEditable = true,
  allowedTypes,
  hideTypeField = false,
  emailHint,
}: {
  value: ApporteurProfileFormState;
  onChange: (next: ApporteurProfileFormState) => void;
  emailEditable?: boolean;
  allowedTypes?: ApporteurType[];
  hideTypeField?: boolean;
  emailHint?: string;
}) {
  const set = <K extends keyof ApporteurProfileFormState>(key: K, v: ApporteurProfileFormState[K]) => {
    onChange({ ...value, [key]: v });
  };

  const applySiretMatch = (match: SiretLookupResult) => {
    const resolved = resolveCompanyNamesFromRegistryLookup(match);
    const companyName = value.companyName.trim() || resolved.suggestedCompanyName;
    onChange({
      ...value,
      siren: match.siren,
      siret: match.siret || value.siret,
      companyLegalName: resolved.companyLegalName,
      companyName,
      addressLine: value.addressLine || match.addressLine || "",
      postalCode: value.postalCode || match.postalCode || "",
      city: value.city || match.city || "",
    });
  };

  return (
    <div className="grid gap-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field
          label="Prénom"
          value={value.contactPrenom}
          onChange={(v) => set("contactPrenom", v)}
          required
        />
        <Field
          label="Nom de famille"
          value={value.contactNom}
          onChange={(v) => set("contactNom", v)}
          required
        />
      </div>

      <Field
        label="Raison sociale / enseigne"
        value={value.companyName}
        onChange={(v) => set("companyName", v)}
        placeholder="Ex. Cabinet Dupont — ou SIREN/SIRET si non diffusé"
        hint="Les chiffres sont acceptés (ex. si l'INSEE ne diffuse pas la dénomination)."
      />

      {value.companyName.trim() || value.siret.trim() ? (
        <SiretLookupField
          siret={value.siret}
          onSiretChange={(v) => set("siret", v)}
          companyName={value.companyName}
          onCompanyNameChange={(v) => set("companyName", v)}
          onVerified={applySiretMatch}
          required={Boolean(value.companyName.trim())}
        />
      ) : (
        <p className="text-[10px] text-slate-500">
          Si vous agissez pour une société, renseignez la raison sociale (ou le SIREN/SIRET) puis vérifiez.
        </p>
      )}

      {value.siren ? (
        <Field
          label="Dénomination au registre (figurera au contrat)"
          value={value.companyLegalName}
          onChange={(v) => set("companyLegalName", v)}
          placeholder="Raison sociale INSEE ou SIREN/SIRET"
          hint="Modifiable si les données sont protégées au registre national."
        />
      ) : null}

      <Field
        label="Email"
        value={value.email}
        onChange={(v) => set("email", v)}
        required
        type="email"
        disabled={!emailEditable}
        placeholder={emailHint ? "prenom.nom@leclubimmobilier.fr" : undefined}
        hint={emailHint}
      />
      {!emailEditable ? (
        <p className="text-[10px] text-slate-500 -mt-2">L&apos;email ne peut pas être modifié ici.</p>
      ) : null}

      <Field
        label="Téléphone"
        value={value.phone}
        onChange={(v) => set("phone", v)}
        required
        type="tel"
        placeholder="06 12 34 56 78"
      />

      <Field
        label="Adresse (numéro et voie)"
        value={value.addressLine}
        onChange={(v) => set("addressLine", v)}
        required
        placeholder="12 rue de la Paix"
      />

      <div className="grid sm:grid-cols-2 gap-3">
        <Field
          label="Code postal"
          value={value.postalCode}
          onChange={(v) => set("postalCode", v)}
          required
        />
        <Field
          label="Ville"
          value={value.city}
          onChange={(v) => set("city", v)}
          required
        />
      </div>

      <label className="text-xs font-bold text-slate-600 block">
        Forme juridique (optionnel)
        <select
          className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-normal"
          value={value.legalForm}
          onChange={(e) => set("legalForm", e.target.value)}
        >
          <option value="">— Non renseigné —</option>
          {APPORTEUR_LEGAL_FORM_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {value.legalForm === "autre" ? (
        <Field
          label="Précisez la forme juridique"
          value={value.legalFormOther}
          onChange={(v) => set("legalFormOther", v)}
          required
        />
      ) : null}

      {!hideTypeField ? (
      <label className="text-xs font-bold text-slate-600 block">
        Statut professionnel<span className="text-red-500"> *</span>
        <select
          className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-normal"
          value={value.type}
          onChange={(e) => set("type", e.target.value as ApporteurType)}
        >
          {Object.entries(APPORTEUR_TYPE_LABELS)
            .filter(([k]) => !allowedTypes || allowedTypes.includes(k as ApporteurType))
            .map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>
      ) : null}

      {value.type === "autre" ? (
        <Field
          label="Précisez votre statut"
          value={value.typeCustomLabel}
          onChange={(v) => set("typeCustomLabel", v)}
          required
          placeholder="Ex. coach immobilier, CGP, mandataire…"
        />
      ) : null}
    </div>
  );
}
