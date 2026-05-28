import React from "react";
import { CheckCircle2 } from "lucide-react";

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
};

export function ClientPortalContent({ data }: { data: ClientPortalData }) {
  const completedSteps = data.steps.filter((s) => s.done).length;
  const progress = data.steps.length ? Math.round((completedSteps / data.steps.length) * 100) : 0;

  return (
    <div className="w-full max-w-lg mx-auto">
      <div className="bg-white border border-slate-200/80 rounded-[32px] shadow-sm overflow-hidden">
        <div className="px-8 pt-10 pb-6 text-center border-b border-slate-100">
          <img
            src={LCIF_LOGO_URL}
            alt="Le Club Immobilier Français"
            className="h-12 mx-auto object-contain mix-blend-multiply mb-6"
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

        <div className="px-8 py-6 bg-[#111318] text-white">
          <p className="text-[11px] uppercase tracking-widest font-bold text-white/45 mb-2">Situation actuelle</p>
          <p className="text-xl font-bold">{data.status.label}</p>
          <p className="text-[14px] text-white/75 mt-2 leading-relaxed font-medium">{data.status.description}</p>
          <div className="mt-5">
            <div className="flex justify-between text-[11px] font-bold text-white/50 mb-1.5">
              <span>Progression</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/15 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-400 transition-all"
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
                return (
                  <li key={step.key} className="relative flex gap-4 pb-6">
                    {!isLast && (
                      <span
                        className={`absolute left-[11px] top-6 w-px h-[calc(100%-8px)] ${step.done ? "bg-emerald-200" : "bg-slate-200"}`}
                        aria-hidden
                      />
                    )}
                    <span
                      className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                        step.done
                          ? "border-emerald-500 bg-emerald-50 text-emerald-600"
                          : "border-slate-200 bg-white text-slate-300"
                      }`}
                    >
                      {step.done ? <CheckCircle2 className="w-4 h-4" strokeWidth={2.5} /> : null}
                    </span>
                    <div className="pt-0.5 min-w-0">
                      <p
                        className={`text-[15px] font-semibold leading-snug ${step.done ? "text-slate-900" : "text-slate-500"}`}
                      >
                        {step.label}
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
              {data.documents.map((doc) => (
                <li
                  key={doc.key}
                  className="flex justify-between items-center gap-3 px-4 py-3.5 bg-white text-[14px]"
                >
                  <span className="font-medium text-slate-800">{doc.label}</span>
                  <span
                    className={`shrink-0 text-[11px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${
                      doc.received
                        ? "bg-emerald-50 text-emerald-800"
                        : doc.requiredNow
                          ? "bg-slate-100 text-slate-700"
                          : "bg-slate-50 text-slate-400"
                    }`}
                  >
                    {doc.received ? "Reçu" : doc.requiredNow ? "Attendu" : "Plus tard"}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {data.tips.length > 0 && (
            <section className="rounded-2xl bg-slate-50 border border-slate-200 px-5 py-4">
              <p className="text-[12px] font-bold uppercase tracking-wide text-slate-500 mb-2">
                Pour avancer sereinement
              </p>
              {data.tips.map((t, i) => (
                <p key={i} className={`text-[14px] text-slate-600 leading-relaxed ${i > 0 ? "mt-2" : ""}`}>
                  {t}
                </p>
              ))}
            </section>
          )}
        </div>

        <footer className="px-8 py-5 bg-slate-50 border-t border-slate-100 text-center">
          <p className="text-[13px] text-slate-600 leading-relaxed font-medium">
            Une question ? Répondez directement à nos emails — nous vous répondons sous 48h ouvrées.
          </p>
          <p className="text-[11px] text-slate-400 mt-3 font-mono">
            Réf. {data.dossierId} · MAJ {data.lastUpdateLabel}
          </p>
        </footer>
      </div>
    </div>
  );
}
