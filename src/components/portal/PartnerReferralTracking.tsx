import React from "react";
import { Check, ExternalLink } from "lucide-react";

type Step = { key: string; label: string; done: boolean; active: boolean };

type Commission = {
  feesCourtageEur: number;
  apporteurPayoutEur: number;
  source: "manual" | "auto" | "estimate";
  hasStudyFees: boolean;
  payoutSharePercent?: number;
};

type Tracking = {
  dossierId: string;
  clientPortalUrl: string;
  statusLabel: string;
  statusDetail?: string;
  plannedChangeDateLabel?: string;
  steps: Step[];
  commission?: Commission | null;
};

const COMMISSION_SOURCE_LABEL: Record<Commission["source"], string> = {
  manual: "montant confirmé LCIF",
  auto: "extrait de l'étude",
  estimate: "estimation barème",
};

export default function PartnerReferralTracking({ tracking }: { tracking: Tracking }) {
  const isEstimate = tracking.commission?.source === "estimate";
  const sharePct = Math.round((tracking.commission?.payoutSharePercent ?? 0.5) * 100);
  const activeIndex = tracking.steps.findIndex((s) => s.active);
  const progressPct =
    tracking.steps.length > 1
      ? Math.round(
          ((tracking.steps.filter((s) => s.done).length + (activeIndex >= 0 ? 0.5 : 0)) /
            tracking.steps.length) *
            100,
        )
      : 0;

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-wide text-indigo-600">Suivi dossier</p>
          <p className="text-sm font-black text-slate-900 mt-0.5">{tracking.statusLabel}</p>
          {tracking.statusDetail ? (
            <p className="text-xs text-slate-600 mt-1 line-clamp-3">{tracking.statusDetail}</p>
          ) : null}
          {tracking.plannedChangeDateLabel ? (
            <p className="text-xs text-indigo-800 font-bold mt-2 inline-flex rounded-lg bg-indigo-100 px-2.5 py-1.5 border border-indigo-200">
              Changement prévu le {tracking.plannedChangeDateLabel}
            </p>
          ) : null}
        </div>
        {tracking.clientPortalUrl ? (
          <a
            href={tracking.clientPortalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50 shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Suivi client
          </a>
        ) : null}
      </div>

      <div className="mb-4">
        <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-1.5">
          <span>Progression</span>
          <span>{progressPct} %</span>
        </div>
        <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all"
            style={{ width: `${Math.min(100, Math.max(8, progressPct))}%` }}
          />
        </div>
      </div>

      {tracking.commission ? (
        <div className="grid sm:grid-cols-2 gap-2 mb-4">
          <div className="rounded-xl bg-white border border-slate-200 px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase text-slate-500">
              {isEstimate ? "Courtage estimé" : "Frais de courtage"}
            </p>
            <p className="text-lg font-black text-slate-900">{tracking.commission.feesCourtageEur} €</p>
          </div>
          <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase text-emerald-700">Votre part ({sharePct} %)</p>
            <p className="text-lg font-black text-emerald-800">{tracking.commission.apporteurPayoutEur} €</p>
            <p className="text-[10px] text-emerald-700/80">{COMMISSION_SOURCE_LABEL[tracking.commission.source]}</p>
          </div>
        </div>
      ) : null}

      <ol className="grid gap-2 sm:grid-cols-2">
        {tracking.steps.map((step) => (
          <li
            key={step.key}
            className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-xs ${
              step.done
                ? "border-emerald-100 bg-emerald-50/80 text-emerald-900"
                : step.active
                  ? "border-indigo-200 bg-indigo-50 text-indigo-900 font-bold"
                  : "border-slate-200 bg-white text-slate-500"
            }`}
          >
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                step.done
                  ? "bg-emerald-500 text-white"
                  : step.active
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-200 text-slate-500"
              }`}
            >
              {step.done ? <Check className="h-3.5 w-3.5" /> : <span className="h-2 w-2 rounded-full bg-current opacity-60" />}
            </span>
            <span className={step.done ? "line-through opacity-80" : ""}>{step.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
