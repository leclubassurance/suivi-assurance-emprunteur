import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Loader2, Plus, Send, Users } from "lucide-react";
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
import PartnerGuideSection from "./PartnerGuideSection";
import PartnerReferralTracking from "./PartnerReferralTracking";
import PartnerHeroSection from "./PartnerHeroSection";
import PartnerBenefitCards from "./PartnerBenefitCards";
import PartnerClientScript from "./PartnerClientScript";
import PartnerJourneyTimeline from "./PartnerJourneyTimeline";
import PartnerEarningsPanel from "./PartnerEarningsPanel";

type PortalReferralTracking = {
  dossierId: string;
  clientPortalUrl: string;
  statusLabel: string;
  statusDetail?: string;
  steps: { key: string; label: string; done: boolean; active: boolean }[];
};

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
  tracking: PortalReferralTracking | null;
};

type PortalData = {
  apporteur: {
    companyName: string;
    contactName: string;
    type: string;
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
  const [showKpiDetail, setShowKpiDetail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ prenom: "", nom: "", email: "", phone: "", notes: "" });
  const [simDossiers, setSimDossiers] = useState(5);
  const [simConversion, setSimConversion] = useState(28);
  const [simSavings, setSimSavings] = useState(3600);
  const [simAssured, setSimAssured] = useState(1.5);
  const referralsRef = useRef<HTMLElement>(null);

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

  const payoutPerSignature = useMemo(() => {
    if (!data) return 0;
    return computeApporteurPayoutEur({
      annualSavingsEur: simSavings,
      assuredCount: simAssured,
      config: data.remuneration,
    });
  }, [data, simSavings, simAssured]);

  const simulation = useMemo(() => {
    if (!data) return null;
    return estimatePartnerEarnings({
      dossiersPerMonth: simDossiers,
      conversionRate: simConversion / 100,
      payoutPerSignatureEur: payoutPerSignature,
    });
  }, [data, simDossiers, simConversion, payoutPerSignature]);

  const copyText = async (text: string, label = "Copié !") => {
    try {
      await navigator.clipboard.writeText(text);
      setSubmitMsg(label);
      setTimeout(() => setSubmitMsg(null), 2500);
    } catch {
      /* ignore */
    }
  };

  const openNewReferral = () => {
    setShowForm(true);
    setTimeout(() => {
      referralsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
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
  const unlocked = data.portalUnlocked !== false;

  return (
    <div className="min-h-[100dvh] bg-[#f4f6fb]">
      <LcifPartnerHeader
        partnerName={data.apporteur.companyName}
        partnerContact={data.apporteur.contactName}
        partnerTypeLabel={typeLabel}
      />

      <main className="max-w-3xl mx-auto px-5 py-8 space-y-6">
        {submitMsg ? (
          <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-2.5 text-center font-medium">
            {submitMsg}
          </p>
        ) : null}

        <PartnerHeroSection
          apporteurType={data.apporteur.type}
          referralLink={data.referralLink}
          unlocked={unlocked}
          onCopyLink={() => copyText(data.referralLink, "Lien client copié !")}
          onNewReferral={openNewReferral}
        />

        <PartnerBenefitCards payoutPerSignatureEur={payoutPerSignature} />

        <PartnerClientScript onCopy={copyText} />

        <PartnerJourneyTimeline />

        <PartnerEarningsPanel
          earnings={data.earnings}
          remuneration={data.remuneration}
          simDossiers={simDossiers}
          simConversion={simConversion}
          simSavings={simSavings}
          simAssured={simAssured}
          simulation={simulation}
          payoutPerSignatureEur={payoutPerSignature}
          onSimDossiers={setSimDossiers}
          onSimConversion={setSimConversion}
          onSimSavings={setSimSavings}
          onSimAssured={setSimAssured}
        />

        <section>
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-xs font-black uppercase tracking-wide text-slate-400">Votre activité</h2>
            <button
              type="button"
              onClick={() => setShowKpiDetail((v) => !v)}
              className="text-[10px] font-bold text-indigo-600 inline-flex items-center gap-1 hover:underline"
            >
              {showKpiDetail ? "Réduire" : "Voir le détail"}
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showKpiDetail ? "rotate-180" : ""}`} />
            </button>
          </div>
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
          {showKpiDetail ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
              <KpiCard label="Nouveaux" value={data.kpis.nouveau} />
              <KpiCard label="Contactés" value={data.kpis.contacte} />
              <KpiCard label="Dossiers ouverts" value={data.kpis.dossierOuvert} />
              <KpiCard label="Études envoyées" value={data.kpis.etudeEnvoyee} accent="violet" />
            </div>
          ) : null}
        </section>

        <section ref={referralsRef} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
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
              <p className="text-sm text-slate-500 py-6 text-center">
                Aucune recommandation pour le moment.
                {unlocked ? " Copiez votre lien ou créez une première reco." : ""}
              </p>
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
                    {r.tracking ? <PartnerReferralTracking tracking={r.tracking} /> : null}
                  </div>
                );
              })
            )}
          </div>
        </section>

        <PartnerGuideSection />

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
