import React from "react";
import { TrendingUp } from "lucide-react";
import type { RemunerationConfig } from "../../../shared/apporteurRemuneration";
import type { EarningsEstimate } from "../../../shared/apporteurRemuneration";

type Props = {
  earnings: { earnedEur: number; pipelineEur: number; totalIndicatifEur: number };
  remuneration: RemunerationConfig;
  simDossiers: number;
  simConversion: number;
  simSavings: number;
  simAssured: number;
  simulation: EarningsEstimate | null;
  payoutPerSignatureEur: number;
  onSimDossiers: (v: number) => void;
  onSimConversion: (v: number) => void;
  onSimSavings: (v: number) => void;
  onSimAssured: (v: number) => void;
};

export default function PartnerEarningsPanel({
  earnings,
  remuneration,
  simDossiers,
  simConversion,
  simSavings,
  simAssured,
  simulation,
  payoutPerSignatureEur,
  onSimDossiers,
  onSimConversion,
  onSimSavings,
  onSimAssured,
}: Props) {
  return (
    <section className="bg-gradient-to-br from-[#1E3A8A] to-indigo-800 rounded-2xl p-5 text-white shadow-lg">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-5 h-5 text-amber-300" />
        <h2 className="text-sm font-black uppercase tracking-wide">Vos gains</h2>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mb-5">
        <div className="bg-white/10 rounded-xl p-3 border border-white/10">
          <div className="text-2xl font-black text-emerald-300">{earnings.earnedEur} €</div>
          <div className="text-[10px] text-indigo-200 mt-1 uppercase font-bold">Acquis (signés)</div>
        </div>
        <div className="bg-white/10 rounded-xl p-3 border border-white/10">
          <div className="text-2xl font-black text-amber-200">{earnings.pipelineEur} €</div>
          <div className="text-[10px] text-indigo-200 mt-1 uppercase font-bold">Pipeline estimé</div>
        </div>
        <div className="bg-white/10 rounded-xl p-3 border border-white/10">
          <div className="text-2xl font-black">{earnings.totalIndicatifEur} €</div>
          <div className="text-[10px] text-indigo-200 mt-1 uppercase font-bold">Total indicatif</div>
        </div>
      </div>

      <div className="bg-white/5 rounded-xl p-4 border border-white/10">
        <p className="text-xs text-indigo-100 mb-4 font-medium">Simulateur — estimation mensuelle</p>
        <label className="block text-[11px] font-bold text-indigo-200 mb-3">
          Dossiers / mois : <span className="text-white">{simDossiers}</span>
          <input
            type="range"
            min={1}
            max={20}
            value={simDossiers}
            onChange={(e) => onSimDossiers(Number(e.target.value))}
            className="w-full mt-1.5 accent-amber-400"
          />
        </label>
        <label className="block text-[11px] font-bold text-indigo-200 mb-3">
          Conversion : <span className="text-white">{simConversion} %</span>
          <input
            type="range"
            min={8}
            max={55}
            value={simConversion}
            onChange={(e) => onSimConversion(Number(e.target.value))}
            className="w-full mt-1.5 accent-amber-400"
          />
        </label>
        <label className="block text-[11px] font-bold text-indigo-200 mb-3">
          Économies / assuré : <span className="text-white">{simSavings} €</span>
          <input
            type="range"
            min={1500}
            max={8000}
            step={100}
            value={simSavings}
            onChange={(e) => onSimSavings(Number(e.target.value))}
            className="w-full mt-1.5 accent-amber-400"
          />
        </label>
        <label className="block text-[11px] font-bold text-indigo-200 mb-4">
          Assurés / dossier : <span className="text-white">{simAssured}</span>
          <input
            type="range"
            min={1}
            max={2}
            step={0.5}
            value={simAssured}
            onChange={(e) => onSimAssured(Number(e.target.value))}
            className="w-full mt-1.5 accent-amber-400"
          />
        </label>

        {simulation ? (
          <div className="grid grid-cols-3 gap-2 bg-white/10 rounded-lg p-3">
            <div className="text-center">
              <div className="text-base font-black text-indigo-200">{simulation.conservativeMonthlyEur} €</div>
              <div className="text-[9px] font-bold text-indigo-300 uppercase">Prudent</div>
            </div>
            <div className="text-center border-x border-white/15">
              <div className="text-lg font-black text-amber-300">{simulation.expectedMonthlyEur} €</div>
              <div className="text-[9px] font-bold text-amber-200/80 uppercase">Estimation</div>
            </div>
            <div className="text-center">
              <div className="text-base font-black text-emerald-300">{simulation.optimisticMonthlyEur} €</div>
              <div className="text-[9px] font-bold text-indigo-300 uppercase">Optimiste</div>
            </div>
          </div>
        ) : null}
      </div>

      <p className="text-[10px] text-indigo-200/90 mt-4 leading-relaxed">
        {remuneration.disclaimer} · ≈ {payoutPerSignatureEur} € / dossier signé (simulation) · Paiement à réception de la
        commission assureur.
      </p>
    </section>
  );
}
