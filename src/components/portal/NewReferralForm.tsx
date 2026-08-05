import React from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "../ui/Button";

export type NewReferralFormValues = {
  prenom: string;
  nom: string;
  email: string;
  phone: string;
  notes: string;
};

type Props = {
  values: NewReferralFormValues;
  onChange: (next: NewReferralFormValues) => void;
  onSubmit: (e: React.FormEvent) => void;
  submitting?: boolean;
  error?: string | null;
  onCancel?: () => void;
  cancelLabel?: string;
};

/** Formulaire isolé — utilisé en page dédiée pour éviter les bugs de scroll/modale. */
export default function NewReferralForm({
  values,
  onChange,
  onSubmit,
  submitting,
  error,
  onCancel,
  cancelLabel = "Annuler",
}: Props) {
  const set = (patch: Partial<NewReferralFormValues>) => onChange({ ...values, ...patch });

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block text-xs font-bold text-slate-600">
          Prénom
          <input
            id="ap-new-referral-prenom"
            type="text"
            autoComplete="given-name"
            className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-normal"
            value={values.prenom}
            onChange={(e) => set({ prenom: e.target.value })}
            required
          />
        </label>
        <label className="block text-xs font-bold text-slate-600">
          Nom
          <input
            type="text"
            autoComplete="family-name"
            className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-normal"
            value={values.nom}
            onChange={(e) => set({ nom: e.target.value })}
            required
          />
        </label>
      </div>
      <label className="block text-xs font-bold text-slate-600">
        Email
        <input
          type="email"
          autoComplete="email"
          className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-normal"
          value={values.email}
          onChange={(e) => set({ email: e.target.value })}
        />
      </label>
      <label className="block text-xs font-bold text-slate-600">
        Téléphone
        <input
          type="tel"
          autoComplete="tel"
          className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-normal"
          value={values.phone}
          onChange={(e) => set({ phone: e.target.value })}
        />
      </label>
      <p className="text-[11px] text-slate-500">Email ou téléphone requis.</p>
      <label className="block text-xs font-bold text-slate-600">
        Contexte (optionnel)
        <textarea
          className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-normal min-h-[72px] bento-input h-auto"
          value={values.notes}
          onChange={(e) => set({ notes: e.target.value })}
        />
      </label>
      {error ? (
        <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5 font-medium">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col sm:flex-row gap-2 pt-1">
        <Button type="submit" disabled={submitting} className="w-full sm:flex-1">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Envoyer la recommandation
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" disabled={submitting} className="w-full sm:w-auto" onClick={onCancel}>
            {cancelLabel}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
