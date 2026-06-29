import React, { useCallback, useEffect, useState } from "react";
import { Building2, CheckCircle2, Copy, Loader2, Plus, Send, Users } from "lucide-react";
import { getApiUrl } from "../../lib/utils";
import type { ReferralStatus } from "../../../shared/apporteurTypes";
import {
  APPORTEUR_TYPE_LABELS,
  REFERRAL_STATUS_LABELS,
} from "../../../shared/apporteurTypes";

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
  apporteur: { companyName: string; contactName: string; type: string };
  referrals: PortalReferral[];
  referralLink: string;
  stats: { total: number; open: number; signed: number };
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(getApiUrl(`/api/apporteur-portal/${encodeURIComponent(token)}`));
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Lien invalide ou expiré.");
      setData(json);
    } catch (e: any) {
      setError(e?.message || "Impossible de charger l'espace apporteur.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

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

  return (
    <div className="min-h-[100dvh] bg-[#f4f6fb]">
      <header className="bg-[#1E3A8A] text-white">
        <div className="max-w-3xl mx-auto px-5 py-8">
          <p className="text-indigo-200 text-xs font-bold uppercase tracking-widest mb-2">Espace partenaire</p>
          <h1 className="text-2xl font-black flex items-center gap-2">
            <Building2 className="w-7 h-7" />
            {data.apporteur.companyName}
          </h1>
          <p className="text-indigo-100 text-sm mt-2">
            Bonjour {data.apporteur.contactName} — {APPORTEUR_TYPE_LABELS[data.apporteur.type as keyof typeof APPORTEUR_TYPE_LABELS] || data.apporteur.type}
          </p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-8 space-y-6">
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Recommandations" value={data.stats.total} />
          <StatCard label="En cours" value={data.stats.open} />
          <StatCard label="Signées" value={data.stats.signed} accent />
        </div>

        <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 mb-3">Lien client</h2>
          <p className="text-sm text-slate-600 mb-3">
            Partagez ce lien pour que vos clients déposent directement leur dossier avec votre attribution.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <code className="text-xs bg-slate-50 border rounded-lg px-3 py-2 flex-1 min-w-0 break-all">
              {data.referralLink}
            </code>
            <button
              type="button"
              onClick={() => copyText(data.referralLink)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700"
            >
              <Copy className="w-3.5 h-3.5" /> Copier
            </button>
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex justify-between items-center gap-3 mb-4">
            <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 flex items-center gap-2">
              <Users className="w-4 h-4" /> Vos recommandations
            </h2>
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-indigo-200 text-indigo-700 text-xs font-bold hover:bg-indigo-50"
            >
              <Plus className="w-3.5 h-3.5" /> Nouvelle reco
            </button>
          </div>

          {submitMsg ? (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 mb-4">
              {submitMsg}
            </p>
          ) : null}

          {showForm ? (
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
                className="w-full py-2.5 rounded-lg bg-indigo-600 text-white font-bold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60"
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

        <p className="text-center text-xs text-slate-400 pb-8">
          Le Club Immobilier Français — ORIAS 24002253 · Vous recevez des emails à chaque avancement.
        </p>
      </main>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center shadow-sm">
      <div className={`text-2xl font-black ${accent ? "text-emerald-600" : "text-slate-900"}`}>
        {accent && value > 0 ? <CheckCircle2 className="w-6 h-6 inline mr-1 -mt-1" /> : null}
        {value}
      </div>
      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mt-1">{label}</div>
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
