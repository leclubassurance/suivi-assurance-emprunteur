import React, { useMemo, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { getApiUrl, apiFetch } from "../../lib/utils";

export type StudyValidationPending = {
  dossierId: string;
  subject: string;
  submittedAt: string;
  debriefNote?: string;
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
  no_pending_validation: "Aucune validation en attente.",
  validation_pending: "Une validation est déjà en cours.",
  validation_already_approved: "Le courtage est déjà validé — envoyez l'étude depuis l'admin.",
  forbidden: "Accès refusé pour ce dossier.",
  dossier_not_found: "Dossier introuvable.",
  contract_required: "Signez d'abord votre contrat pour valider le courtage.",
};

export default function ConseillerStudyValidation({
  portalToken,
  validation,
  highlight,
  onApproved,
  sessionAuth = false,
  previewToken,
}: {
  portalToken: string;
  validation: StudyValidationPending;
  highlight?: boolean;
  onApproved: () => void | Promise<void>;
  sessionAuth?: boolean;
  previewToken?: string;
}) {
  const withPreview = (path: string) => {
    if (!previewToken) return path;
    const sep = path.includes("?") ? "&" : "?";
    return `${path}${sep}lcif_preview=${encodeURIComponent(previewToken)}`;
  };
  const portalFetch = (path: string, init?: RequestInit) => {
    const full = withPreview(path);
    if (previewToken) return fetch(getApiUrl(full), init);
    if (sessionAuth) return apiFetch(full, init);
    return fetch(getApiUrl(full), init);
  };
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
      const res = await portalFetch(
        `/api/apporteur-portal/${encodeURIComponent(portalToken)}/study-validation/${encodeURIComponent(validation.dossierId)}/approve`,
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
          <CheckCircle2 className="w-4 h-4" /> Courtage validé
        </p>
        <p className="text-xs mt-1">
          {summary.total} € total · Votre rétro ({sharePct} %) : {summary.retro} € — l&apos;équipe LCIF
          envoie l&apos;étude au client.
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
        Débrief — valider le courtage
      </p>
      <p className="text-xs text-slate-600 mb-3">
        Reçu le {new Date(validation.submittedAt).toLocaleString("fr-FR")}
      </p>
      {validation.debriefNote ? (
        <p className="text-xs text-slate-700 mb-3 bg-white/80 border border-indigo-100 rounded-lg px-3 py-2 leading-relaxed">
          <span className="font-bold text-indigo-900">Contexte LCIF : </span>
          {validation.debriefNote}
        </p>
      ) : null}
      <div className="grid sm:grid-cols-2 gap-2 text-xs mb-3">
        {validation.grossSavingsEur != null ? (
          <div className="bg-white/80 rounded-lg px-3 py-2 border border-indigo-100">
            <span className="text-slate-500">Économie estimée</span>
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
        Valider le courtage
      </button>
      <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
        L&apos;équipe LCIF enverra l&apos;étude au client après votre validation.
      </p>
    </div>
  );
}
