import React from "react";
import { Copy, Plus } from "lucide-react";
import type { ApporteurType } from "../../../shared/apporteurTypes";
import { getHeroCopy, TRUST_BADGES } from "../../../shared/apporteurPortalContent";
import { countryCodeToLabel } from "../../../shared/referralGeo";

type LeaderboardPosition = { rank: number; total: number; value: number };

type Props = {
  apporteurType: ApporteurType | string;
  referralLink: string;
  unlocked: boolean;
  referralStats?: {
    linkClicks: number;
    uniqueSessions: number;
    lastClickAt?: string | null;
    clicksByCountry?: Record<string, number>;
  };
  leaderboardPosition?: {
    signed: LeaderboardPosition | null;
    clicks: LeaderboardPosition | null;
  };
  onCopyLink: () => void;
  onNewReferral: () => void;
};

export default function PartnerHeroSection({
  apporteurType,
  referralLink,
  unlocked,
  referralStats,
  leaderboardPosition,
  onCopyLink,
  onNewReferral,
}: Props) {
  const copy = getHeroCopy((apporteurType as ApporteurType) || "autre");

  return (
    <section className="bg-gradient-to-br from-[#1E3A8A] via-indigo-900 to-[#1E3A8A] rounded-2xl p-5 sm:p-6 text-white shadow-lg relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.08] pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 15% 40%, #fff 0%, transparent 45%), radial-gradient(circle at 85% 15%, #C9A227 0%, transparent 35%)",
        }}
      />
      <div className="relative">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-300/90 mb-2">Espace partenaire</p>
        <h2 className="text-xl sm:text-2xl font-black tracking-tight leading-snug mb-2">{copy.title}</h2>
        <p className="text-sm text-indigo-100 leading-relaxed mb-5 max-w-xl">{copy.subtitle}</p>

        {unlocked ? (
          <div className="flex flex-wrap gap-2 mb-5">
            <button
              type="button"
              onClick={onCopyLink}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#C9A227] text-[#1E3A8A] text-sm font-black hover:bg-amber-400 transition-colors"
            >
              <Copy className="w-4 h-4" /> Copier mon lien client
            </button>
            <button
              type="button"
              onClick={onNewReferral}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/30 text-white text-sm font-bold hover:bg-white/10 transition-colors"
            >
              <Plus className="w-4 h-4" /> Nouvelle recommandation
            </button>
          </div>
        ) : (
          <p className="text-sm text-amber-200 bg-white/10 rounded-lg px-3 py-2 mb-5 inline-block">
            Votre espace sera activé par l&apos;équipe du Club Immobilier Français.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {TRUST_BADGES.map((badge) => (
            <span
              key={badge}
              className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-white/10 text-indigo-100 border border-white/10"
            >
              {badge}
            </span>
          ))}
        </div>

        {unlocked && referralLink ? (
          <>
            <code className="mt-4 block text-[10px] text-indigo-300/80 break-all line-clamp-2">{referralLink}</code>
            {referralStats ? (
              <p className="mt-2 text-[10px] text-indigo-200/90">
                {referralStats.linkClicks} visite{referralStats.linkClicks !== 1 ? "s" : ""} du lien
                {referralStats.uniqueSessions > 0
                  ? ` · ${referralStats.uniqueSessions} session${referralStats.uniqueSessions > 1 ? "s" : ""} distincte${referralStats.uniqueSessions > 1 ? "s" : ""}`
                  : ""}
              </p>
            ) : (
              <p className="mt-2 text-[10px] text-indigo-200/70">0 visite du lien pour le moment.</p>
            )}
            {leaderboardPosition?.signed && leaderboardPosition.signed.total > 1 ? (
              <p className="mt-1 text-[10px] text-amber-200/90">
                Classement réseau : #{leaderboardPosition.signed.rank}/{leaderboardPosition.signed.total} dossiers signés
                {leaderboardPosition.clicks && leaderboardPosition.clicks.value > 0
                  ? ` · #${leaderboardPosition.clicks.rank} visites lien`
                  : ""}
              </p>
            ) : null}
            {referralStats?.clicksByCountry && Object.keys(referralStats.clicksByCountry).length > 0 ? (
              <p className="mt-1 text-[10px] text-indigo-200/80">
                Origine visites :{" "}
                {Object.entries(referralStats.clicksByCountry)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 3)
                  .map(([code, n]) => `${countryCodeToLabel(code)} (${n})`)
                  .join(" · ")}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
