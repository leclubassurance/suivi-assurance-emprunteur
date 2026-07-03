import React from "react";
import { Sparkles, Target } from "lucide-react";
import type { ConseillerOperatingPhase } from "../../../shared/conseillerImmoClub";
import { CONSEILLER_AUTONOMY_SIGNED_THRESHOLD } from "../../../shared/conseillerImmoClub";

type Props = {
  operatingPhase: ConseillerOperatingPhase;
  signedCount: number;
  autonomyThreshold?: number;
};

export default function ConseillerPhaseBanner({
  operatingPhase,
  signedCount,
  autonomyThreshold = CONSEILLER_AUTONOMY_SIGNED_THRESHOLD,
}: Props) {
  const isAutonomous = operatingPhase === "autonomous";
  const remaining = Math.max(0, autonomyThreshold - signedCount);

  return (
    <section
      className={`rounded-2xl border p-4 shadow-sm ${
        isAutonomous
          ? "bg-gradient-to-br from-emerald-50 to-white border-emerald-200"
          : "bg-gradient-to-br from-indigo-50 to-white border-indigo-200"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
            isAutonomous ? "bg-emerald-100 text-emerald-700" : "bg-indigo-100 text-indigo-700"
          }`}
        >
          {isAutonomous ? <Sparkles className="w-5 h-5" /> : <Target className="w-5 h-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-wide text-slate-500 mb-0.5">
            {isAutonomous ? "Phase B — autonomie" : "Phase A — accompagnement LCIF"}
          </p>
          <p className="text-sm font-bold text-slate-900">
            {isAutonomous
              ? "Vous gérez la relation client ; LCIF souscrit en votre nom."
              : "Le Club Immobilier Français gère l'étude et la souscription pour vous."}
          </p>
          <p className="text-xs text-slate-600 mt-1.5">
            <strong className="text-slate-800">{signedCount}</strong> dossier{signedCount !== 1 ? "s" : ""} signé
            {signedCount !== 1 ? "s" : ""}
            {!isAutonomous ? (
              <>
                {" "}
                — encore <strong className="text-indigo-700">{remaining}</strong> pour débloquer la phase B (
                {autonomyThreshold} signés)
              </>
            ) : (
              <> — seuil d'autonomie atteint</>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
