import React, { useEffect, useState } from "react";
import { BookOpen, ChevronRight, GraduationCap, Loader2, PlayCircle } from "lucide-react";
import { getApiUrl } from "../../lib/utils";
import type { ConseillerFormationModule } from "../../../shared/conseillerFormations";

type FormationModule = ConseillerFormationModule & { available: boolean };

export default function ConseillerFormationSection({ portalToken }: { portalToken: string }) {
  const [modules, setModules] = useState<FormationModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          getApiUrl(`/api/apporteur-portal/${encodeURIComponent(portalToken)}/formations`),
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && Array.isArray(data.modules)) {
          const list = data.modules as FormationModule[];
          setModules(list);
          const first = list.find((m) => m.available) || list[0];
          if (first) setActiveId(first.id);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [portalToken]);

  const active = modules.find((m) => m.id === activeId) || modules[0];
  const availableCount = modules.filter((m) => m.available).length;

  if (loading) {
    return (
      <section className="bg-white rounded-2xl border border-slate-200 p-8 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-800" />
      </section>
    );
  }

  if (!modules.length) return null;

  return (
    <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
      <div className="bg-gradient-to-r from-indigo-950 via-[#1E3A8A] to-indigo-800 px-5 py-5 sm:px-6 text-white">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
            <GraduationCap className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-black tracking-tight">Formation assurance</h2>
            <p className="text-sm text-indigo-100/90 mt-1 leading-relaxed max-w-xl">
              Parcours réservé aux conseillers du Club. Suivez les modules à votre rythme — votre
              progression est enregistrée sur Coassemble.
            </p>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,280px)_1fr] min-h-[420px]">
        <div className="border-b lg:border-b-0 lg:border-r border-slate-200 bg-slate-50/80 p-3 sm:p-4 space-y-1.5 max-h-[320px] lg:max-h-none overflow-y-auto">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-500 px-2 pb-1">
            Modules ({availableCount}/{modules.length})
          </p>
          {modules.map((mod, idx) => {
            const selected = mod.id === active?.id;
            return (
              <button
                key={mod.id}
                type="button"
                onClick={() => setActiveId(mod.id)}
                className={`w-full text-left rounded-xl px-3 py-2.5 transition-all border ${
                  selected
                    ? "bg-white border-indigo-200 shadow-sm ring-1 ring-indigo-100"
                    : "border-transparent hover:bg-white/80 hover:border-slate-200"
                } ${!mod.available ? "opacity-60" : ""}`}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={`text-[10px] font-black mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                      selected ? "bg-indigo-800 text-white" : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-xs font-bold leading-snug ${selected ? "text-indigo-950" : "text-slate-800"}`}>
                      {mod.title}
                    </p>
                    {!mod.available ? (
                      <p className="text-[10px] text-amber-700 font-semibold mt-0.5">Bientôt disponible</p>
                    ) : null}
                  </div>
                  {selected ? <ChevronRight className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" /> : null}
                </div>
              </button>
            );
          })}
        </div>

        <div className="p-4 sm:p-5 flex flex-col min-h-[360px]">
          {active ? (
            <>
              <div className="mb-4">
                <div className="flex items-center gap-2 text-indigo-900 mb-2">
                  <BookOpen className="w-4 h-4" />
                  <h3 className="font-black text-sm sm:text-base">{active.title}</h3>
                </div>
                {active.description ? (
                  <p className="text-sm text-slate-600 leading-relaxed">{active.description}</p>
                ) : null}
              </div>

              {active.available ? (
                <div className="flex-1 rounded-xl border border-slate-200 overflow-hidden bg-slate-100 min-h-[280px]">
                  <iframe
                    title={active.title}
                    src={active.embedUrl}
                    className="w-full h-full min-h-[280px] sm:min-h-[360px] border-0 bg-white"
                    allow="fullscreen; autoplay; encrypted-media"
                    loading="lazy"
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                </div>
              ) : (
                <div className="flex-1 rounded-xl border border-dashed border-slate-300 bg-slate-50 flex flex-col items-center justify-center text-center p-8 min-h-[240px]">
                  <PlayCircle className="w-10 h-10 text-slate-300 mb-3" />
                  <p className="text-sm font-semibold text-slate-600">Module en cours de publication</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm">
                    L&apos;équipe LCIF finalise ce module. Revenez prochainement.
                  </p>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
