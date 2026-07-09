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
    <header className="sticky top-0 z-40 bg-[#1E3A8A] text-white border-b border-indigo-900/30 shadow-sm">
      <div
        className="absolute inset-0 opacity-[0.08] pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 15% 50%, #fff 0%, transparent 45%), radial-gradient(circle at 85% 20%, #C9A227 0%, transparent 35%)",
        }}
      />
      <div className="max-w-6xl mx-auto px-4 sm:px-5 py-4 relative">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={LCIF_LOGO_URL}
              alt="Le Club Immobilier Français"
              className="h-10 w-auto max-w-[130px] object-contain shrink-0 brightness-0 invert"
            />
            <div className="min-w-0 border-l border-white/20 pl-3">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-300/90 truncate">
                {subtitle}
              </p>
              <h1 className="text-base sm:text-lg font-black text-white truncate">{partnerName}</h1>
            </div>
          </div>
          <div className="text-right shrink-0">
            {onLogout ? (
              <button
                type="button"
                onClick={onLogout}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-200 hover:text-white mb-1"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Déconnexion</span>
              </button>
            ) : null}
            <p className="text-[10px] text-indigo-200 hidden sm:block">ORIAS {LCIF_ORIAS}</p>
          </div>
        </div>
        <p className="mt-2 text-sm text-indigo-100">
          Bonjour <span className="font-bold text-white">{partnerContact}</span>
          <span className="text-indigo-300 mx-2">·</span>
          <span className="text-indigo-200">{partnerTypeLabel}</span>
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
      Vous recevez un email à chaque avancement des clients que vous nous transmettez.
    </p>
  );
}
