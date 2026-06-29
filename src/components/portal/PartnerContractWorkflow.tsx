import React from "react";
import { CheckCircle2, Circle, FileSignature, Send, ShieldCheck } from "lucide-react";

const STEPS = [
  { id: "none", label: "Validation LCIF", icon: ShieldCheck },
  { id: "pending", label: "Contrat préparé", icon: FileSignature },
  { id: "sent", label: "Contrat envoyé", icon: Send },
  { id: "signed", label: "Accès débloqué", icon: CheckCircle2 },
] as const;

function stepIndex(status: string): number {
  if (status === "signed") return 3;
  if (status === "sent") return 2;
  if (status === "pending") return 1;
  return 0;
}

export default function PartnerContractWorkflow({
  contractStatus,
  semiAutoPreview = true,
}: {
  contractStatus: string;
  semiAutoPreview?: boolean;
}) {
  const current = stepIndex(contractStatus);
  const signed = contractStatus === "signed";

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 mb-1">Contrat partenaire</h2>
      {semiAutoPreview ? (
        <p className="text-xs text-slate-500 mb-4">
          Parcours cible (semi-automatique DocuSign) — en attendant, notre équipe valide et vous envoie le contrat.
        </p>
      ) : null}
      <ol className="space-y-3">
        {STEPS.map((step, i) => {
          const done = i < current || (signed && i <= 3);
          const active = i === current && !signed;
          const Icon = step.icon;
          return (
            <li
              key={step.id}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 border ${
                done
                  ? "bg-emerald-50 border-emerald-100"
                  : active
                    ? "bg-indigo-50 border-indigo-200"
                    : "bg-slate-50 border-slate-100"
              }`}
            >
              {done ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              ) : active ? (
                <Icon className="w-5 h-5 text-indigo-600 shrink-0" />
              ) : (
                <Circle className="w-5 h-5 text-slate-300 shrink-0" />
              )}
              <span className={`text-sm font-bold ${done ? "text-emerald-800" : active ? "text-indigo-900" : "text-slate-400"}`}>
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
      {!signed ? (
        <p className="mt-4 text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
          Votre lien client et l&apos;envoi de recommandations seront disponibles dès signature du contrat.
          Contact : <a className="font-bold underline" href="mailto:assurance@leclubimmobilier.fr">assurance@leclubimmobilier.fr</a>
        </p>
      ) : null}
    </section>
  );
}
