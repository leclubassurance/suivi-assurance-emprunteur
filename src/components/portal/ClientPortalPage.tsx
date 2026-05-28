import React, { useEffect, useState } from "react";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { getApiUrl } from "../../lib/utils";

type PortalData = {
  dossierId: string;
  clientPrenom: string;
  status: { label: string; description: string };
  updatedAt: string;
  steps: { key: string; label: string; done: boolean; hint?: string }[];
  documents: { key: string; label: string; received: boolean; requiredNow: boolean }[];
  tips: string[];
  lastUpdateLabel: string;
};

export default function ClientPortalPage({ token }: { token: string }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(getApiUrl(`/api/portail/${token}`));
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Lien invalide");
        if (!cancelled) setData(json);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Impossible de charger le suivi.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md bg-white rounded-2xl border p-8 text-center shadow-sm">
          <p className="text-slate-600">{error || "Suivi indisponible."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-slate-50 to-white py-10 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        <header className="text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-indigo-600 mb-2">
            Le Club Immobilier Français
          </p>
          <h1 className="text-2xl font-black text-slate-900">
            Bonjour {data.clientPrenom}
          </h1>
          <p className="text-slate-500 text-sm mt-2 font-mono">{data.dossierId}</p>
        </header>

        <section className="bg-white rounded-3xl border shadow-sm p-6">
          <p className="text-xs font-bold uppercase text-slate-400 mb-1">Statut</p>
          <h2 className="text-xl font-bold text-slate-900">{data.status.label}</h2>
          <p className="text-slate-600 text-sm mt-2 leading-relaxed">{data.status.description}</p>
          <p className="text-xs text-slate-400 mt-4">Mis à jour le {data.lastUpdateLabel}</p>
        </section>

        <section className="bg-white rounded-3xl border shadow-sm p-6">
          <h3 className="font-bold text-slate-800 mb-4">Où en est votre dossier ?</h3>
          <ul className="space-y-4">
            {data.steps.map((step) => (
              <li key={step.key} className="flex gap-3">
                {step.done ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                ) : (
                  <Circle className="w-5 h-5 text-slate-300 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className={`font-semibold text-sm ${step.done ? "text-slate-800" : "text-slate-500"}`}>
                    {step.label}
                  </p>
                  {step.hint && !step.done && (
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">{step.hint}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="bg-white rounded-3xl border shadow-sm p-6">
          <h3 className="font-bold text-slate-800 mb-3">Documents</h3>
          <ul className="space-y-2">
            {data.documents.map((doc) => (
              <li
                key={doc.key}
                className={`flex justify-between items-center text-sm rounded-xl px-3 py-2 ${
                  doc.received ? "bg-emerald-50 text-emerald-900" : doc.requiredNow ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-600"
                }`}
              >
                <span>{doc.label}</span>
                <span className="font-bold text-xs">{doc.received ? "Reçu" : doc.requiredNow ? "À envoyer" : "Plus tard"}</span>
              </li>
            ))}
          </ul>
        </section>

        {data.tips.length > 0 && (
          <section className="bg-indigo-50 border border-indigo-100 rounded-3xl p-5 text-sm text-indigo-950 leading-relaxed">
            {data.tips.map((t, i) => (
              <p key={i} className={i > 0 ? "mt-3" : ""}>
                {t}
              </p>
            ))}
          </section>
        )}

        <p className="text-center text-xs text-slate-400 leading-relaxed px-4">
          Une question ? Répondez directement aux emails que vous recevez de notre équipe — nous vous accompagnons à chaque étape.
        </p>
      </div>
    </div>
  );
}
