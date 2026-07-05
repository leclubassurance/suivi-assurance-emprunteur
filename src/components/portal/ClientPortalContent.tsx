import React, { useState } from "react";
import { CheckCircle2, Circle, Loader2, Link2 } from "lucide-react";

export const LCIF_LOGO_URL =
  "https://res.cloudinary.com/dji8akleo/image/upload/v1777112444/6_oqr0zi.png";

export type ClientPortalData = {
  dossierId: string;
  clientPrenom: string;
  status: { label: string; description: string };
  steps: { key: string; label: string; done: boolean; hint?: string }[];
  documents: { key: string; label: string; received: boolean; requiredNow: boolean }[];
  tips: string[];
  lastUpdateLabel: string;
  subscriptionPhase?: string;
  subscriptionPhaseLabel?: string;
  plannedChangeDate?: string;
  plannedChangeDateLabel?: string;
};

function docBadge(doc: ClientPortalData["documents"][0]) {
  if (doc.received && !doc.requiredNow) {
    return { label: "Reçu", className: "bg-emerald-50 text-emerald-800" };
  }
  if (doc.received && doc.requiredNow) {
    return { label: "À renvoyer", className: "bg-amber-50 text-amber-900" };
  }
  if (doc.requiredNow) {
    return { label: "Attendu", className: "bg-slate-200 text-slate-800" };
  }
  return { label: "Plus tard", className: "bg-slate-50 text-slate-400" };
}

export function ClientPortalContent({
  data,
  portalUrl,
}: {
  data: ClientPortalData;
  portalUrl?: string;
}) {
  const [copied, setCopied] = useState(false);
  const completedSteps = data.steps.filter((s) => s.done).length;
  const progress = data.steps.length ? Math.round((completedSteps / data.steps.length) * 100) : 0;
  const firstOpenIdx = data.steps.findIndex((s) => !s.done);

  const copyLink = async () => {
    const url = portalUrl || window.location.href;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full max-w-lg mx-auto pb-8">
      <div className="bg-white border border-slate-200/80 rounded-[32px] shadow-sm overflow-hidden">
        <div className="px-8 pt-10 pb-6 text-center border-b border-slate-100">
          <img
            src={LCIF_LOGO_URL}
            alt="Le Club Immobilier Français"
            className="h-12 mx-auto object-contain mb-6"
            referrerPolicy="no-referrer"
          />
          <p className="text-[11px] uppercase tracking-[0.2em] font-bold text-slate-400 mb-2">
            Assurance emprunteur
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-[#111318]">
            Bonjour {data.clientPrenom}
          </h1>
          <p className="text-slate-500 text-[15px] font-medium mt-2 leading-relaxed">
            Voici l&apos;avancement de votre demande, mise à jour par notre équipe.
          </p>
        </div>

        <div className="px-8 py-6 bg-gradient-to-br from-[#1E3A8A] to-[#172554] text-white">
          <p className="text-[11px] uppercase tracking-widest font-bold text-white/50 mb-2">
            Situation actuelle
          </p>
          <p className="text-xl font-bold">{data.status.label}</p>
          <p className="text-[14px] text-white/80 mt-2 leading-relaxed font-medium">
            {data.status.description}
          </p>
          {data.plannedChangeDateLabel ? (
            <p className="text-[13px] text-blue-100 mt-3 font-semibold bg-white/10 rounded-xl px-3 py-2">
              Changement d&apos;assurance prévu le {data.plannedChangeDateLabel}
            </p>
          ) : null}
          <div className="mt-5">
            <div className="flex justify-between text-[11px] font-bold text-white/50 mb-1.5">
              <span>Progression</span>
              <span>
                {completedSteps}/{data.steps.length} étapes
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-white/15 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-300 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>

        <div className="px-8 py-7 space-y-7">
          <section>
            <h2 className="text-[13px] font-bold uppercase tracking-wide text-slate-400 mb-4">
              Étapes de votre dossier
            </h2>
            <ol className="relative space-y-0">
              {data.steps.map((step, index) => {
                const isLast = index === data.steps.length - 1;
                const inProgress = !step.done && index === firstOpenIdx;
                return (
                  <li key={step.key} className="relative flex gap-4 pb-6">
                    {!isLast && (
                      <span
                        className={`absolute left-[11px] top-6 w-px h-[calc(100%-8px)] ${
                          step.done ? "bg-emerald-200" : inProgress ? "bg-blue-200" : "bg-slate-200"
                        }`}
                        aria-hidden
                      />
                    )}
                    <span
                      className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                        step.done
                          ? "border-emerald-500 bg-emerald-50 text-emerald-600"
                          : inProgress
                            ? "border-blue-500 bg-blue-50 text-blue-600"
                            : "border-slate-200 bg-white text-slate-300"
                      }`}
                    >
                      {step.done ? (
                        <CheckCircle2 className="w-4 h-4" strokeWidth={2.5} />
                      ) : inProgress ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Circle className="w-3.5 h-3.5" strokeWidth={2} />
                      )}
                    </span>
                    <div className="pt-0.5 min-w-0">
                      <p
                        className={`text-[15px] font-semibold leading-snug ${
                          step.done
                            ? "text-slate-900"
                            : inProgress
                              ? "text-blue-900"
                              : "text-slate-500"
                        }`}
                      >
                        {step.label}
                        {inProgress && (
                          <span className="ml-2 text-[11px] font-bold uppercase tracking-wide text-blue-600">
                            En cours
                          </span>
                        )}
                      </p>
                      {step.hint && !step.done && (
                        <p className="text-[13px] text-slate-500 mt-1.5 leading-relaxed">{step.hint}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <section>
            <h2 className="text-[13px] font-bold uppercase tracking-wide text-slate-400 mb-3">
              Documents
            </h2>
            <ul className="rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
              {data.documents.map((doc) => {
                const badge = docBadge(doc);
                return (
                  <li
                    key={doc.key}
                    className="flex justify-between items-center gap-3 px-4 py-3.5 bg-white text-[14px]"
                  >
                    <span className="font-medium text-slate-800">{doc.label}</span>
                    <span
                      className={`shrink-0 text-[11px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          {data.tips.length > 0 && (
            <section className="rounded-2xl bg-slate-50 border border-slate-200 px-5 py-4">
              <p className="text-[12px] font-bold uppercase tracking-wide text-slate-500 mb-2">
                Pour avancer sereinement
              </p>
              {data.tips.map((t, i) => (
                <p
                  key={i}
                  className={`text-[14px] text-slate-600 leading-relaxed ${i > 0 ? "mt-2" : ""}`}
                >
                  {t}
                </p>
              ))}
            </section>
          )}
        </div>

        <footer className="px-8 py-5 bg-slate-50 border-t border-slate-100 text-center space-y-3">
          <p className="text-[13px] text-slate-600 leading-relaxed font-medium">
            Une question ? Répondez directement à nos emails — nous vous répondons sous 48h ouvrées.
          </p>
          {portalUrl && (
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex items-center gap-2 text-[12px] font-bold text-[#1E3A8A] hover:text-blue-800"
            >
              <Link2 className="w-3.5 h-3.5" />
              {copied ? "Lien copié" : "Copier mon lien de suivi"}
            </button>
          )}
          <p className="text-[11px] text-slate-400 font-mono">
            Réf. {data.dossierId} · MAJ {data.lastUpdateLabel}
          </p>
        </footer>
      </div>
    </div>
  );
}
