import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Loader2, Plus, Send, UserPlus, Users } from "lucide-react";
import { getApiUrl } from "../../lib/utils";
import type { ReferralStatus, PartnerRecruitStatus } from "../../../shared/apporteurTypes";
import {
  APPORTEUR_TYPE_LABELS,
  PARTNER_RECRUIT_STATUS_LABELS,
  REFERRAL_STATUS_LABELS,
} from "../../../shared/apporteurTypes";
import type { ApporteurTeamKpis } from "../../../shared/apporteurKpis";
import type { RemunerationConfig } from "../../../shared/apporteurRemuneration";
import { computeApporteurPayoutEur, estimatePartnerEarnings } from "../../../shared/apporteurRemuneration";
import { APPORTEUR_CONTRACT_MLM_CLAUSE } from "../../../shared/apporteurContractMlm";
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
    sponsorName?: string | null;
  };
  downline?: { id: string; contactName: string; companyName: string; createdAt: string; active: boolean }[];
  partnerRecruits?: {
    id: string;
    contactName: string;
    email: string;
    status: PartnerRecruitStatus;
    createdAt: string;
    createdApporteurId?: string;
  }[];
  referrals: PortalReferral[];
  referralLink: string;
  stats: { total: number; open: number; signed: number };
  kpis: ApporteurTeamKpis;
  remuneration: RemunerationConfig;
  earnings: {
    earnedEur: number;
    pipelineEur: number;
    totalIndicatifEur: number;
    personalEarnedEur?: number;
    teamEarnedEur?: number;
    payoutPerDirect?: number;
    payoutPerOverride?: number;
  };
  payoutPerSignature: number;
  contractMlmClause?: typeof APPORTEUR_CONTRACT_MLM_CLAUSE;
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
  const [showPartnerForm, setShowPartnerForm] = useState(false);
  const [partnerForm, setPartnerForm] = useState({ contactName: "", email: "", phone: "", companyName: "", notes: "" });
  const [showMlmClause, setShowMlmClause] = useState(false);
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

  const submitPartnerRecruit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const res = await fetch(getApiUrl(`/api/apporteur-portal/${encodeURIComponent(token)}/partner-recruits`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partnerForm),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || json.error || "Envoi impossible");
      setPartnerForm({ contactName: "", email: "", phone: "", companyName: "", notes: "" });
      setShowPartnerForm(false);
      setSubmitMsg("Candidature partenaire transmise — LCIF va contacter votre filleul.");
      await load();
    } catch (err: any) {
      setSubmitMsg(err?.message || "Erreur");
    } finally {
      setSubmitting(false);
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

        <PartnerClientScript
          referralLink={data.referralLink}
          partnerContactName={data.apporteur.contactName}
          onCopy={copyText}
        />

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

        {(data.earnings.personalEarnedEur != null || data.earnings.teamEarnedEur != null) ? (
          <div className="grid sm:grid-cols-2 gap-3 -mt-2">
            <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm">
              <p className="text-emerald-700 font-black text-lg">{data.earnings.personalEarnedEur ?? 0} €</p>
              <p className="text-slate-500 text-xs">Vos dossiers signés ({data.earnings.payoutPerDirect ?? payoutPerSignature} € / signature)</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm">
              <p className="text-violet-700 font-black text-lg">{data.earnings.teamEarnedEur ?? 0} €</p>
              <p className="text-slate-500 text-xs">Override filleuls ({data.earnings.payoutPerOverride ?? 0} € / signature)</p>
            </div>
          </div>
        ) : null}

        <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex flex-wrap justify-between items-center gap-3 mb-3">
            <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 flex items-center gap-2">
              <UserPlus className="w-4 h-4" /> Recommander un futur partenaire
            </h2>
            {unlocked ? (
              <button
                type="button"
                onClick={() => setShowPartnerForm((v) => !v)}
                className="text-xs font-bold text-indigo-700 hover:underline"
              >
                {showPartnerForm ? "Annuler" : "Ouvrir le formulaire"}
              </button>
            ) : null}
          </div>
          <p className="text-xs text-slate-500 mb-3">
            Recommandez une personne de confiance. LCIF valide la candidature, envoie le contrat et la rattache
            automatiquement à vous une fois signé.
          </p>
          {showPartnerForm && unlocked ? (
            <form onSubmit={submitPartnerRecruit} className="space-y-3 border border-slate-100 rounded-xl p-4 bg-slate-50/50">
              <Field label="Nom complet" value={partnerForm.contactName} onChange={(v) => setPartnerForm((s) => ({ ...s, contactName: v }))} />
              <Field label="Email" value={partnerForm.email} onChange={(v) => setPartnerForm((s) => ({ ...s, email: v }))} type="email" />
              <Field label="Téléphone" value={partnerForm.phone} onChange={(v) => setPartnerForm((s) => ({ ...s, phone: v }))} />
              <Field label="Société (optionnel)" value={partnerForm.companyName} onChange={(v) => setPartnerForm((s) => ({ ...s, companyName: v }))} />
              <button type="submit" disabled={submitting} className="w-full py-2.5 rounded-lg bg-slate-900 text-white font-bold text-sm disabled:opacity-60">
                Envoyer la candidature à LCIF
              </button>
            </form>
          ) : null}
          {(data.partnerRecruits?.length ?? 0) > 0 ? (
            <ul className="mt-4 space-y-2">
              {data.partnerRecruits!.map((r) => (
                <li key={r.id} className="flex flex-wrap justify-between gap-2 text-sm border-t border-slate-100 pt-2">
                  <span className="font-medium text-slate-800">{r.contactName}</span>
                  <span className="text-[10px] font-bold uppercase text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full">
                    {PARTNER_RECRUIT_STATUS_LABELS[r.status]}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {(data.downline?.length ?? 0) > 0 ? (
          <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 flex items-center gap-2 mb-3">
              <Users className="w-4 h-4" /> Vos filleuls (niveau 1)
            </h2>
            <ul className="space-y-2">
              {data.downline!.map((d) => (
                <li key={d.id} className="flex justify-between text-sm border-b border-slate-50 pb-2">
                  <span className="font-medium text-slate-800">{d.contactName}</span>
                  <span className="text-slate-400 text-xs">{new Date(d.createdAt).toLocaleDateString("fr-FR")}</span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-slate-400 mt-3">
              Recos équipe : {data.kpis.teamReferrals} · Signées : {data.kpis.teamSigned}
            </p>
          </section>
        ) : null}

        <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <button
            type="button"
            onClick={() => setShowMlmClause((v) => !v)}
            className="w-full flex justify-between items-center text-sm font-black uppercase tracking-wide text-slate-500"
          >
            Clause réseau (contrat)
            <ChevronDown className={`w-4 h-4 transition-transform ${showMlmClause ? "rotate-180" : ""}`} />
          </button>
          {showMlmClause ? (
            <div className="mt-3 text-xs text-slate-600 space-y-3 leading-relaxed">
              <p className="font-medium">{data.contractMlmClause?.summary || APPORTEUR_CONTRACT_MLM_CLAUSE.summary}</p>
              {(data.contractMlmClause?.articles || APPORTEUR_CONTRACT_MLM_CLAUSE.articles).map((a) => (
                <div key={a.heading}>
                  <p className="font-bold text-slate-800">{a.heading}</p>
                  <p>{a.body}</p>
                </div>
              ))}
            </div>
          ) : null}
        </section>

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
          {(data.kpis.downlineCount ?? 0) > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
              <KpiCard label="Filleuls" value={data.kpis.downlineCount} accent="indigo" />
              <KpiCard label="Reco équipe" value={data.kpis.teamReferrals} />
              <KpiCard label="Signées équipe" value={data.kpis.teamSigned} accent="emerald" />
            </div>
          ) : null}
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
