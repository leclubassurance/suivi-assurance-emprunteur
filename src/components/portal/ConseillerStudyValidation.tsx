import React, { useMemo, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { getApiUrl } from "../../lib/utils";

export type StudyValidationPending = {
  dossierId: string;
  subject: string;
  submittedAt: string;
  grossSavingsEur: number | null;
  feesAssureurEur: number | null;
  assuredCount: number;
  feesPerAssuredEur: number;
  feesCourtageTotalEur: number;
  conseillerRetroEur: number;
  minPerAssuredEur: number;
  maxPerAssuredEur: number;
  payoutSharePercent: number;
};

const PORTAL_ERROR_LABELS: Record<string, string> = {
  study_already_sent: "L'étude a déjà été envoyée au client.",
  no_pending_validation: "Aucune étude en attente de validation.",
  patch_failed: "Impossible de mettre à jour la ligne « Frais de courtage » dans l'étude.",
  forbidden: "Accès refusé pour ce dossier.",
  dossier_not_found: "Dossier introuvable.",
};

export default function ConseillerStudyValidation({
  portalToken,
  validation,
  highlight,
  onApproved,
}: {
  portalToken: string;
  validation: StudyValidationPending;
  highlight?: boolean;
  onApproved: () => void | Promise<void>;
}) {
  const [feesPerAssured, setFeesPerAssured] = useState(validation.feesPerAssuredEur);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const summary = useMemo(() => {
    const total = Math.round(feesPerAssured * validation.assuredCount);
    const retro = Math.round(total * validation.payoutSharePercent);
    return { total, retro };
  }, [feesPerAssured, validation.assuredCount, validation.payoutSharePercent]);

  const sharePct = Math.round(validation.payoutSharePercent * 100);

  const handleApprove = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        getApiUrl(
          `/api/apporteur-portal/${encodeURIComponent(portalToken)}/study-validation/${encodeURIComponent(validation.dossierId)}/approve`,
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feesPerAssuredEur: feesPerAssured }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        setError(
          json.message ||
            PORTAL_ERROR_LABELS[String(json.error || "")] ||
            json.error ||
            "Validation impossible",
        );
        return;
      }
      setDone(true);
      await onApproved();
    } catch {
      setError("Erreur réseau");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="mt-3 p-4 rounded-xl border border-emerald-200 bg-emerald-50 text-sm text-emerald-900">
        <p className="font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> Étude envoyée au client
        </p>
        <p className="text-xs mt-1">
          Courtage total : {summary.total} € · Votre rétro ({sharePct} %) : {summary.retro} €
        </p>
      </div>
    );
  }

  return (
    <div
      className={`mt-3 p-4 rounded-xl border text-sm ${
        highlight
          ? "border-amber-300 bg-amber-50 ring-2 ring-amber-200"
          : "border-indigo-200 bg-indigo-50/80"
      }`}
    >
      <p className="text-[11px] font-black uppercase text-indigo-800 mb-1">
        Étude à valider — frais de courtage
      </p>
      <p className="text-xs text-slate-600 mb-3">
        Soumise le {new Date(validation.submittedAt).toLocaleString("fr-FR")}
      </p>
      <div className="grid sm:grid-cols-2 gap-2 text-xs mb-3">
        {validation.grossSavingsEur != null ? (
          <div className="bg-white/80 rounded-lg px-3 py-2 border border-indigo-100">
            <span className="text-slate-500">Économie affichée</span>
            <p className="font-black text-indigo-900">
              {Math.round(validation.grossSavingsEur).toLocaleString("fr-FR")} €
            </p>
          </div>
        ) : null}
        <div className="bg-white/80 rounded-lg px-3 py-2 border border-indigo-100">
          <span className="text-slate-500">Assurés</span>
          <p className="font-black text-indigo-900">{validation.assuredCount}</p>
        </div>
      </div>

      <label className="block text-xs font-bold text-slate-700 mb-1">
        Frais de courtage par assuré ({validation.minPerAssuredEur}–{validation.maxPerAssuredEur} €, ou 0 €)
      </label>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="number"
          min={0}
          max={validation.maxPerAssuredEur}
          step={10}
          value={feesPerAssured}
          onChange={(e) => setFeesPerAssured(Number(e.target.value))}
          className="w-28 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold"
        />
        <span className="text-xs text-slate-600">
          → Total : <strong>{summary.total} €</strong>
          {" · "}
          Votre rétro ({sharePct} %) : <strong className="text-emerald-700">{summary.retro} €</strong>
        </span>
      </div>

      {error ? <p className="text-xs text-red-700 mb-2">{error}</p> : null}

      <button
        type="button"
        disabled={submitting}
        onClick={handleApprove}
        className="w-full py-2.5 rounded-lg bg-[#1E3A8A] text-white font-bold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
        Valider et envoyer l&apos;étude au client
      </button>
      <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
        Seule la ligne « Frais de courtage » sera modifiée dans le mail. Le reste de l&apos;étude reste inchangé.
      </p>
    </div>
  );
}
