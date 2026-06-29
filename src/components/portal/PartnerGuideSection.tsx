import React, { useState } from "react";
import { BookOpen, ChevronDown } from "lucide-react";
import { APPORTEUR_GUIDE_SECTIONS, APPORTEUR_GUIDE_TITLE } from "../../../shared/apporteurGuide";

export default function PartnerGuideSection() {
  const [open, setOpen] = useState(false);

  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-5 py-4 flex justify-between items-center gap-3 hover:bg-slate-50 transition-colors"
      >
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 flex items-center gap-2">
          <BookOpen className="w-4 h-4" /> {APPORTEUR_GUIDE_TITLE}
        </h2>
        <ChevronDown className={`w-5 h-5 text-slate-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <article className="px-5 pb-5 pt-0 border-t border-slate-100 space-y-5 text-sm text-slate-700 leading-relaxed">
          {APPORTEUR_GUIDE_SECTIONS.map((section) => (
            <div key={section.title}>
              <h3 className="text-sm font-bold text-slate-900 mb-1.5">{section.title}</h3>
              {section.paragraphs.map((p, i) => (
                <p key={i} className={i > 0 ? "mt-2" : ""}>
                  {p}
                </p>
              ))}
            </div>
          ))}
        </article>
      ) : (
        <p className="px-5 pb-4 text-xs text-slate-500 -mt-1">
          Assurance emprunteur, rémunération, cadre légal — tout le détail en un clic.
        </p>
      )}
    </section>
  );
}
