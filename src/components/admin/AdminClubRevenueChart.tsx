import React, { useCallback, useEffect, useMemo, useState } from "react";
import { TrendingUp, RefreshCw } from "lucide-react";
import { adminFetch } from "../../lib/adminApi";
import type { ClubRevenueForecast } from "../../../shared/clubRevenueForecast";

function formatEur(n: number): string {
  return `${Math.round(n).toLocaleString("fr-FR")} €`;
}

type Props = {
  className?: string;
};

export default function AdminClubRevenueChart({ className = "" }: Props) {
  const [forecast, setForecast] = useState<ClubRevenueForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [monthsPast, setMonthsPast] = useState(6);
  const [monthsFuture, setMonthsFuture] = useState(6);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch(
        `/api/admin/club-revenue-forecast?monthsPast=${monthsPast}&monthsFuture=${monthsFuture}`,
      );
      const data = await res.json().catch(() => ({}));
      setForecast(data?.forecast ?? null);
    } catch {
      setForecast(null);
    } finally {
      setLoading(false);
    }
  }, [monthsPast, monthsFuture]);

  useEffect(() => {
    load();
  }, [load]);

  const chart = useMemo(() => {
    if (!forecast?.months?.length) return null;
    const months = forecast.months;
    const maxVal = Math.max(
      1,
      ...months.map((m) =>
        Math.max(
          m.totalNetClubEur + m.projectedTotalEur,
          m.monthlyPremiumEur + m.projectedMonthlyPremiumEur,
        ),
      ),
    );
    const w = 720;
    const h = 220;
    const padL = 48;
    const padR = 12;
    const padT = 16;
    const padB = 36;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const barGap = 6;
    const barW = Math.max(8, (innerW - barGap * (months.length - 1)) / months.length);

    const y = (v: number) => padT + innerH - (v / maxVal) * innerH;

    const bars = months.map((m, i) => {
      const x = padL + i * (barW + barGap);
      const realizedH = (m.totalNetClubEur / maxVal) * innerH;
      const projectedH = (m.projectedTotalEur / maxVal) * innerH;
      const premiumY = y(m.monthlyPremiumEur + m.projectedMonthlyPremiumEur);
      const isFuture = i > months.findIndex((mo) => mo.monthKey === new Date().toISOString().slice(0, 7));
      return {
        m,
        x,
        realizedH,
        projectedH,
        premiumY,
        isFuture,
      };
    });

    const premiumPath = bars
      .map((b, i) => {
        const cx = b.x + barW / 2;
        return `${i === 0 ? "M" : "L"} ${cx} ${b.premiumY}`;
      })
      .join(" ");

    return { w, h, maxVal, bars, premiumPath, padL, padT, innerH };
  }, [forecast]);

  if (loading && !forecast) {
    return (
      <div className={`bg-slate-900 text-white px-4 py-6 ${className}`}>
        <p className="text-xs text-white/50">Chargement du graphique rémunération club…</p>
      </div>
    );
  }

  if (!forecast || !chart) {
    return (
      <div className={`bg-slate-900 text-white px-4 py-6 ${className}`}>
        <p className="text-xs text-white/50">Aucune donnée pour le graphique (renseignez prime / courtage sur les dossiers).</p>
      </div>
    );
  }

  const { summary } = forecast;

  return (
    <div className={`bg-slate-900 text-white px-4 py-4 border-t border-white/10 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-[10px] uppercase font-bold text-white/50 tracking-wide flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" />
            Rémunération club — mensuel & projection
          </p>
          <p className="text-[11px] text-white/60 mt-1 max-w-2xl">
            Barres pleines : net LCIF réalisé (courtage ponctuel + commission linéaire). Barres hachurées : projection
            si les {summary.pipelineDossiers} dossier(s) en signature aboutissent. Courbe orange : primes clients / mois.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={monthsPast}
            onChange={(e) => setMonthsPast(Number(e.target.value))}
            className="text-[10px] rounded-md border border-white/20 bg-white/10 px-2 py-1"
          >
            {[3, 6, 12].map((n) => (
              <option key={n} value={n} className="text-slate-900">
                {n} mois passés
              </option>
            ))}
          </select>
          <select
            value={monthsFuture}
            onChange={(e) => setMonthsFuture(Number(e.target.value))}
            className="text-[10px] rounded-md border border-white/20 bg-white/10 px-2 py-1"
          >
            {[3, 6, 12].map((n) => (
              <option key={n} value={n} className="text-slate-900">
                {n} mois à venir
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="text-[10px] font-bold rounded-md border border-white/20 px-2 py-1 hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 inline ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 text-[11px]">
        <div className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-2">
          <p className="text-white/50 text-[10px] uppercase font-bold">MRR commission</p>
          <p className="font-black text-emerald-300">{formatEur(summary.currentMrrCommissionEur)}/mois</p>
        </div>
        <div className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-2">
          <p className="text-white/50 text-[10px] uppercase font-bold">Primes / mois</p>
          <p className="font-black text-amber-300">{formatEur(summary.currentMonthlyPremiumEur)}/mois</p>
        </div>
        <div className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-2">
          <p className="text-white/50 text-[10px] uppercase font-bold">MRR si pipeline signé</p>
          <p className="font-black text-indigo-300">{formatEur(summary.projectedMrrCommissionEur)}/mois</p>
        </div>
        <div className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-2">
          <p className="text-white/50 text-[10px] uppercase font-bold">Dossiers</p>
          <p className="font-black">
            {summary.signedDossiers} signés · {summary.pipelineDossiers} en cours
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${chart.w} ${chart.h}`}
          className="w-full min-w-[520px] max-h-[260px]"
          role="img"
          aria-label="Graphique rémunération club mensuelle"
        >
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const y = chart.padT + chart.innerH * (1 - t);
            const val = Math.round(chart.maxVal * t);
            return (
              <g key={t}>
                <line x1={chart.padL} y1={y} x2={chart.w - 12} y2={y} stroke="rgba(255,255,255,0.08)" />
                <text x={4} y={y + 4} fill="rgba(255,255,255,0.35)" fontSize="9">
                  {val >= 1000 ? `${Math.round(val / 1000)}k` : val}
                </text>
              </g>
            );
          })}

          {chart.bars.map(({ m, x, realizedH, projectedH, premiumY }) => (
            <g key={m.monthKey}>
              <rect
                x={x}
                y={chart.padT + chart.innerH - realizedH - projectedH}
                width={chart.barW * 0.42}
                height={Math.max(0, realizedH)}
                rx={2}
                fill="#34d399"
                opacity={0.9}
              />
              <rect
                x={x + chart.barW * 0.48}
                y={chart.padT + chart.innerH - projectedH}
                width={chart.barW * 0.42}
                height={Math.max(0, projectedH)}
                rx={2}
                fill="none"
                stroke="#818cf8"
                strokeWidth={2}
                strokeDasharray="4 3"
                opacity={0.95}
              />
              <circle cx={x + chart.barW / 2} cy={premiumY} r={3} fill="#fbbf24" />
              <text
                x={x + chart.barW / 2}
                y={chart.h - 8}
                textAnchor="middle"
                fill="rgba(255,255,255,0.45)"
                fontSize="8"
              >
                {m.label}
              </text>
            </g>
          ))}

          <path d={chart.premiumPath} fill="none" stroke="#fbbf24" strokeWidth={1.5} opacity={0.7} />
        </svg>
      </div>

      <div className="flex flex-wrap gap-4 mt-2 text-[10px] text-white/55">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-emerald-400" /> Net club réalisé
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm border-2 border-indigo-400 border-dashed" /> Projection pipeline
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-amber-400" /> Primes clients / mois
        </span>
      </div>
    </div>
  );
}
