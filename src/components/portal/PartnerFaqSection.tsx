import React, { useMemo, useState } from "react";
import { ChevronDown, HelpCircle, Search } from "lucide-react";
import { APPORTEUR_FAQ, APPORTEUR_FAQ_CATEGORIES } from "../../../shared/apporteurFaq";

export default function PartnerFaqSection() {
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return APPORTEUR_FAQ.filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (!q) return true;
      return (
        item.question.toLowerCase().includes(q) ||
        item.answer.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [query, category]);

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 mb-1 flex items-center gap-2">
        <HelpCircle className="w-4 h-4" /> FAQ partenaire — {APPORTEUR_FAQ.length} réponses
      </h2>
      <p className="text-xs text-slate-500 mb-4">
        Arguments, objections et bonnes pratiques pour recommander LCIF et le changement d&apos;assurance emprunteur.
      </p>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            placeholder="Rechercher…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white"
        >
          <option value="all">Toutes les thématiques</option>
          {APPORTEUR_FAQ_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center">Aucun résultat.</p>
        ) : (
          filtered.map((item) => {
            const open = openId === item.id;
            return (
              <div key={item.id} className="border border-slate-100 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : item.id)}
                  className="w-full text-left px-4 py-3 flex justify-between gap-3 hover:bg-slate-50"
                >
                  <span className="text-sm font-bold text-slate-800">{item.question}</span>
                  <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
                </button>
                {open ? (
                  <div className="px-4 pb-3 text-sm text-slate-600 leading-relaxed border-t border-slate-50 bg-slate-50/50">
                    <p className="text-[10px] font-bold uppercase text-indigo-600 mb-2">{item.category}</p>
                    {item.answer}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
