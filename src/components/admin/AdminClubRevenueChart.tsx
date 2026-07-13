import React, { useCallback, useEffect, useMemo, useState } from "react";
import { TrendingUp, RefreshCw } from "lucide-react";
import { adminFetch } from "../../lib/adminApi";
import type { ClubRevenueForecast } from "../../../shared/clubRevenueForecast";
import { toMonthKeyFromDate } from "../../../shared/clubRevenueForecast";

function formatEur(n: number): string {
  return `${Math.round(n).toLocaleString("fr-FR")} €`;
}

function formatCompact(n: number): string {
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(Math.round(n));
}

type Props = {
  className?: string;
};

export default function AdminClubRevenueChart({ className = "" }: Props) {
  const [forecast, setForecast] = useState<ClubRevenueForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [monthsPast, setMonthsPast] = useState(3);
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

  const currentMonthKey = toMonthKeyFromDate(new Date());

  const chart = useMemo(() => {
    if (!forecast?.months?.length) return null;
    const months = forecast.months;
    const maxVal = Math.max(
      100,
      ...months.map((m) =>
        Math.max(
          m.totalNetClubEur,
          m.projectedCourtageGrossEur,
          m.monthlyCommissionEur + m.projectedMonthlyCommissionEur,
        ),
      ),
    );

    const barSlotW = 56;
    const w = Math.max(480, months.length * barSlotW + 56);
    const h = 260;
    const padL = 44;
    const padR = 8;
    const padT = 20;
    const padB = 52;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const barW = Math.min(40, Math.max(22, barSlotW - 10));

    const y = (v: number) => padT + innerH - (v / maxVal) * innerH;

    const bars = months.map((m, i) => {
      const x = padL + i * (innerW / months.length) + (innerW / months.length - barW) / 2;
      const realizedH = (m.totalNetClubEur / maxVal) * innerH;
      const projectedCourtageH = (m.projectedCourtageGrossEur / maxVal) * innerH;
      const mrrH = (m.projectedMonthlyCommissionEur / maxVal) * innerH;
      const isCurrent = m.monthKey === currentMonthKey;
      return { m, x, realizedH, projectedCourtageH, mrrH, isCurrent };
    });

    return { w, h, maxVal, bars, padL, padT, innerH, barW };
  }, [forecast, currentMonthKey]);

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
        <p className="text-xs text-white/50">
          Aucune donnée — envoyez une étude économie au client ou lancez « compute-economy » sur les dossiers.
        </p>
      </div>
    );
  }

  const { summary } = forecast;
  const pipelineRows =
    summary.contributions?.filter((c) => c.segment === "pipeline" && c.courtageGrossEur > 0) ?? [];

  return (
    <div className={`bg-slate-900 text-white px-4 py-4 border-t border-white/10 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-[10px] uppercase font-bold text-white/50 tracking-wide flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" />
            Rémunération club — mensuel & projection
          </p>
          <p className="text-[11px] text-white/60 mt-1 max-w-2xl">
            Vert : net LCIF encaissé. Violet : courtage pipeline (ponctuel à la signature). Bleu clair : MRR
            commission projetée. Données relues depuis les mails d&apos;étude à chaque actualisation.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={monthsPast}
            onChange={(e) => setMonthsPast(Number(e.target.value))}
            className="text-[10px] rounded-md border border-white/20 bg-white/10 px-2 py-1"
          >
            {[0, 3, 6].map((n) => (
              <option key={n} value={n} className="text-slate-900">
                {n === 0 ? "Aucun passé" : `${n} mois passés`}
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

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3 text-[11px]">
        <div className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-2">
          <p className="text-white/50 text-[10px] uppercase font-bold">MRR commission</p>
          <p className="font-black text-emerald-300">{formatEur(summary.currentMrrCommissionEur)}/mois</p>
        </div>
        <div className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-2">
          <p className="text-white/50 text-[10px] uppercase font-bold">Primes / mois</p>
          <p className="font-black text-amber-300">{formatEur(summary.currentMonthlyPremiumEur)}/mois</p>
        </div>
        <div className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-2">
          <p className="text-white/50 text-[10px] uppercase font-bold">Courtage pipeline</p>
          <p className="font-black text-violet-300">{formatEur(summary.projectedPipelineCourtageGrossEur)}</p>
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

      <div className="overflow-x-auto pb-1">
        <svg
          viewBox={`0 0 ${chart.w} ${chart.h}`}
          width={chart.w}
          height={chart.h}
          className="block"
          role="img"
          aria-label="Graphique rémunération club mensuelle"
        >
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const y = chart.padT + chart.innerH * (1 - t);
            const val = Math.round(chart.maxVal * t);
            return (
              <g key={t}>
                <line x1={chart.padL} y1={y} x2={chart.w - 8} y2={y} stroke="rgba(255,255,255,0.1)" />
                <text x={4} y={y + 4} fill="rgba(255,255,255,0.45)" fontSize="10">
                  {formatCompact(val)}
                </text>
              </g>
            );
          })}

          {chart.bars.map(({ m, x, realizedH, projectedCourtageH, mrrH, isCurrent }) => {
            const baseY = chart.padT + chart.innerH;
            const courtageTop = baseY - projectedCourtageH - mrrH - realizedH;
            return (
              <g key={m.monthKey}>
                {isCurrent ? (
                  <rect
                    x={x - 4}
                    y={chart.padT}
                    width={chart.barW + 8}
                    height={chart.innerH}
                    fill="rgba(255,255,255,0.04)"
                    rx={4}
                  />
                ) : null}
                <rect
                  x={x}
                  y={baseY - realizedH}
                  width={chart.barW}
                  height={Math.max(0, realizedH)}
                  rx={3}
                  fill="#34d399"
                />
                <rect
                  x={x}
                  y={baseY - projectedCourtageH - mrrH - realizedH}
                  width={chart.barW}
                  height={Math.max(2, projectedCourtageH)}
                  rx={3}
                  fill="#8b5cf6"
                  opacity={0.85}
                />
                <rect
                  x={x + 4}
                  y={baseY - mrrH - realizedH}
                  width={Math.max(4, chart.barW - 8)}
                  height={Math.max(0, mrrH)}
                  rx={2}
                  fill="#6366f1"
                  opacity={0.55}
                />
                {projectedCourtageH > 14 ? (
                  <text
                    x={x + chart.barW / 2}
                    y={courtageTop + 12}
                    textAnchor="middle"
                    fill="#fff"
                    fontSize="9"
                    fontWeight="bold"
                  >
                    {formatCompact(m.projectedCourtageGrossEur)}
                  </text>
                ) : null}
                <text
                  x={x + chart.barW / 2}
                  y={chart.h - 28}
                  textAnchor="middle"
                  fill={isCurrent ? "#c4b5fd" : "rgba(255,255,255,0.55)"}
                  fontSize="10"
                  fontWeight={isCurrent ? "bold" : "normal"}
                >
                  {m.label}
                </text>
                {isCurrent ? (
                  <text
                    x={x + chart.barW / 2}
                    y={chart.h - 14}
                    textAnchor="middle"
                    fill="#a78bfa"
                    fontSize="8"
                  >
                    en cours
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex flex-wrap gap-4 mt-2 text-[10px] text-white/55">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-emerald-400" /> Net club réalisé
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-violet-500" /> Courtage pipeline (ponctuel)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-indigo-400 opacity-70" /> MRR projeté
        </span>
      </div>

      {pipelineRows.length > 0 ? (
        <div className="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px]">
          <p className="font-bold text-white/60 uppercase mb-1.5">Détail pipeline (courtage brut)</p>
          <ul className="space-y-0.5 text-white/75">
            {pipelineRows.map((r) => (
              <li key={r.id}>
                <span className="font-mono text-violet-300">{r.id}</span>
                {" · "}
                {formatEur(r.courtageGrossEur)} brut
                {r.monthlyCommissionEur > 0
                  ? ` · ${formatEur(r.monthlyCommissionEur)}/mois commission`
                  : ""}
                {" · "}
                mois {r.startMonthKey}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
