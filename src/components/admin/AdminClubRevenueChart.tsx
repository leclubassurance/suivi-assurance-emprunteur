import React, { useCallback, useEffect, useMemo, useState } from "react";
import { TrendingUp, RefreshCw } from "lucide-react";
import { adminFetch } from "../../lib/adminApi";
import type { ClubRevenueForecast, ClubRevenueSegment } from "../../../shared/clubRevenueForecast";
import { monthPointTotalNetClub, toMonthKeyFromDate } from "../../../shared/clubRevenueForecast";

function formatEur(n: number): string {
  return `${Math.round(n).toLocaleString("fr-FR")} €`;
}

function formatCompact(n: number): string {
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(Math.round(n));
}

const SEGMENT_META: Record<
  ClubRevenueSegment,
  { label: string; short: string; fill: string; stroke?: string; dash?: string }
> = {
  settled: {
    label: "Traité — réalisé",
    short: "Traité",
    fill: "#34d399",
  },
  signed: {
    label: "Signé — commission future quasi assurée",
    short: "Signé",
    fill: "#38bdf8",
  },
  pipeline: {
    label: "En signature — théorique",
    short: "Théorique",
    fill: "#a78bfa",
    stroke: "#c4b5fd",
    dash: "4 3",
  },
};

type Props = {
  className?: string;
};

type BarLayer = {
  key: string;
  height: number;
  amount: number;
  label: string;
  fill: string;
  stroke?: string;
  dash?: string;
  opacity?: number;
};

function buildBarLayers(m: ClubRevenueForecast["months"][number]): BarLayer[] {
  const layers: BarLayer[] = [];

  const push = (
    key: string,
    amount: number,
    kind: "courtage" | "commission",
    segment: ClubRevenueSegment,
  ) => {
    if (amount <= 0) return;
    const meta = SEGMENT_META[segment];
    layers.push({
      key,
      height: 0,
      amount,
      label: kind === "courtage" ? `Courtage net ${formatCompact(amount)}` : `Récurrent ${formatCompact(amount)}`,
      fill: meta.fill,
      stroke: meta.stroke,
      dash: meta.dash,
      opacity: segment === "pipeline" ? 0.75 : 1,
    });
  };

  push("settled-commission", m.settledMonthlyCommissionEur, "commission", "settled");
  push("signed-commission", m.signedMonthlyCommissionEur, "commission", "signed");
  push("pipeline-commission", m.pipelineMonthlyCommissionEur, "commission", "pipeline");
  push("settled-courtage", m.settledCourtageNetEur, "courtage", "settled");
  push("signed-courtage", m.signedCourtageNetEur, "courtage", "signed");
  push("pipeline-courtage", m.pipelineCourtageNetEur, "courtage", "pipeline");

  return layers;
}

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
    const maxVal = Math.max(100, ...months.map((m) => monthPointTotalNetClub(m)));

    const barSlotW = 64;
    const w = Math.max(520, months.length * barSlotW + 56);
    const h = 300;
    const padL = 44;
    const padR = 8;
    const padT = 24;
    const padB = 56;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const barW = Math.min(44, Math.max(24, barSlotW - 12));

    const bars = months.map((m, i) => {
      const x = padL + i * (innerW / months.length) + (innerW / months.length - barW) / 2;
      const layers = buildBarLayers(m).map((layer) => ({
        ...layer,
        height: (layer.amount / maxVal) * innerH,
      }));
      const total = monthPointTotalNetClub(m);
      const isCurrent = m.monthKey === currentMonthKey;
      return { m, x, layers, total, isCurrent };
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
  const contributions = summary.contributions ?? [];

  const segmentRows = (segment: ClubRevenueSegment) =>
    contributions.filter((c) => c.segment === segment && (c.courtageNetEur > 0 || c.monthlyCommissionEur > 0));

  return (
    <div className={`bg-slate-900 text-white px-4 py-4 border-t border-white/10 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-[10px] uppercase font-bold text-white/50 tracking-wide flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" />
            Rémunération club — part LCIF sur courtage & commission récurrente
          </p>
          <p className="text-[11px] text-white/60 mt-1 max-w-3xl">
            Uniquement la part club : courtage net (frais de distribution − rétro partenaire) et commission
            linéaire Kereis mensuelle. Vert = traités · Bleu = signés en cours · Violet = théorique (en
            signature).
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

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-3 text-[11px]">
        <div className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-2">
          <p className="text-white/50 text-[10px] uppercase font-bold">Récurrent traités</p>
          <p className="font-black text-emerald-300">{formatEur(summary.settledMrrCommissionEur)}/mois</p>
        </div>
        <div className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-2">
          <p className="text-white/50 text-[10px] uppercase font-bold">Récurrent signés</p>
          <p className="font-black text-sky-300">{formatEur(summary.signedMrrCommissionEur)}/mois</p>
        </div>
        <div className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-2">
          <p className="text-white/50 text-[10px] uppercase font-bold">Récurrent théorique</p>
          <p className="font-black text-violet-300">{formatEur(summary.pipelineMrrCommissionEur)}/mois</p>
        </div>
        <div className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-2">
          <p className="text-white/50 text-[10px] uppercase font-bold">Courtage net traités</p>
          <p className="font-black text-emerald-200">{formatEur(summary.settledCourtageNetEur)}</p>
        </div>
        <div className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-2">
          <p className="text-white/50 text-[10px] uppercase font-bold">Courtage net signés</p>
          <p className="font-black text-sky-200">{formatEur(summary.signedCourtageNetEur)}</p>
        </div>
        <div className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-2">
          <p className="text-white/50 text-[10px] uppercase font-bold">Courtage net théorique</p>
          <p className="font-black text-violet-200">{formatEur(summary.pipelineCourtageNetEur)}</p>
          <p className="text-[9px] text-white/45 mt-0.5">
            {summary.settledDossiers} traités · {summary.signedDossiers} signés · {summary.pipelineDossiers}{" "}
            en cours
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

          {chart.bars.map(({ m, x, layers, total, isCurrent }) => {
            const baseY = chart.padT + chart.innerH;
            let cursorY = baseY;
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
                {layers.map((layer) => {
                  cursorY -= layer.height;
                  const y = cursorY;
                  const h = Math.max(layer.key.includes("courtage") ? 3 : 0, layer.height);
                  return (
                    <g key={layer.key}>
                      {layer.dash ? (
                        <rect
                          x={x}
                          y={y}
                          width={chart.barW}
                          height={h}
                          rx={3}
                          fill={layer.fill}
                          opacity={layer.opacity}
                          stroke={layer.stroke}
                          strokeWidth={1}
                          strokeDasharray={layer.dash}
                        />
                      ) : (
                        <rect
                          x={x}
                          y={y}
                          width={chart.barW}
                          height={h}
                          rx={3}
                          fill={layer.fill}
                          opacity={layer.opacity}
                        />
                      )}
                      {h >= 16 ? (
                        <text
                          x={x + chart.barW / 2}
                          y={y + Math.min(h - 4, 12)}
                          textAnchor="middle"
                          fill="#fff"
                          fontSize="8"
                          fontWeight="bold"
                        >
                          {formatCompact(layer.amount)}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
                {total > 0 ? (
                  <text
                    x={x + chart.barW / 2}
                    y={chart.padT + 12}
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.85)"
                    fontSize="9"
                    fontWeight="bold"
                  >
                    {formatCompact(total)}
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
                  <text x={x + chart.barW / 2} y={chart.h - 14} textAnchor="middle" fill="#a78bfa" fontSize="8">
                    en cours
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex flex-wrap gap-4 mt-2 text-[10px] text-white/55">
        {(Object.keys(SEGMENT_META) as ClubRevenueSegment[]).map((seg) => {
          const meta = SEGMENT_META[seg];
          return (
            <span key={seg} className="flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-3 rounded-sm"
                style={{
                  background: meta.fill,
                  opacity: seg === "pipeline" ? 0.75 : 1,
                  border: meta.stroke ? `1px dashed ${meta.stroke}` : undefined,
                }}
              />
              {meta.label}
            </span>
          );
        })}
      </div>

      {(["pipeline", "signed", "settled"] as ClubRevenueSegment[]).map((segment) => {
        const rows = segmentRows(segment);
        if (!rows.length) return null;
        const meta = SEGMENT_META[segment];
        return (
          <div key={segment} className="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px]">
            <p className="font-bold text-white/60 uppercase mb-1.5">Détail — {meta.label}</p>
            <ul className="space-y-0.5 text-white/75">
              {rows.map((r) => (
                <li key={r.id}>
                  <span className="font-mono" style={{ color: meta.fill }}>
                    {r.id}
                  </span>
                  {" · "}
                  {r.courtageNetEur > 0 ? `${formatEur(r.courtageNetEur)} courtage net club` : "— courtage"}
                  {r.monthlyCommissionEur > 0
                    ? ` · ${formatEur(r.monthlyCommissionEur)}/mois commission linéaire`
                    : ""}
                  {" · "}
                  mois {r.startMonthKey}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
