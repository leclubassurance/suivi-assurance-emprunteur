import React, { useCallback, useEffect, useState } from "react";
import { Copy, Loader2, Plus, Users, UserPlus } from "lucide-react";
import { getApiUrl } from "../../lib/utils";
import type { ReferralStatus } from "../../../shared/networkTypes";
import { REFERRAL_STATUS_LABELS } from "../../../shared/networkTypes";
import type { NetworkMemberKpis } from "../../../shared/networkKpis";
import type { NetworkRemunerationConfig } from "../../../shared/networkRemuneration";
import LcifPartnerHeader, { LcifPartnerFooter } from "./LcifPartnerHeader";
import KpiCard, { formatPercent } from "./PartnerKpiGrid";
import PartnerReferralTracking from "./PartnerReferralTracking";

type PortalReferral = {
  id: string;
  status: ReferralStatus;
  contact: { prenom?: string; nom?: string; email?: string; phone?: string };
  createdAt: string;
  updatedAt: string;
  tracking: {
    dossierId: string;
    clientPortalUrl: string;
    statusLabel: string;
    statusDetail?: string;
    steps: { key: string; label: string; done: boolean; active: boolean }[];
  } | null;
};

type PortalData = {
  member: { contactName: string; email: string; sponsorName: string | null };
  downline: { id: string; contactName: string; createdAt: string; active: boolean }[];
  referrals: PortalReferral[];
  referralLink: string;
  joinLink: string;
  kpis: NetworkMemberKpis;
  remuneration: NetworkRemunerationConfig;
  earnings: {
    personalEarnedEur: number;
    teamEarnedEur: number;
    earnedEur: number;
    pipelineEur: number;
    totalIndicatifEur: number;
  };
  payoutPerDirect: number;
  payoutPerOverride: number;
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

export default function NetworkPortalPage({ token }: { token: string }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ prenom: "", nom: "", email: "", phone: "", notes: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(getApiUrl(`/api/network-portal/${encodeURIComponent(token)}`));
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Lien invalide ou expiré.");
      setData(json);
    } catch (e: any) {
      setError(e?.message || "Impossible de charger l'espace réseau.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const copyText = async (text: string, label = "Copié !") => {
    try {
      await navigator.clipboard.writeText(text);
      setSubmitMsg(label);
      setTimeout(() => setSubmitMsg(null), 2500);
    } catch {
      /* ignore */
    }
  };

  const submitReferral = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const res = await fetch(getApiUrl(`/api/network-portal/${encodeURIComponent(token)}/referrals`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact: form }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || json.error || "Enregistrement impossible");
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
        </div>
      </div>
    );
  }

  const unlocked = data.portalUnlocked !== false;

  return (
    <div className="min-h-[100dvh] bg-[#f4f6fb]">
      <LcifPartnerHeader
        partnerName={data.member.contactName}
        partnerContact={data.member.contactName}
        partnerTypeLabel="Réseau LCIF"
      />

      <main className="max-w-3xl mx-auto px-5 py-8 space-y-6">
        {submitMsg ? (
          <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-2.5 text-center font-medium">
            {submitMsg}
          </p>
        ) : null}

        <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <h1 className="text-xl font-black text-slate-900 mb-1">Bonjour {data.member.contactName.split(" ")[0]}</h1>
          {data.member.sponsorName ? (
            <p className="text-sm text-slate-500 mb-4">Parrainé par {data.member.sponsorName}</p>
          ) : (
            <p className="text-sm text-slate-500 mb-4">Membre du réseau Le Club Immobilier Français</p>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <button
              type="button"
              disabled={!unlocked}
              onClick={() => copyText(data.referralLink, "Lien client copié !")}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 text-white font-bold text-sm disabled:opacity-50"
            >
              <Copy className="w-4 h-4" /> Lien client
            </button>
            <button
              type="button"
              disabled={!unlocked}
              onClick={() => copyText(data.joinLink, "Lien recrutement copié !")}
              className="flex items-center justify-center gap-2 py-3 rounded-xl border border-indigo-200 text-indigo-700 font-bold text-sm disabled:opacity-50"
            >
              <UserPlus className="w-4 h-4" /> Lien recrutement
            </button>
          </div>
          {!unlocked ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-3">
              Portail disponible après signature du contrat réseau par LCIF.
            </p>
          ) : null}
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-xs font-black uppercase tracking-wide text-slate-400 mb-3">Rémunération indicative</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4">
              <p className="text-emerald-800 font-bold text-lg">{data.earnings.personalEarnedEur} €</p>
              <p className="text-emerald-700/80 text-xs">Vos dossiers signés ({data.payoutPerDirect} € / signature)</p>
            </div>
            <div className="rounded-xl bg-violet-50 border border-violet-100 p-4">
              <p className="text-violet-800 font-bold text-lg">{data.earnings.teamEarnedEur} €</p>
              <p className="text-violet-700/80 text-xs">
                Override équipe ({data.payoutPerOverride} € / signature filleul)
              </p>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 mt-3">{data.remuneration.disclaimer}</p>
        </section>

        <section>
          <h2 className="text-xs font-black uppercase tracking-wide text-slate-400 mb-3">Votre activité</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard label="Recommandations" value={data.kpis.total} accent="indigo" />
            <KpiCard label="En cours" value={data.kpis.open} accent="amber" />
            <KpiCard label="Signées" value={data.kpis.signed} accent="emerald" />
            <KpiCard label="Conversion" value={formatPercent(data.kpis.conversionRate)} accent="violet" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
            <KpiCard label="Filleuls directs" value={data.kpis.downlineCount} accent="indigo" />
            <KpiCard label="Reco équipe" value={data.kpis.teamReferrals} />
            <KpiCard label="Signées équipe" value={data.kpis.teamSigned} accent="emerald" />
          </div>
        </section>

        {data.downline.length > 0 ? (
          <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 flex items-center gap-2 mb-3">
              <Users className="w-4 h-4" /> Votre équipe (niveau 1)
            </h2>
            <ul className="space-y-2">
              {data.downline.map((d) => (
                <li key={d.id} className="flex justify-between text-sm border-b border-slate-50 pb-2">
                  <span className="font-medium text-slate-800">{d.contactName}</span>
                  <span className="text-slate-400 text-xs">{new Date(d.createdAt).toLocaleDateString("fr-FR")}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex justify-between items-center gap-3 mb-4">
            <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">Vos recommandations</h2>
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

          {showForm && unlocked ? (
            <form onSubmit={submitReferral} className="border border-slate-100 rounded-xl p-4 mb-4 bg-slate-50/50 space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Prénom" value={form.prenom} onChange={(v) => setForm((s) => ({ ...s, prenom: v }))} />
                <Field label="Nom" value={form.nom} onChange={(v) => setForm((s) => ({ ...s, nom: v }))} />
              </div>
              <Field label="Email" value={form.email} onChange={(v) => setForm((s) => ({ ...s, email: v }))} />
              <Field label="Téléphone" value={form.phone} onChange={(v) => setForm((s) => ({ ...s, phone: v }))} />
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm disabled:opacity-50"
              >
                {submitting ? "Envoi…" : "Enregistrer la recommandation"}
              </button>
            </form>
          ) : null}

          <div className="space-y-3">
            {data.referrals.map((r) => (
              <div key={r.id} className="border border-slate-100 rounded-xl p-4">
                <div className="flex flex-wrap justify-between gap-2 mb-2">
                  <p className="font-bold text-slate-800">
                    {[r.contact.prenom, r.contact.nom].filter(Boolean).join(" ") || "Contact"}
                  </p>
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status]}`}>
                    {REFERRAL_STATUS_LABELS[r.status]}
                  </span>
                </div>
                {r.tracking ? <PartnerReferralTracking tracking={r.tracking} /> : null}
              </div>
            ))}
            {!data.referrals.length ? (
              <p className="text-sm text-slate-400 text-center py-6">Aucune recommandation pour le moment.</p>
            ) : null}
          </div>
        </section>
      </main>

      <LcifPartnerFooter />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-xs font-bold text-slate-500">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-normal"
      />
    </label>
  );
}
