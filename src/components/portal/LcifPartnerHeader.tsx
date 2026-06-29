import React from "react";
import { LCIF_LOGO_URL, LCIF_ORIAS } from "../../../shared/apporteurBrand";

type Props = {
  subtitle?: string;
  partnerName: string;
  partnerContact: string;
  partnerTypeLabel: string;
  contractStatus?: string;
};

const CONTRACT_LABELS: Record<string, { label: string; className: string }> = {
  none: { label: "Contrat non initié", className: "bg-amber-500/20 text-amber-100 border-amber-400/40" },
  pending: { label: "Contrat en préparation", className: "bg-amber-500/20 text-amber-100 border-amber-400/40" },
  sent: { label: "Contrat envoyé — en attente de signature", className: "bg-sky-500/20 text-sky-100 border-sky-400/40" },
  signed: { label: "Contrat partenaire signé", className: "bg-emerald-500/20 text-emerald-100 border-emerald-400/40" },
  expired: { label: "Contrat à renouveler", className: "bg-red-500/20 text-red-100 border-red-400/40" },
};

export default function LcifPartnerHeader({
  subtitle = "Espace partenaire",
  partnerName,
  partnerContact,
  partnerTypeLabel,
  contractStatus = "none",
}: Props) {
  const contract = CONTRACT_LABELS[contractStatus] || CONTRACT_LABELS.none;

  return (
    <header className="bg-[#1E3A8A] text-white relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage: "radial-gradient(circle at 20% 50%, #fff 0%, transparent 50%), radial-gradient(circle at 80% 20%, #C9A227 0%, transparent 40%)",
        }}
      />
      <div className="max-w-3xl mx-auto px-5 py-8 relative">
        <div className="flex items-start justify-between gap-4 mb-6">
          <img
            src={LCIF_LOGO_URL}
            alt="Le Club Immobilier Français"
            className="h-12 w-auto max-w-[140px] object-contain brightness-0 invert"
          />
          <div className="text-right text-[10px] text-indigo-200 leading-snug">
            <div className="font-bold uppercase tracking-wider">Partenariat</div>
            <div>ORIAS {LCIF_ORIAS}</div>
          </div>
        </div>
        <p className="text-indigo-200 text-[11px] font-bold uppercase tracking-[0.2em] mb-2">{subtitle}</p>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight">{partnerName}</h1>
        <p className="text-indigo-100 text-sm mt-2">
          Bonjour <span className="font-semibold text-white">{partnerContact}</span>
          <span className="text-indigo-300 mx-2">·</span>
          {partnerTypeLabel}
        </p>
        {contractStatus !== "signed" ? (
          <p className={`mt-4 inline-flex text-xs font-bold px-3 py-1.5 rounded-full border ${contract.className}`}>
            {contract.label}
          </p>
        ) : (
          <p className={`mt-4 inline-flex text-xs font-bold px-3 py-1.5 rounded-full border ${contract.className}`}>
            ✓ {contract.label}
          </p>
        )}
      </div>
    </header>
  );
}

export function LcifPartnerFooter() {
  return (
    <p className="text-center text-xs text-slate-400 pb-10 px-4 leading-relaxed">
      Le Club Immobilier Français — ORIAS {LCIF_ORIAS}
      <br />
      Vous recevez un email à chaque avancement de vos recommandations.
    </p>
  );
}
