import React from "react";
import { ExternalLink } from "lucide-react";

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
  steps: Step[];
  commission?: Commission | null;
};

const COMMISSION_SOURCE_LABEL: Record<Commission["source"], string> = {
  manual: "montant confirmé Le Club Immobilier Français",
  auto: "extrait de l'étude",
  estimate: "estimation barème",
};

export default function PartnerReferralTracking({ tracking }: { tracking: Tracking }) {
  const isEstimate = tracking.commission?.source === "estimate";
  const sharePct = Math.round((tracking.commission?.payoutSharePercent ?? 0.5) * 100);
  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-[11px] font-black uppercase text-indigo-600">Suivi dossier client</p>
          <p className="text-xs font-bold text-slate-800">{tracking.statusLabel}</p>
          {tracking.statusDetail ? (
            <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{tracking.statusDetail}</p>
          ) : null}
        </div>
        {tracking.clientPortalUrl ? (
          <a
            href={tracking.clientPortalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700 hover:underline shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Lien suivi client
          </a>
        ) : null}
      </div>
      {tracking.commission ? (
        <p className="text-[11px] text-slate-600 mb-2 bg-slate-50 rounded-lg px-2.5 py-2 border border-slate-100">
          {isEstimate ? "Commission estimée" : "Frais de courtage"} :{" "}
          <strong>{tracking.commission.feesCourtageEur} €</strong>
          {" · "}
          Votre part ({sharePct} %) : <strong className="text-emerald-700">{tracking.commission.apporteurPayoutEur} €</strong>
          <span className="text-slate-400"> ({COMMISSION_SOURCE_LABEL[tracking.commission.source]})</span>
        </p>
      ) : null}
      <ol className="space-y-1.5">
        {tracking.steps.map((step) => (
          <li key={step.key} className="flex items-center gap-2 text-[11px]">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                step.done ? "bg-emerald-500" : step.active ? "bg-indigo-500 ring-2 ring-indigo-200" : "bg-slate-200"
              }`}
            />
            <span className={step.done ? "text-slate-500 line-through" : step.active ? "text-indigo-900 font-bold" : "text-slate-600"}>
              {step.label}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
