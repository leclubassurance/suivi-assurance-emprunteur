import React, { useCallback, useEffect, useMemo, useState } from "react";
import { TrendingUp, RefreshCw } from "lucide-react";
import { adminFetch } from "../../lib/adminApi";
import type { ClubRevenueForecast, ClubRevenueMonthPoint, ClubRevenueSegment } from "../../../shared/clubRevenueForecast";
import {
  toMonthKeyFromDate,
} from "../../../shared/clubRevenueForecast";

function formatEur(n: number): string {
  return `${Math.round(n).toLocaleString("fr-FR")} €`;
}

function formatCompact(n: number): string {
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(Math.round(n));
}

const SEGMENTS: ClubRevenueSegment[] = ["settled", "signed", "pipeline"];

const SEGMENT_META: Record<
  ClubRevenueSegment,
  { label: string; short: string; fill: string; text: string; border: string }
> = {
  settled: {
    label: "Traité — réalisé",
    short: "Traité",
    fill: "#34d399",
    text: "text-emerald-300",
    border: "border-emerald-400/30",
  },
  signed: {
    label: "Signé — quasi assuré",
    short: "Signé",
    fill: "#38bdf8",
    text: "text-sky-300",
    border: "border-sky-400/30",
  },
  pipeline: {
    label: "En signature — théorique",
    short: "Théorique",
    fill: "#a78bfa",
    text: "text-violet-300",
    border: "border-violet-400/30",
  },
};

type Props = { className?: string };

type SegmentAmounts = Record<ClubRevenueSegment, number>;

function courtageBySegment(m: ClubRevenueMonthPoint): SegmentAmounts {
  return {
    settled: m.settledCourtageNetEur,
    signed: m.signedCourtageNetEur,
    pipeline: m.pipelineCourtageNetEur,
  };
}

function recurringBySegment(m: ClubRevenueMonthPoint): SegmentAmounts {
  return {
    settled: m.settledMonthlyCommissionEur,
    signed: m.signedMonthlyCommissionEur,
    pipeline: m.pipelineMonthlyCommissionEur,
  };
}

function sumSegments(v: SegmentAmounts): number {
  return v.settled + v.signed + v.pipeline;
}

type MiniChartProps = {
  title: string;
  subtitle: string;
  months: ClubRevenueMonthPoint[];
  currentMonthKey: string;
  getSegments: (m: ClubRevenueMonthPoint) => SegmentAmounts;
  emptyHint: string;
  minCourtageBar?: boolean;
};

function MiniStackedChart({
  title,
  subtitle,
  months,
  currentMonthKey,
  getSegments,
  emptyHint,
  minCourtageBar = false,
}: MiniChartProps) {
  const model = useMemo(() => {
    const values = months.map((m) => sumSegments(getSegments(m)));
    const maxVal = Math.max(values.some((v) => v > 0) ? 1 : 100, ...values);
    const slotW = 58;
    const w = Math.max(480, months.length * slotW + 48);
    const h = 200;
    const padL = 40;
    const padT = 16;
    const padB = 44;
    const innerW = w - padL - 8;
    const innerH = h - padT - padB;
    const barW = 22;

    const bars = months.map((m, i) => {
      const segs = getSegments(m);
      const total = sumSegments(segs);
      const x = padL + i * (innerW / months.length) + (innerW / months.length - barW) / 2;
      const layers = SEGMENTS.map((seg) => ({
        seg,
        amount: segs[seg],
        height: (segs[seg] / maxVal) * innerH,
        fill: SEGMENT_META[seg].fill,
      })).filter((l) => l.amount > 0);
      return { m, x, layers, total, isCurrent: m.monthKey === currentMonthKey };
    });

    return { w, h, maxVal, bars, padL, padT, innerH, barW };
  }, [months, getSegments]);

  const hasData = model.bars.some((b) => b.total > 0);

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-2">
        <p className="text-[11px] font-bold text-white/80">{title}</p>
        <p className="text-[10px] text-white/45">{subtitle}</p>
      </div>
      {!hasData ? (
        <p className="text-[10px] text-white/40 py-8 text-center">{emptyHint}</p>
      ) : (
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${model.w} ${model.h}`} width={model.w} height={model.h} className="block">
            {[0, 0.5, 1].map((t) => {
              const y = model.padT + model.innerH * (1 - t);
              return (
                <g key={t}>
                  <line x1={model.padL} y1={y} x2={model.w - 4} y2={y} stroke="rgba(255,255,255,0.08)" />
                  <text x={4} y={y + 3} fill="rgba(255,255,255,0.4)" fontSize="9">
                    {formatCompact(model.maxVal * t)}
                  </text>
                </g>
              );
            })}
            {model.bars.map(({ m, x, layers, total, isCurrent }) => {
              let yCursor = model.padT + model.innerH;
              return (
                <g key={m.monthKey}>
                  {isCurrent ? (
                    <rect
                      x={x - 3}
                      y={model.padT}
                      width={model.barW + 6}
                      height={model.innerH}
                      fill="rgba(255,255,255,0.05)"
                      rx={3}
                    />
                  ) : null}
                  {layers.map((layer) => {
                    yCursor -= layer.height;
                    const barH = Math.max(minCourtageBar ? 4 : 2, layer.height);
                    return (
                      <rect
                        key={layer.seg}
                        x={x}
                        y={yCursor}
                        width={model.barW}
                        height={barH}
                        rx={2}
                        fill={layer.fill}
                        opacity={layer.seg === "pipeline" ? 0.8 : 1}
                        stroke={layer.seg === "pipeline" ? "#c4b5fd" : undefined}
                        strokeWidth={layer.seg === "pipeline" ? 1 : 0}
                        strokeDasharray={layer.seg === "pipeline" ? "3 2" : undefined}
                      />
                    );
                  })}
                  {total > 0 ? (
                    <text
                      x={x + model.barW / 2}
                      y={model.padT + 10}
                      textAnchor="middle"
                      fill="rgba(255,255,255,0.9)"
                      fontSize="9"
                      fontWeight="bold"
                    >
                      {formatCompact(total)}
                    </text>
                  ) : (
                    <text
                      x={x + model.barW / 2}
                      y={model.padT + model.innerH / 2}
                      textAnchor="middle"
                      fill="rgba(255,255,255,0.15)"
                      fontSize="8"
                    >
                      —
                    </text>
                  )}
                  <text
                    x={x + model.barW / 2}
                    y={model.h - 22}
                    textAnchor="middle"
                    fill={isCurrent ? "#c4b5fd" : "rgba(255,255,255,0.5)"}
                    fontSize="9"
                    fontWeight={isCurrent ? "bold" : "normal"}
                  >
                    {m.label}
                  </text>
                  {isCurrent ? (
                    <text x={x + model.barW / 2} y={model.h - 10} textAnchor="middle" fill="#a78bfa" fontSize="7">
                      en cours
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}

export default function AdminClubRevenueChart({ className = "" }: Props) {
  const [forecast, setForecast] = useState<ClubRevenueForecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [monthsPast, setMonthsPast] = useState(0);
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

  if (loading && !forecast) {
    return (
      <div className={`bg-slate-900 text-white px-4 py-6 ${className}`}>
        <p className="text-xs text-white/50">Chargement du graphique rémunération club…</p>
      </div>
    );
  }

  if (!forecast?.months?.length) {
    return (
      <div className={`bg-slate-900 text-white px-4 py-6 ${className}`}>
        <p className="text-xs text-white/50">
          Aucune donnée — envoyez une étude économie au client ou lancez « compute-economy » sur les dossiers.
        </p>
      </div>
    );
  }

  const { summary, months } = forecast;
  const contributions = summary.contributions ?? [];
  const totalRecurring =
    summary.settledMrrCommissionEur + summary.signedMrrCommissionEur + summary.pipelineMrrCommissionEur;
  const totalCourtage =
    summary.settledCourtageNetEur + summary.signedCourtageNetEur + summary.pipelineCourtageNetEur;

  return (
    <div className={`bg-slate-900 text-white px-4 py-4 border-t border-white/10 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-[10px] uppercase font-bold text-white/50 tracking-wide flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" />
            Rémunération club LCIF
          </p>
          <p className="text-[11px] text-white/60 mt-1 max-w-2xl">
            Part club uniquement : courtage net (distribution − rétro partenaire) et commission linéaire Kereis.
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

      {summary.peakMonthLabel && (summary.peakMonthTotalEur ?? 0) > 0 ? (
        <div className="mb-3 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[11px]">
          <span className="font-bold text-amber-200">Pic prévu — {summary.peakMonthLabel}</span>
          {" · "}
          <span className="text-white/80">{formatEur(summary.peakMonthTotalEur ?? 0)}</span>
          {(summary.peakMonthCourtageEur ?? 0) > 0 ? (
            <span className="text-white/55">
              {" "}
              (dont {formatEur(summary.peakMonthCourtageEur ?? 0)} courtage ponctuel
              {(summary.peakMonthRecurringEur ?? 0) > 0
                ? ` + ${formatEur(summary.peakMonthRecurringEur ?? 0)}/mois récurrent`
                : ""}
              )
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
        {SEGMENTS.map((seg) => {
          const meta = SEGMENT_META[seg];
          const count =
            seg === "settled"
              ? summary.settledDossiers
              : seg === "signed"
                ? summary.signedDossiers
                : summary.pipelineDossiers;
          const courtage =
            seg === "settled"
              ? summary.settledCourtageNetEur
              : seg === "signed"
                ? summary.signedCourtageNetEur
                : summary.pipelineCourtageNetEur;
          const mrr =
            seg === "settled"
              ? summary.settledMrrCommissionEur
              : seg === "signed"
                ? summary.signedMrrCommissionEur
                : summary.pipelineMrrCommissionEur;
          return (
            <div
              key={seg}
              className={`rounded-xl border ${meta.border} bg-white/[0.04] px-3 py-2.5`}
              style={{ borderLeftWidth: 3, borderLeftColor: meta.fill }}
            >
              <p className={`text-[10px] uppercase font-bold ${meta.text}`}>{meta.label}</p>
              <p className="text-[11px] text-white/50 mt-0.5">{count} dossier{count > 1 ? "s" : ""}</p>
              <div className="mt-2 space-y-0.5 text-[11px]">
                <p>
                  Courtage net : <strong className="text-white">{formatEur(courtage)}</strong>
                  <span className="text-white/40 text-[9px]"> · ponctuel</span>
                </p>
                <p>
                  Récurrent : <strong className="text-white">{formatEur(mrr)}/mois</strong>
                  <span className="text-white/40 text-[9px]"> · commission linéaire</span>
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4 text-[11px]">
        <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2">
          <p className="text-white/45 text-[10px] uppercase font-bold">Total courtage net en jeu</p>
          <p className="font-black text-lg text-white">{formatEur(totalCourtage)}</p>
        </div>
        <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2">
          <p className="text-white/45 text-[10px] uppercase font-bold">Total récurrent club (MRR)</p>
          <p className="font-black text-lg text-white">{formatEur(totalRecurring)}/mois</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <MiniStackedChart
          title="Courtage net club — ponctuel à la signature"
          subtitle="Montant encaissé une seule fois le mois de signature"
          months={months}
          currentMonthKey={currentMonthKey}
          getSegments={courtageBySegment}
          emptyHint="Aucun courtage prévu sur la période"
          minCourtageBar
        />
        <MiniStackedChart
          title="Commission récurrente club — chaque mois"
          subtitle="Commission linéaire Kereis tant que le contrat est actif"
          months={months}
          currentMonthKey={currentMonthKey}
          getSegments={recurringBySegment}
          emptyHint="Aucune commission récurrente sur la période"
        />
      </div>

      <div className="flex flex-wrap gap-4 text-[10px] text-white/55">
        {SEGMENTS.map((seg) => (
          <span key={seg} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: SEGMENT_META[seg].fill }} />
            {SEGMENT_META[seg].label}
          </span>
        ))}
      </div>

      {SEGMENTS.map((segment) => {
        const rows = contributions.filter((c) => c.segment === segment);
        if (!rows.length) return null;
        const meta = SEGMENT_META[segment];
        return (
          <div key={segment} className="mt-3 rounded-lg border border-white/10 bg-white/5 overflow-hidden">
            <div className="px-3 py-2 border-b border-white/10 bg-white/[0.03]">
              <p className={`font-bold text-[10px] uppercase ${meta.text}`}>
                {meta.short} — {rows.length} dossier{rows.length > 1 ? "s" : ""}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-white/40 border-b border-white/5">
                    <th className="text-left font-bold px-3 py-1.5">Dossier</th>
                    <th className="text-right font-bold px-3 py-1.5">Courtage net</th>
                    <th className="text-right font-bold px-3 py-1.5">Récurrent / mois</th>
                    <th className="text-right font-bold px-3 py-1.5">Mois signature</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                      <td className="px-3 py-1.5 font-mono" style={{ color: meta.fill }}>
                        {r.id}
                      </td>
                      <td className="px-3 py-1.5 text-right text-white/85">
                        {r.courtageNetEur > 0 ? formatEur(r.courtageNetEur) : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right text-white/85">
                        {r.monthlyCommissionEur > 0 ? `${formatEur(r.monthlyCommissionEur)}/mois` : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right text-white/55">{r.startMonthKey}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-white/[0.04] font-bold">
                    <td className="px-3 py-1.5 text-white/60">Total</td>
                    <td className="px-3 py-1.5 text-right">
                      {formatEur(rows.reduce((s, r) => s + r.courtageNetEur, 0))}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {formatEur(rows.reduce((s, r) => s + r.monthlyCommissionEur, 0))}/mois
                    </td>
                    <td className="px-3 py-1.5" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
