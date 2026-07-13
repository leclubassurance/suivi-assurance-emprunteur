import React from "react";
import { Copy, Link2, Plus, Users } from "lucide-react";
import type { ApporteurType } from "../../../shared/apporteurTypes";
import { getHeroCopy } from "../../../shared/apporteurPortalContent";
import KpiCard, { formatPercent } from "./PartnerKpiGrid";
import ConseillerCommunicationDriveSection from "./ConseillerCommunicationDriveSection";

type Props = {
  apporteurType: ApporteurType | string;
  referralLink: string;
  unlocked: boolean;
  referralStats?: {
    linkClicks: number;
    uniqueSessions: number;
    lastClickAt?: string | null;
  };
  kpis?: {
    total: number;
    open: number;
    signed: number;
    conversionRate?: number | null;
  };
  onCopyLink: () => void;
  onNewReferral: () => void;
  onGoReferrals?: () => void;
};

export default function PartnerHeroSection({
  apporteurType,
  referralLink,
  unlocked,
  referralStats,
  kpis,
  onCopyLink,
  onNewReferral,
  onGoReferrals,
}: Props) {
  const copy = getHeroCopy((apporteurType as ApporteurType) || "autre");
  const isConseiller = apporteurType === "conseiller_immo_club";

  return (
    <div className="space-y-4">
      <div className="lcif-card p-5 sm:p-6 bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white border-0 shadow-lg">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300 mb-2">
          {isConseiller ? "Tableau de bord conseiller" : "Tableau de bord partenaire"}
        </p>
        <h2 className="text-xl sm:text-2xl font-black tracking-tight leading-snug mb-2">{copy.title}</h2>
        <p className="text-sm text-slate-300 leading-relaxed max-w-2xl">{copy.subtitle}</p>
      </div>

      {kpis ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard label="Clients" value={kpis.total} accent="indigo" />
          <KpiCard label="En cours" value={kpis.open} accent="amber" />
          <KpiCard label="Signés" value={kpis.signed} accent="emerald" />
          <KpiCard
            label="Conversion"
            value={kpis.conversionRate != null ? formatPercent(kpis.conversionRate) : "—"}
            accent="violet"
          />
        </div>
      ) : null}

      {unlocked ? (
        <div className="grid sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onCopyLink}
            className="lcif-card p-4 text-left hover:border-indigo-200 hover:shadow-md transition-all group"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 mb-3 group-hover:bg-indigo-100">
              <Copy className="h-5 w-5" />
            </span>
            <p className="text-sm font-black text-slate-900">Copier mon lien client</p>
            <p className="text-xs text-slate-500 mt-1">À partager par SMS, email ou WhatsApp</p>
            {referralLink ? (
              <p className="mt-2 text-[10px] text-slate-400 font-mono truncate">{referralLink}</p>
            ) : null}
          </button>

          <button
            type="button"
            onClick={onNewReferral}
            className="lcif-card p-4 text-left hover:border-emerald-200 hover:shadow-md transition-all group"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 mb-3 group-hover:bg-emerald-100">
              <Plus className="h-5 w-5" />
            </span>
            <p className="text-sm font-black text-slate-900">Nouvelle recommandation</p>
            <p className="text-xs text-slate-500 mt-1">Déclarer un client orienté vers LCIF</p>
          </button>

          {onGoReferrals ? (
            <button
              type="button"
              onClick={onGoReferrals}
              className="lcif-card p-4 text-left hover:border-violet-200 hover:shadow-md transition-all group sm:col-span-2"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-700 mb-3 group-hover:bg-violet-100">
                <Users className="h-5 w-5" />
              </span>
              <p className="text-sm font-black text-slate-900">Voir mes dossiers clients</p>
              <p className="text-xs text-slate-500 mt-1">Suivi, étapes et commissions</p>
            </button>
          ) : null}

          {isConseiller ? <ConseillerCommunicationDriveSection variant="card" /> : null}
        </div>
      ) : (
        <div className="lcif-card p-4 border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-900 font-medium">
            Votre espace sera activé par l&apos;équipe du Club Immobilier Français après signature du contrat.
          </p>
        </div>
      )}

      {unlocked && referralStats ? (
        <p className="text-xs text-slate-500 flex items-center gap-2 px-1">
          <Link2 className="h-3.5 w-3.5 text-slate-400" />
          {referralStats.linkClicks} visite{referralStats.linkClicks !== 1 ? "s" : ""} du lien
          {referralStats.uniqueSessions > 0
            ? ` · ${referralStats.uniqueSessions} session${referralStats.uniqueSessions > 1 ? "s" : ""}`
            : ""}
        </p>
      ) : null}
    </div>
  );
}
