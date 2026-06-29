import React from "react";
import { ExternalLink } from "lucide-react";

type Step = { key: string; label: string; done: boolean; active: boolean };

type Tracking = {
  dossierId: string;
  clientPortalUrl: string;
  statusLabel: string;
  statusDetail?: string;
  steps: Step[];
};

export default function PartnerReferralTracking({ tracking }: { tracking: Tracking }) {
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
