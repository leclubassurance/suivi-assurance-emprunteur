import React, { useMemo, useState } from "react";
import { Trophy } from "lucide-react";
import type { ApporteurLeaderboardMetric, ApporteurLeaderboardRow } from "../../../shared/apporteurLeaderboard";

type Props = {
  rows: ApporteurLeaderboardRow[];
  onSelectApporteur?: (id: string) => void;
};

const METRICS: { key: ApporteurLeaderboardMetric; label: string }[] = [
  { key: "signed", label: "Dossiers signés" },
  { key: "earned", label: "CA généré (€)" },
  { key: "clicks", label: "Visites lien" },
  { key: "referrals", label: "Recommandations" },
];

export default function AdminApporteurLeaderboard({ rows, onSelectApporteur }: Props) {
  const [metric, setMetric] = useState<ApporteurLeaderboardMetric>("signed");

  const sorted = useMemo(() => {
    const copy = [...rows];
    const score = (r: ApporteurLeaderboardRow) => {
      switch (metric) {
        case "clicks":
          return r.linkClicks;
        case "earned":
          return r.earnedEur;
        case "referrals":
          return r.referralsTotal;
        default:
          return r.signedCount;
      }
    };
    copy.sort((a, b) => score(b) - score(a) || b.linkClicks - a.linkClicks);
    return copy.map((r, i) => ({ ...r, rank: i + 1 }));
  }, [rows, metric]);

  if (!rows.length) return null;

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-black uppercase tracking-wide text-slate-700 flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-500" /> Classement apporteurs
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMetric(m.key)}
              className={`text-[10px] font-bold uppercase tracking-wide px-2.5 py-1.5 rounded-lg border ${
                metric === m.key
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] font-black uppercase tracking-wide text-slate-400 border-b">
              <th className="py-2 pr-2 w-10">#</th>
              <th className="py-2 pr-3">Partenaire</th>
              <th className="py-2 pr-3 text-right">Visites</th>
              <th className="py-2 pr-3 text-right">Recos</th>
              <th className="py-2 pr-3 text-right">Signés</th>
              <th className="py-2 pr-3 text-right">CA estimé</th>
              <th className="py-2 text-left">Origine clics</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 20).map((row) => (
              <tr key={row.apporteurId} className="border-b border-slate-50 hover:bg-slate-50/80">
                <td className="py-2.5 pr-2 font-black text-indigo-700">{row.rank}</td>
                <td className="py-2.5 pr-3">
                  <button
                    type="button"
                    onClick={() => onSelectApporteur?.(row.apporteurId)}
                    className="text-left hover:underline"
                  >
                    <span className="font-bold text-slate-900 block">{row.contactName}</span>
                    <span className="text-[11px] text-slate-500">{row.companyName}</span>
                  </button>
                </td>
                <td className="py-2.5 pr-3 text-right font-mono text-slate-700">{row.linkClicks}</td>
                <td className="py-2.5 pr-3 text-right text-slate-600">{row.referralsTotal}</td>
                <td className="py-2.5 pr-3 text-right font-bold text-emerald-700">{row.signedCount}</td>
                <td className="py-2.5 pr-3 text-right text-slate-700">
                  {row.earnedEur > 0 ? `${row.earnedEur.toLocaleString("fr-FR")} €` : "—"}
                </td>
                <td className="py-2.5 text-[11px] text-slate-500">
                  {row.topCountries.length
                    ? row.topCountries.map((c) => `${c.label} (${c.count})`).join(" · ")
                    : row.linkClicks > 0
                      ? "Pays non détecté"
                      : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-slate-400 mt-3">
        Classement selon : <strong>{METRICS.find((m) => m.key === metric)?.label}</strong>. CA = commissions
        apporteur sur dossiers signés (réel ou estimé). Géoloc = pays si l&apos;hébergeur expose l&apos;en-tête pays.
      </p>
    </section>
  );
}
