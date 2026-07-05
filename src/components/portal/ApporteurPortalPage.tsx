import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Send, UserPlus, Users } from "lucide-react";
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
import LcifPartnerHeader, { LcifPartnerFooter } from "./LcifPartnerHeader";
import KpiCard from "./PartnerKpiGrid";
import PartnerGuideSection from "./PartnerGuideSection";
import PartnerReferralTracking from "./PartnerReferralTracking";
import PartnerHeroSection from "./PartnerHeroSection";
import PartnerBenefitCards from "./PartnerBenefitCards";
import PartnerClientScript from "./PartnerClientScript";
import PartnerJourneyTimeline from "./PartnerJourneyTimeline";
import PartnerEarningsPanel from "./PartnerEarningsPanel";
import PartnerContractSigning from "./PartnerContractSigning";
import SiretLookupField, { type SiretLookupResult } from "./SiretLookupField";
import { resolveCompanyNamesFromRegistryLookup } from "../../../shared/companyRegistryName";
import PartnerContractWorkflow from "./PartnerContractWorkflow";
import ConseillerPhaseBanner from "./ConseillerPhaseBanner";
import ConseillerSubscriptionForm from "./ConseillerSubscriptionForm";
import ConseillerReferralCommunications from "./ConseillerReferralCommunications";
import ConseillerStudyValidation, { type StudyValidationPending } from "./ConseillerStudyValidation";
import { CONSEILLER_IMMO_CLUB_TYPE } from "../../../shared/conseillerImmoClub";
import type { ConseillerOperatingPhase } from "../../../shared/conseillerImmoClub";
import type { ConseillerSubscriptionPackage } from "../../../shared/conseillerSubscription";

type PortalReferralTracking = {
  dossierId: string;
  clientPortalUrl: string;
  statusLabel: string;
  statusDetail?: string;
  plannedChangeDateLabel?: string;
  steps: { key: string; label: string; done: boolean; active: boolean }[];
  commission?: {
    feesCourtageEur: number;
    apporteurPayoutEur: number;
    source: "manual" | "auto" | "estimate";
    hasStudyFees: boolean;
    payoutSharePercent?: number;
  } | null;
  communications?: {
    direction: "inbound" | "outbound";
    date: string;
    subject?: string;
    excerpt: string;
  }[];
  conseillerSubscription?: ConseillerSubscriptionPackage | null;
  canSubmitSubscription?: boolean;
  operatingPhase?: ConseillerOperatingPhase;
  studyValidationPending?: StudyValidationPending | null;
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

type DownlineMember = {
  id: string;
  contactName: string;
  companyName: string;
  createdAt: string;
  active: boolean;
  contractStatus: string;
  activityLabel: "active" | "pending_contract" | "inactive";
  clientReferrals: number;
  openReferrals: number;
  signedReferrals: number;
  lastActivityAt: string;
};

type PortalData = {
  apporteur: {
    companyName: string;
    contactName: string;
    type: string;
    sponsorName?: string | null;
  };
  downline?: DownlineMember[];
  teamSummary?: {
    filleuls: number;
    clientReferrals: number;
    openReferrals: number;
    signedReferrals: number;
  };
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
  referralStats?: { linkClicks: number; uniqueSessions: number; lastClickAt?: string | null };
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
    earningsBasis?: "study" | "mixed" | "estimate";
    studyBasedSignedCount?: number;
  };
  payoutPerSignature: number;
  portalUnlocked: boolean;
  contract?: {
    status: string;
    signed: boolean;
    signedAt: string | null;
    needsSignature: boolean;
  };
  conseillerClub?: {
    operatingPhase: ConseillerOperatingPhase;
    signedCount: number;
    autonomyThreshold: number;
    payoutSharePercent: number;
  } | null;
};

const FILLEUL_STATUS: Record<
  DownlineMember["activityLabel"],
  { label: string; className: string; hint: string }
> = {
  active: {
    label: "Actif",
    className: "bg-emerald-50 text-emerald-800 border-emerald-100",
    hint: "Contrat signé — peut recommander des clients",
  },
  pending_contract: {
    label: "Contrat en cours",
    className: "bg-amber-50 text-amber-800 border-amber-100",
    hint: "Partenaire créé — finalisation contrat LCIF",
  },
  inactive: {
    label: "Inactif",
    className: "bg-slate-100 text-slate-600 border-slate-200",
    hint: "Compte désactivé par LCIF",
  },
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
  const [showPartnerForm, setShowPartnerForm] = useState(false);
  const [partnerForm, setPartnerForm] = useState({
    contactPrenom: "",
    contactNom: "",
    email: "",
    phone: "",
    companyName: "",
    companyLegalName: "",
    siret: "",
    siren: "",
    notes: "",
  });
  const [simDossiers, setSimDossiers] = useState(5);
  const [simConversion, setSimConversion] = useState(28);
  const [simSavings, setSimSavings] = useState(3600);
  const [simAssured, setSimAssured] = useState(1.5);
  const referralsRef = useRef<HTMLElement>(null);
  const highlightDossierId = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("etude");
  }, []);

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
      setPartnerForm({
        contactPrenom: "",
        contactNom: "",
        email: "",
        phone: "",
        companyName: "",
        companyLegalName: "",
        siret: "",
        siren: "",
        notes: "",
      });
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
  const isConseillerClub = data.apporteur.type === CONSEILLER_IMMO_CLUB_TYPE;
  const unlocked = data.portalUnlocked !== false && data.contract?.signed !== false;

  if (!unlocked) {
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
          <PartnerContractWorkflow contractStatus={data.contract?.status || "sent"} semiAutoPreview={false} />
          <PartnerContractSigning portalToken={token} onSigned={() => load()} />
          <p className="text-xs text-slate-500 text-center">
            Une question ?{" "}
            <a className="font-bold text-indigo-700 underline" href="mailto:assurance@leclubimmobilier.fr">
              assurance@leclubimmobilier.fr
            </a>
          </p>
          <LcifPartnerFooter />
        </main>
      </div>
    );
  }

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
          referralStats={data.referralStats}
          onCopyLink={() => copyText(data.referralLink, "Lien client copié !")}
          onNewReferral={openNewReferral}
        />

        {isConseillerClub && data.conseillerClub ? (
          <ConseillerPhaseBanner
            operatingPhase={data.conseillerClub.operatingPhase}
            signedCount={data.conseillerClub.signedCount}
            autonomyThreshold={data.conseillerClub.autonomyThreshold}
          />
        ) : null}

        {data.contract?.signed ? (
          <section className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-slate-600">
              Contrat signé
              {data.contract.signedAt
                ? ` le ${new Date(data.contract.signedAt).toLocaleDateString("fr-FR")}`
                : ""}
            </span>
            <a
              href={getApiUrl(`/api/apporteur-portal/${encodeURIComponent(token)}/contract/pdf`)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-bold text-indigo-700 hover:underline"
            >
              Télécharger le PDF
            </a>
          </section>
        ) : null}

        <PartnerBenefitCards
          payoutPerSignatureEur={payoutPerSignature}
          payoutSharePercent={data.conseillerClub?.payoutSharePercent ?? data.remuneration.apporteurShareOfBrokerage}
          isConseiller={isConseillerClub}
        />

        <PartnerClientScript
          referralLink={data.referralLink}
          partnerContactName={data.apporteur.contactName}
          onCopy={copyText}
        />

        <PartnerJourneyTimeline />

        {!isConseillerClub ? (
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
        ) : null}

        {!isConseillerClub && (data.earnings.personalEarnedEur != null || data.earnings.teamEarnedEur != null) ? (
          <div className="space-y-2 -mt-2">
            {data.earnings.earningsBasis && data.earnings.earningsBasis !== "estimate" ? (
              <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                {data.earnings.earningsBasis === "study"
                  ? "Montants basés sur les commissions réelles de vos dossiers signés."
                  : "Montants mixtes : étude réelle + estimation barème sur dossiers sans KPI."}
              </p>
            ) : (
              <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                Estimation barème — les montants se précisent dès que l&apos;étude est envoyée.
              </p>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm">
              <p className="text-emerald-700 font-black text-lg">{data.earnings.personalEarnedEur ?? 0} €</p>
              <p className="text-slate-500 text-xs">
                Vos dossiers signés
                {data.kpis.signed > 0
                  ? ` (≈ ${data.earnings.payoutPerDirect ?? payoutPerSignature} € / signature)`
                  : ""}
              </p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm">
              <p className="text-violet-700 font-black text-lg">{data.earnings.teamEarnedEur ?? 0} €</p>
              <p className="text-slate-500 text-xs">
                Override filleuls
                {(data.kpis.teamSigned ?? 0) > 0
                  ? ` (≈ ${data.earnings.payoutPerOverride ?? 0} € / signature)`
                  : ""}
              </p>
            </div>
            </div>
          </div>
        ) : null}

        {!isConseillerClub ? (
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
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Prénom" value={partnerForm.contactPrenom} onChange={(v) => setPartnerForm((s) => ({ ...s, contactPrenom: v }))} />
                <Field label="Nom de famille" value={partnerForm.contactNom} onChange={(v) => setPartnerForm((s) => ({ ...s, contactNom: v }))} />
              </div>
              <Field label="Email" value={partnerForm.email} onChange={(v) => setPartnerForm((s) => ({ ...s, email: v }))} type="email" />
              <Field label="Téléphone" value={partnerForm.phone} onChange={(v) => setPartnerForm((s) => ({ ...s, phone: v }))} />
              <Field
                label="Société (optionnel)"
                value={partnerForm.companyName}
                onChange={(v) => setPartnerForm((s) => ({ ...s, companyName: v }))}
              />
              {partnerForm.companyName.trim() || partnerForm.siret.trim() ? (
                <SiretLookupField
                  siret={partnerForm.siret}
                  onSiretChange={(v) => setPartnerForm((s) => ({ ...s, siret: v }))}
                  companyName={partnerForm.companyName}
                  onCompanyNameChange={(v) => setPartnerForm((s) => ({ ...s, companyName: v }))}
                  onVerified={(match: SiretLookupResult) => {
                    const resolved = resolveCompanyNamesFromRegistryLookup(match);
                    setPartnerForm((s) => ({
                      ...s,
                      siren: match.siren,
                      siret: match.siret || s.siret,
                      companyLegalName: resolved.companyLegalName,
                      companyName: s.companyName.trim() || resolved.suggestedCompanyName,
                    }));
                  }}
                  required={Boolean(partnerForm.companyName.trim())}
                />
              ) : null}
              <Field label="Notes (optionnel)" value={partnerForm.notes} onChange={(v) => setPartnerForm((s) => ({ ...s, notes: v }))} />
              <button type="submit" disabled={submitting} className="w-full py-2.5 rounded-lg bg-slate-900 text-white font-bold text-sm disabled:opacity-60">
                Envoyer la candidature à LCIF
              </button>
            </form>
          ) : null}
        </section>
        ) : null}

        {!isConseillerClub &&
        ((data.downline?.length ?? 0) > 0 || (data.partnerRecruits?.length ?? 0) > 0) ? (
          <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 flex items-center gap-2 mb-1">
              <Users className="w-4 h-4" /> Mon équipe (filleuls directs)
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Vos partenaires rattachés — vous touchez 10&nbsp;% du courtage sur leurs dossiers signés.
            </p>
            {data.teamSummary && data.teamSummary.filleuls > 0 ? (
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 text-center">
                  <p className="text-lg font-black text-indigo-700">{data.teamSummary.filleuls}</p>
                  <p className="text-[10px] font-bold text-slate-500 uppercase">Partenaires</p>
                </div>
                <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 text-center">
                  <p className="text-lg font-black text-amber-600">{data.teamSummary.openReferrals}</p>
                  <p className="text-[10px] font-bold text-slate-500 uppercase">Clients en cours</p>
                </div>
                <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 text-center">
                  <p className="text-lg font-black text-emerald-600">{data.teamSummary.signedReferrals}</p>
                  <p className="text-[10px] font-bold text-slate-500 uppercase">Signés équipe</p>
                </div>
              </div>
            ) : null}
            {(data.partnerRecruits?.length ?? 0) > 0 ? (
              <div className="mb-4">
                <p className="text-[11px] font-black uppercase text-slate-400 mb-2">Candidatures en attente LCIF</p>
                <ul className="space-y-2">
                  {data.partnerRecruits!.map((r) => (
                    <li key={r.id} className="flex justify-between items-center text-sm border border-dashed border-indigo-100 rounded-lg px-3 py-2 bg-indigo-50/30">
                      <span className="font-medium text-slate-800">{r.contactName}</span>
                      <span className="text-[10px] font-bold uppercase text-indigo-700">
                        {PARTNER_RECRUIT_STATUS_LABELS[r.status]}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {(data.downline?.length ?? 0) > 0 ? (
              <ul className="space-y-3">
                {data.downline!.map((d) => {
                  const status = FILLEUL_STATUS[d.activityLabel];
                  return (
                    <li key={d.id} className="border border-slate-100 rounded-xl p-4">
                      <div className="flex flex-wrap justify-between gap-2 mb-2">
                        <div>
                          <p className="font-bold text-slate-900">{d.contactName}</p>
                          {d.companyName !== d.contactName ? (
                            <p className="text-xs text-slate-500">{d.companyName}</p>
                          ) : null}
                        </div>
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${status.className}`}>
                          {status.label}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mb-2">{status.hint}</p>
                      <div className="flex flex-wrap gap-4 text-xs">
                        <span>
                          <strong className="text-slate-800">{d.clientReferrals}</strong> client{d.clientReferrals !== 1 ? "s" : ""} recommandé{d.clientReferrals !== 1 ? "s" : ""}
                        </span>
                        <span>
                          <strong className="text-amber-700">{d.openReferrals}</strong> en cours
                        </span>
                        <span>
                          <strong className="text-emerald-700">{d.signedReferrals}</strong> signé{d.signedReferrals !== 1 ? "s" : ""}
                        </span>
                      </div>
                      {d.clientReferrals === 0 ? (
                        <p className="text-[11px] text-slate-400 mt-2 italic">
                          Nouveau partenaire — pas encore de client. C&apos;est normal au démarrage.
                        </p>
                      ) : (
                        <p className="text-[11px] text-slate-400 mt-2">
                          Dernière activité : {new Date(d.lastActivityAt).toLocaleDateString("fr-FR")}
                        </p>
                      )}
                      <p className="text-[10px] text-slate-300 mt-1">
                        Membre depuis le {new Date(d.createdAt).toLocaleDateString("fr-FR")}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        ) : null}

        <section ref={referralsRef} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 mb-1">
            {isConseillerClub ? "Mes clients orientés" : "Mes clients recommandés"}
          </h2>
          <p className="text-xs text-slate-400 mb-4">
            {isConseillerClub
              ? "Clients que vous avez orientés vers LCIF — suivi et étapes de souscription."
              : "Personnes que vous avez orientées vers LCIF — suivi de vos propres recommandations."}
          </p>
          <div className="grid grid-cols-3 gap-3 mb-5">
            <KpiCard label="Total" value={data.kpis.total} accent="indigo" />
            <KpiCard label="En cours" value={data.kpis.open} accent="amber" sub="dossier ouvert ou étude" />
            <KpiCard label="Signés" value={data.kpis.signed} accent="emerald" sub="contrats aboutis" />
          </div>
          <div className="flex justify-end mb-4">
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
                    {r.tracking?.studyValidationPending ? (
                      <ConseillerStudyValidation
                        portalToken={token}
                        validation={r.tracking.studyValidationPending}
                        highlight={highlightDossierId === r.tracking.dossierId}
                        onApproved={load}
                      />
                    ) : null}
                    {r.tracking ? <PartnerReferralTracking tracking={r.tracking} /> : null}
                    {isConseillerClub && r.tracking?.communications?.length ? (
                      <ConseillerReferralCommunications communications={r.tracking.communications} />
                    ) : null}
                    {isConseillerClub &&
                    r.tracking &&
                    (r.tracking.canSubmitSubscription || r.tracking.conseillerSubscription?.submittedAt) ? (
                      <ConseillerSubscriptionForm
                        portalToken={token}
                        referralId={r.id}
                        existing={r.tracking.conseillerSubscription}
                        canSubmit={Boolean(r.tracking.canSubmitSubscription)}
                        onSubmitted={async () => {
                          setSubmitMsg("Formulaire transmis — LCIF va finaliser la souscription.");
                          await load();
                        }}
                      />
                    ) : null}
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
