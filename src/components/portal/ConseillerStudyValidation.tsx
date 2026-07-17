import React, { useMemo, useState } from "react";
import { CheckCircle2, Eye, Loader2, X } from "lucide-react";
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
  lowSavingsException?: boolean;
};

const PORTAL_ERROR_LABELS: Record<string, string> = {
  study_already_sent: "L'étude a déjà été envoyée au client.",
  no_pending_validation: "Aucune validation en attente.",
  validation_pending: "Une validation est déjà en cours.",
  validation_already_approved: "Le courtage est déjà validé — envoyez l'étude depuis l'admin.",
  forbidden: "Accès refusé pour ce dossier.",
  dossier_not_found: "Dossier introuvable.",
  contract_required: "Signez d'abord votre contrat pour valider le courtage.",
  preview_unavailable: "Aperçu indisponible — le contenu de l'étude n'est pas encore prêt.",
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
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewSubject, setPreviewSubject] = useState(validation.subject);

  const summary = useMemo(() => {
    const total = Math.round(feesPerAssured * validation.assuredCount);
    const retro = Math.round(total * validation.payoutSharePercent);
    return { total, retro };
  }, [feesPerAssured, validation.assuredCount, validation.payoutSharePercent]);

  const sharePct = Math.round(validation.payoutSharePercent * 100);

  const openPreview = async () => {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const qs = new URLSearchParams({
        feesPerAssuredEur: String(feesPerAssured),
      });
      const res = await portalFetch(
        `/api/apporteur-portal/${encodeURIComponent(portalToken)}/study-validation/${encodeURIComponent(validation.dossierId)}/preview?${qs.toString()}`,
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        setPreviewError(
          json.message ||
            PORTAL_ERROR_LABELS[String(json.error || "")] ||
            json.error ||
            "Impossible de charger l'aperçu",
        );
        setPreviewHtml(null);
        return;
      }
      setPreviewSubject(String(json.subject || validation.subject));
      setPreviewHtml(String(json.html || ""));
    } catch {
      setPreviewError("Erreur réseau");
      setPreviewHtml(null);
    } finally {
      setPreviewLoading(false);
    }
  };

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
      setPreviewOpen(false);
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
    <>
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
          <div className="bg-white/80 rounded-lg px-3 py-2 border border-indigo-100">
            <span className="text-slate-500">Économie brute estimée</span>
            <p className="font-black text-indigo-900">
              {validation.grossSavingsEur != null
                ? `${Math.round(validation.grossSavingsEur).toLocaleString("fr-FR")} €`
                : "—"}
            </p>
            {validation.grossSavingsEur == null ? (
              <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                Montant non détecté dans l&apos;étude — contactez LCIF si besoin.
              </p>
            ) : null}
          </div>
          <div className="bg-white/80 rounded-lg px-3 py-2 border border-indigo-100">
            <span className="text-slate-500">Assurés</span>
            <p className="font-black text-indigo-900">{validation.assuredCount}</p>
          </div>
        </div>

        <label className="block text-xs font-bold text-slate-700 mb-1">
          {validation.minPerAssuredEur > 0
            ? `Frais de courtage par assuré (${validation.minPerAssuredEur}–${validation.maxPerAssuredEur} €, ou 0 €)`
            : `Frais de courtage par assuré (0–${validation.maxPerAssuredEur} €)`}
        </label>
        {validation.lowSavingsException ? (
          <p className="text-[11px] text-amber-800 mb-2 leading-relaxed">
            Économie inférieure à 2&nbsp;000 € : vous pouvez descendre sous 200 € par assuré.
          </p>
        ) : null}
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

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={previewLoading}
            onClick={openPreview}
            className="w-full py-2.5 rounded-lg border-2 border-[#1E3A8A] bg-white text-[#1E3A8A] font-bold text-sm inline-flex items-center justify-center gap-2 hover:bg-indigo-50 disabled:opacity-60"
          >
            {previewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
            Prévisualiser l&apos;étude
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleApprove}
            className="w-full py-2.5 rounded-lg bg-[#1E3A8A] text-white font-bold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Valider le courtage
          </button>
        </div>
        <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
          L&apos;aperçu applique le courtage saisi ci-dessus. L&apos;équipe LCIF enverra l&apos;étude au client après
          votre validation.
        </p>
      </div>

      {previewOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Prévisualisation de l'étude"
          onClick={() => setPreviewOpen(false)}
        >
          <div
            className="bg-white w-full sm:max-w-3xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-200 bg-slate-50">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-wide text-indigo-700">
                  Aperçu mail client
                </p>
                <p className="text-sm font-bold text-slate-900 truncate">{previewSubject}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Courtage affiché : {summary.total} € ({feesPerAssured} € × {validation.assuredCount})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="p-2 rounded-lg hover:bg-slate-200 text-slate-600 shrink-0"
                aria-label="Fermer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 bg-slate-100">
              {previewLoading ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin" /> Chargement de l&apos;aperçu…
                </div>
              ) : previewError ? (
                <p className="text-sm text-red-700 p-6">{previewError}</p>
              ) : previewHtml ? (
                <iframe
                  title="Aperçu étude client"
                  srcDoc={previewHtml}
                  sandbox=""
                  className="w-full h-[70vh] sm:h-[65vh] bg-white border-0"
                />
              ) : null}
            </div>
            <div className="px-4 py-3 border-t border-slate-200 flex flex-wrap gap-2 justify-end bg-white">
              <button
                type="button"
                onClick={openPreview}
                disabled={previewLoading}
                className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Actualiser l&apos;aperçu
              </button>
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-bold"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
