import React from "react";

type Props = {
  label: string;
  value: number | string;
  sub?: string;
  accent?: "emerald" | "indigo" | "amber" | "slate" | "violet";
  large?: boolean;
};

const ACCENT: Record<NonNullable<Props["accent"]>, string> = {
  emerald: "text-emerald-600",
  indigo: "text-indigo-600",
  amber: "text-amber-600",
  slate: "text-slate-900",
  violet: "text-violet-600",
};

export default function KpiCard({ label, value, sub, accent = "slate", large }: Props) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
      <div className={`font-black tabular-nums ${large ? "text-3xl" : "text-2xl"} ${ACCENT[accent]}`}>
        {value}
      </div>
      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mt-1">{label}</div>
      {sub ? <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div> : null}
    </div>
  );
}

export function formatPercent(rate: number | null): string {
  if (rate == null || Number.isNaN(rate)) return "—";
  return `${Math.round(rate * 100)} %`;
}
