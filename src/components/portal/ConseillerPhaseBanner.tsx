import React from "react";
import { Target } from "lucide-react";

type Props = {
  signedCount: number;
};

export default function ConseillerPhaseBanner({ signedCount }: Props) {
  return (
    <section className="rounded-2xl border p-4 shadow-sm bg-gradient-to-br from-indigo-50 to-white border-indigo-200">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-indigo-100 text-indigo-700">
          <Target className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-wide text-slate-500 mb-0.5">
            Accompagnement LCIF
          </p>
          <p className="text-sm font-bold text-slate-900">
            Le Club Immobilier Français gère l&apos;étude, la relation client et la souscription pour vous.
          </p>
          <p className="text-xs text-slate-600 mt-1.5">
            <strong className="text-slate-800">{signedCount}</strong> dossier{signedCount !== 1 ? "s" : ""}{" "}
            client{signedCount !== 1 ? "s" : ""} signé{signedCount !== 1 ? "s" : ""} — vous recommandez et
            suivez l&apos;avancement dans votre espace.
          </p>
        </div>
      </div>
    </section>
  );
}
