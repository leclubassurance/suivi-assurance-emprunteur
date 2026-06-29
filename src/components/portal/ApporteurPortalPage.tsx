import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Loader2, Plus, Send, TrendingUp, Users } from "lucide-react";
import { getApiUrl } from "../../lib/utils";
import type { ReferralStatus } from "../../../shared/apporteurTypes";
import {
  APPORTEUR_TYPE_LABELS,
  REFERRAL_STATUS_LABELS,
} from "../../../shared/apporteurTypes";
import type { ReferralKpis } from "../../../shared/apporteurKpis";
import type { RemunerationConfig } from "../../../shared/apporteurRemuneration";
import { computeApporteurPayoutEur, estimatePartnerEarnings } from "../../../shared/apporteurRemuneration";
import LcifPartnerHeader, { LcifPartnerFooter } from "./LcifPartnerHeader";
import KpiCard, { formatPercent } from "./PartnerKpiGrid";
import PartnerContractWorkflow from "./PartnerContractWorkflow";

type PortalReferral = {
  id: string;
  status: ReferralStatus;
  contact: {
    prenom?: string;
    nom?: string;
    email?: string;
    phone?: string;
    notes?: string;
  };
  createdAt: string;
  updatedAt: string;
};

type PortalData = {
  apporteur: {
    companyName: string;
    contactName: string;
    type: string;
    contractStatus?: string;
    contractSigned?: boolean;
  };
  referrals: PortalReferral[];
  referralLink: string;
  stats: { total: number; open: number; signed: number };
  kpis: ReferralKpis;
  remuneration: RemunerationConfig;
  earnings: { earnedEur: number; pipelineEur: number; totalIndicatifEur: number };
  payoutPerSignature: number;
  portalUnlocked: boolean;
};

const STATUS_COLORS: Record<ReferralStatus, string> = {
  NOUVEAU: "bg-slate-100 text-slate-700",
  CONTACTE: "bg-blue-50 text-blue-800",
  DOSSIER_OUVERT: "bg-indigo-50 text-indigo-800",
  ETUDE_ENVOYEE: "bg-violet-50 text-violet-800",
  SIGNE: "bg-emerald-50 text-emerald-800",
  REFUSE: "bg-red-50 text-red-800",
  PERDU: "bg-amber-50 text-amber-800",
};

export default function ApporteurPortalPage({ token }: { token: string }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ prenom: "", nom: "", email: "", phone: "", notes: "" });
  const [simDossiers, setSimDossiers] = useState(5);
  const [simConversion, setSimConversion] = useState(28);
  const [simSavings, setSimSavings] = useState(3600);
  const [simAssured, setSimAssured] = useState(1.5);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(getApiUrl(`/api/apporteur-portal/${encodeURIComponent(token)}`));
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Lien invalide ou expiré.");
      setData(json);
      if (json.kpis?.conversionRate != null) {
        setSimConversion(Math.round(json.kpis.conversionRate * 100));
      } else if (json.remuneration?.defaultConversionRate) {
        setSimConversion(Math.round(json.remuneration.defaultConversionRate * 100));
      }
      if (json.remuneration?.defaultAnnualSavingsEur) {
        setSimSavings(json.remuneration.defaultAnnualSavingsEur);
      }
      if (json.remuneration?.defaultAssuredPerDossier) {
        setSimAssured(json.remuneration.defaultAssuredPerDossier);
      }
    } catch (e: any) {
      setError(e?.message || "Impossible de charger l'espace apporteur.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const simulation = useMemo(() => {
    if (!data) return null;
    const payout = computeApporteurPayoutEur({
      annualSavingsEur: simSavings,
      assuredCount: simAssured,
      config: data.remuneration,
    });
    return estimatePartnerEarnings({
      dossiersPerMonth: simDossiers,
      conversionRate: simConversion / 100,
      payoutPerSignatureEur: payout,
    });
  }, [data, simDossiers, simConversion, simSavings, simAssured]);

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setSubmitMsg("Lien copié !");
      setTimeout(() => setSubmitMsg(null), 2000);
    } catch {
      /* ignore */
    }
  };

  const submitReferral = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const res = await fetch(getApiUrl(`/api/apporteur-portal/${encodeURIComponent(token)}/referrals`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact: form }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Enregistrement impossible");
      setForm({ prenom: "", nom: "", email: "", phone: "", notes: "" });
      setShowForm(false);
      setSubmitMsg("Recommandation enregistrée — notre équipe va prendre contact.");
      await load();
    } catch (err: any) {
      setSubmitMsg(err?.message || "Erreur");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[#f4f6fb]">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[#f4f6fb] p-6">
        <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 p-10 text-center shadow-sm">
          <p className="text-slate-600">{error || "Espace indisponible."}</p>
          <p className="text-slate-400 text-sm mt-4">Contactez Le Club Immobilier Français si le problème persiste.</p>
        </div>
      </div>
    );
  }

  const typeLabel =
    APPORTEUR_TYPE_LABELS[data.apporteur.type as keyof typeof APPORTEUR_TYPE_LABELS] || data.apporteur.type;
  const unlocked = data.portalUnlocked ?? data.apporteur.contractSigned ?? false;

  return (
    <div className="min-h-[100dvh] bg-[#f4f6fb]">
      <LcifPartnerHeader
        partnerName={data.apporteur.companyName}
        partnerContact={data.apporteur.contactName}
        partnerTypeLabel={typeLabel}
        contractStatus={data.apporteur.contractStatus}
      />

      <main className="max-w-3xl mx-auto px-5 py-8 space-y-6">
        <PartnerContractWorkflow contractStatus={data.apporteur.contractStatus || "none"} />

        <section>
          <h2 className="text-xs font-black uppercase tracking-wide text-slate-400 mb-3">Votre activité</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard label="Recommandations" value={data.kpis.total} accent="indigo" />
            <KpiCard label="En cours" value={data.kpis.open} accent="amber" sub={`${data.kpis.thisMonth} ce mois`} />
            <KpiCard label="Signées" value={data.kpis.signed} accent="emerald" />
            <KpiCard
              label="Taux de conversion"
              value={formatPercent(data.kpis.conversionRate)}
              accent="violet"
              sub="sur dossiers clos"
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            <KpiCard label="Nouveaux" value={data.kpis.nouveau} />
            <KpiCard label="Contactés" value={data.kpis.contacte} />
            <KpiCard label="Dossiers ouverts" value={data.kpis.dossierOuvert} />
            <KpiCard label="Études envoyées" value={data.kpis.etudeEnvoyee} accent="violet" />
          </div>
        </section>

        <section className="bg-gradient-to-br from-[#1E3A8A] to-indigo-800 rounded-2xl p-5 text-white shadow-lg">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-5 h-5 text-amber-300" />
            <h2 className="text-sm font-black uppercase tracking-wide">Rémunération indicative</h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-4 mb-4">
            <div>
              <div className="text-2xl font-black text-emerald-300">{data.earnings.earnedEur} €</div>
              <div className="text-xs text-indigo-200 mt-1">Acquis (signés)</div>
            </div>
            <div>
              <div className="text-2xl font-black text-amber-200">{data.earnings.pipelineEur} €</div>
              <div className="text-xs text-indigo-200 mt-1">Pipeline estimé</div>
            </div>
            <div>
              <div className="text-2xl font-black">{data.earnings.totalIndicatifEur} €</div>
              <div className="text-xs text-indigo-200 mt-1">Total indicatif</div>
            </div>
          </div>
          <p className="text-[11px] text-indigo-200 leading-relaxed">{data.remuneration.disclaimer}</p>
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 mb-1 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> Simulateur de gains
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            Estimez votre rémunération mensuelle selon le volume de dossiers que vous souhaitez envoyer.
          </p>
          <label className="block text-xs font-bold text-slate-600 mb-2">
            Dossiers envoyés par mois : <span className="text-indigo-700">{simDossiers}</span>
            <input
              type="range"
              min={1}
              max={20}
              value={simDossiers}
              onChange={(e) => setSimDossiers(Number(e.target.value))}
              className="w-full mt-2 accent-indigo-600"
            />
          </label>
          <label className="block text-xs font-bold text-slate-600 mb-4">
            Taux de conversion estimé : <span className="text-indigo-700">{simConversion} %</span>
            <input
              type="range"
              min={8}
              max={55}
              value={simConversion}
              onChange={(e) => setSimConversion(Number(e.target.value))}
              className="w-full mt-2 accent-indigo-600"
            />
          </label>
          <label className="block text-xs font-bold text-slate-600 mb-4">
            Économies annuelles moyennes / assuré : <span className="text-indigo-700">{simSavings} €</span>
            <input
              type="range"
              min={1500}
              max={8000}
              step={100}
              value={simSavings}
              onChange={(e) => setSimSavings(Number(e.target.value))}
              className="w-full mt-2 accent-indigo-600"
            />
          </label>
          <label className="block text-xs font-bold text-slate-600 mb-4">
            Assurés par dossier (moy.) : <span className="text-indigo-700">{simAssured}</span>
            <input
              type="range"
              min={1}
              max={2}
              step={0.5}
              value={simAssured}
              onChange={(e) => setSimAssured(Number(e.target.value))}
              className="w-full mt-2 accent-indigo-600"
            />
          </label>
          {simulation ? (
            <div className="grid grid-cols-3 gap-3 bg-slate-50 rounded-xl p-4 border border-slate-100">
              <div className="text-center">
                <div className="text-lg font-black text-slate-600">{simulation.conservativeMonthlyEur} €</div>
                <div className="text-[10px] font-bold text-slate-400 uppercase">Prudent</div>
              </div>
              <div className="text-center border-x border-slate-200">
                <div className="text-xl font-black text-indigo-700">{simulation.expectedMonthlyEur} €</div>
                <div className="text-[10px] font-bold text-indigo-500 uppercase">Estimation</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-black text-emerald-600">{simulation.optimisticMonthlyEur} €</div>
                <div className="text-[10px] font-bold text-slate-400 uppercase">Optimiste</div>
              </div>
            </div>
          ) : null}
          <p className="text-[10px] text-slate-400 mt-3">
            Barème : 10 % des économies (200–500 € / assuré) · 50 % pour vous ≈{" "}
            {simulation?.payoutPerSignatureEur ?? computeApporteurPayoutEur({
              annualSavingsEur: simSavings,
              assuredCount: simAssured,
              config: data.remuneration,
            })}{" "}
            € / dossier signé (simulation)
          </p>
        </section>

        {unlocked ? (
        <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 mb-3">Lien client</h2>
          <p className="text-sm text-slate-600 mb-3">
            Partagez ce lien pour que vos clients déposent leur dossier avec votre attribution automatique.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <code className="text-xs bg-slate-50 border rounded-lg px-3 py-2 flex-1 min-w-0 break-all">
              {data.referralLink}
            </code>
            <button
              type="button"
              onClick={() => copyText(data.referralLink)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1E3A8A] text-white text-xs font-bold hover:bg-indigo-900"
            >
              <Copy className="w-3.5 h-3.5" /> Copier
            </button>
          </div>
        </section>
        ) : null}

        <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex justify-between items-center gap-3 mb-4">
            <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 flex items-center gap-2">
              <Users className="w-4 h-4" /> Vos recommandations
            </h2>
            {unlocked ? (
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-indigo-200 text-indigo-700 text-xs font-bold hover:bg-indigo-50"
            >
              <Plus className="w-3.5 h-3.5" /> Nouvelle reco
            </button>
            ) : null}
          </div>

          {submitMsg ? (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 mb-4">
              {submitMsg}
            </p>
          ) : null}

          {showForm && unlocked ? (
            <form onSubmit={submitReferral} className="border border-slate-100 rounded-xl p-4 mb-4 bg-slate-50/50 space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Prénom" value={form.prenom} onChange={(v) => setForm((s) => ({ ...s, prenom: v }))} />
                <Field label="Nom" value={form.nom} onChange={(v) => setForm((s) => ({ ...s, nom: v }))} />
              </div>
              <Field label="Email" value={form.email} onChange={(v) => setForm((s) => ({ ...s, email: v }))} type="email" />
              <Field label="Téléphone" value={form.phone} onChange={(v) => setForm((s) => ({ ...s, phone: v }))} />
              <label className="block text-xs font-bold text-slate-600">
                Contexte (optionnel)
                <textarea
                  className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal min-h-[72px]"
                  value={form.notes}
                  onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
                />
              </label>
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 rounded-lg bg-[#1E3A8A] text-white font-bold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Envoyer la recommandation
              </button>
            </form>
          ) : null}

          <div className="space-y-3">
            {data.referrals.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center">Aucune recommandation pour le moment.</p>
            ) : (
              data.referrals.map((r) => {
                const name = [r.contact.prenom, r.contact.nom].filter(Boolean).join(" ") || "Contact";
                return (
                  <div key={r.id} className="border border-slate-100 rounded-xl p-4">
                    <div className="flex flex-wrap justify-between gap-2 mb-1">
                      <div className="font-bold text-slate-900">{name}</div>
                      <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${STATUS_COLORS[r.status]}`}>
                        {REFERRAL_STATUS_LABELS[r.status]}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {r.contact.email || "—"}
                      {r.contact.phone ? ` · ${r.contact.phone}` : ""}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-2">
                      Mis à jour le {new Date(r.updatedAt).toLocaleDateString("fr-FR")}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <LcifPartnerFooter />
      </main>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block text-xs font-bold text-slate-600">
      {label}
      <input
        type={type}
        className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
