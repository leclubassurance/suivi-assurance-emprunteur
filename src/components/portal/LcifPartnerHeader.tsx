import React from "react";
import { LogOut } from "lucide-react";
import { LCIF_LOGO_URL, LCIF_ORIAS } from "../../../shared/apporteurBrand";

type Props = {
  subtitle?: string;
  partnerName: string;
  partnerContact: string;
  partnerTypeLabel: string;
  onLogout?: () => void;
};

export default function LcifPartnerHeader({
  subtitle = "Espace partenaire",
  partnerName,
  partnerContact,
  partnerTypeLabel,
  onLogout,
}: Props) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-4 sm:px-5 py-3 sm:py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={LCIF_LOGO_URL}
              alt="Le Club Immobilier Français"
              className="h-9 w-auto max-w-[120px] object-contain shrink-0"
            />
            <div className="min-w-0 border-l border-slate-200 pl-3">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-700 truncate">
                {subtitle}
              </p>
              <h1 className="text-base sm:text-lg font-black text-slate-900 truncate">{partnerName}</h1>
            </div>
          </div>
          <div className="text-right shrink-0">
            {onLogout ? (
              <button
                type="button"
                onClick={onLogout}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 mb-1"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Déconnexion</span>
              </button>
            ) : null}
            <p className="text-[10px] text-slate-400 hidden sm:block">ORIAS {LCIF_ORIAS}</p>
          </div>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Bonjour <span className="font-bold text-slate-900">{partnerContact}</span>
          <span className="text-slate-300 mx-2">·</span>
          <span className="text-slate-500">{partnerTypeLabel}</span>
        </p>
      </div>
    </header>
  );
}

export function LcifPartnerFooter() {
  return (
    <p className="text-center text-xs text-slate-400 pb-4 px-4 leading-relaxed">
      Le Club Immobilier Français — ORIAS {LCIF_ORIAS}
      <br />
      Vous recevez un email à chaque avancement de vos recommandations.
    </p>
  );
}
