import React from "react";

type Props = {
  label: string;
  value: number | string;
  sub?: string;
  accent?: "emerald" | "indigo" | "amber" | "slate" | "violet";
  large?: boolean;
};

const ACCENT: Record<NonNullable<Props["accent"]>, { value: string; bg: string; border: string }> = {
  emerald: { value: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-100" },
  indigo: { value: "text-indigo-700", bg: "bg-indigo-50", border: "border-indigo-100" },
  amber: { value: "text-amber-700", bg: "bg-amber-50", border: "border-amber-100" },
  slate: { value: "text-slate-900", bg: "bg-slate-50", border: "border-slate-200" },
  violet: { value: "text-violet-700", bg: "bg-violet-50", border: "border-violet-100" },
};

export default function KpiCard({ label, value, sub, accent = "slate", large }: Props) {
  const tone = ACCENT[accent];
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${tone.bg} ${tone.border}`}>
      <div className={`font-black tabular-nums ${large ? "text-3xl" : "text-2xl"} ${tone.value}`}>
        {value}
      </div>
      <div className="text-[10px] font-black text-slate-600 uppercase tracking-wide mt-1">{label}</div>
      {sub ? <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div> : null}
    </div>
  );
}

export function formatPercent(rate: number | null): string {
  if (rate == null || Number.isNaN(rate)) return "—";
  return `${Math.round(rate * 100)} %`;
}
