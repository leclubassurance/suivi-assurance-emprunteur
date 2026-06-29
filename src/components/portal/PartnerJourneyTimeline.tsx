import React from "react";
import { ArrowRight } from "lucide-react";
import { JOURNEY_STEPS } from "../../../shared/apporteurPortalContent";

export default function PartnerJourneyTimeline() {
  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 mb-4">Parcours client</h2>
      <ol className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-0">
        {JOURNEY_STEPS.map((step, i) => (
          <li key={step.key} className="flex sm:flex-1 sm:flex-col items-start sm:items-center gap-2 sm:gap-0 sm:text-center relative">
            <div className="flex items-center gap-2 sm:flex-col sm:gap-1 w-full sm:w-auto">
              <span className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-800 text-xs font-black flex items-center justify-center shrink-0">
                {i + 1}
              </span>
              <div className="sm:mt-2">
                <p className="text-xs font-black text-slate-900">{step.label}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{step.desc}</p>
              </div>
            </div>
            {i < JOURNEY_STEPS.length - 1 ? (
              <ArrowRight className="hidden sm:block w-4 h-4 text-slate-300 absolute top-4 -right-2 translate-x-1/2" />
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
