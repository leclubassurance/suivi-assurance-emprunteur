import React from "react";
import { Mail } from "lucide-react";

type Communication = {
  direction: "inbound" | "outbound";
  date: string;
  subject?: string;
  excerpt: string;
  from?: string;
  to?: string;
};

export default function ConseillerReferralCommunications({
  communications,
}: {
  communications: Communication[];
}) {
  if (!communications.length) return null;

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <p className="text-[11px] font-black uppercase text-slate-500 flex items-center gap-1 mb-2">
        <Mail className="w-3.5 h-3.5" /> Échanges dossier
      </p>
      <ul className="space-y-2 max-h-48 overflow-y-auto">
        {communications.map((c, i) => (
          <li key={`${c.date}-${i}`} className="text-[11px] border border-slate-100 rounded-lg px-2.5 py-2 bg-slate-50/80">
            <div className="flex justify-between gap-2 mb-0.5">
              <span
                className={`font-bold uppercase text-[10px] ${
                  c.direction === "inbound" ? "text-blue-700" : "text-emerald-700"
                }`}
              >
                {c.direction === "inbound" ? "Client → LCIF" : "LCIF → Client"}
              </span>
              <span className="text-slate-400 shrink-0">
                {c.date ? new Date(c.date).toLocaleDateString("fr-FR") : ""}
              </span>
            </div>
            {c.subject ? <p className="font-medium text-slate-800 truncate">{c.subject}</p> : null}
            {c.excerpt ? <p className="text-slate-600 line-clamp-2 mt-0.5">{c.excerpt}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
