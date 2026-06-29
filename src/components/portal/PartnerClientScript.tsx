import React from "react";
import { Copy, MessageCircle } from "lucide-react";
import { CLIENT_SCRIPT, TRANSPARENCY_SCRIPT } from "../../../shared/apporteurPortalContent";

type Props = {
  onCopy: (text: string, label: string) => void;
};

export default function PartnerClientScript({ onCopy }: Props) {
  return (
    <section className="bg-white rounded-2xl border border-emerald-200 p-5 shadow-sm">
      <h2 className="text-sm font-black uppercase tracking-wide text-emerald-800 mb-3 flex items-center gap-2">
        <MessageCircle className="w-4 h-4" /> Ce qu&apos;il faut dire au client
      </h2>
      <blockquote className="text-sm text-slate-800 leading-relaxed font-medium border-l-4 border-emerald-400 pl-4 mb-4">
        « {CLIENT_SCRIPT} »
      </blockquote>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onCopy(CLIENT_SCRIPT, "Script copié !")}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700"
        >
          <Copy className="w-3.5 h-3.5" /> Copier le script
        </button>
        <button
          type="button"
          onClick={() => onCopy(TRANSPARENCY_SCRIPT, "Phrase transparence copiée !")}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50"
        >
          <Copy className="w-3.5 h-3.5" /> Phrase transparence
        </button>
      </div>
    </section>
  );
}
