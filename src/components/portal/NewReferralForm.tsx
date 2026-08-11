import React, { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "../ui/Button";

export type NewReferralFormValues = {
  prenom: string;
  nom: string;
  email: string;
  phone: string;
  notes: string;
};

export const EMPTY_NEW_REFERRAL_FORM: NewReferralFormValues = {
  prenom: "",
  nom: "",
  email: "",
  phone: "",
  notes: "",
};

type Props = {
  /** Envoi async — le formulaire gère lui-même l'état submitting (évite les écrans blancs). */
  onSubmit: (values: NewReferralFormValues) => Promise<void>;
  onCancel?: () => void;
  cancelLabel?: string;
  initialValues?: Partial<NewReferralFormValues>;
};

/** Formulaire isolé et autonome : état local + submitting interne. */
export default function NewReferralForm({
  onSubmit,
  onCancel,
  cancelLabel = "Annuler",
  initialValues,
}: Props) {
  const [values, setValues] = useState<NewReferralFormValues>({
    ...EMPTY_NEW_REFERRAL_FORM,
    ...initialValues,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<NewReferralFormValues>) =>
    setValues((prev) => ({ ...prev, ...patch }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(values);
      setValues({ ...EMPTY_NEW_REFERRAL_FORM });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : typeof err === "string" ? err : "Erreur";
      setError(message || "Erreur");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3" noValidate={false}>
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
            disabled={submitting}
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
            disabled={submitting}
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
          disabled={submitting}
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
          disabled={submitting}
        />
      </label>
      <p className="text-[11px] text-slate-500">Email ou téléphone requis.</p>
      <label className="block text-xs font-bold text-slate-600">
        Contexte (optionnel)
        <textarea
          className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-normal min-h-[72px] bento-input h-auto"
          value={values.notes}
          onChange={(e) => set({ notes: e.target.value })}
          disabled={submitting}
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
