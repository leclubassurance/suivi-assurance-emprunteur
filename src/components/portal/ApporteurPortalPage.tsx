import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Send, UserPlus, Users } from "lucide-react";
import { getApiUrl, apiFetch, clearConseillerSessionToken } from "../../lib/utils";
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
import ConseillerFormationSection from "./ConseillerFormationSection";
import { CONSEILLER_IMMO_CLUB_TYPE } from "../../../shared/conseillerImmoClub";
import type { ConseillerOperatingPhase } from "../../../shared/conseillerImmoClub";
import type { ConseillerSubscriptionPackage } from "../../../shared/conseillerSubscription";
import {
  PORTAL_NAV_ICONS,
  PortalMobileNav,
  PortalSidebarNav,
  type PortalNavItem,
} from "./layout/PortalNav";
import PortalSection from "./layout/PortalSection";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";

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
  conseillerRanking?: {
    me: ConseillerRankingRow | null;
    leaderboard: ConseillerRankingRow[];
  } | null;
};

type ConseillerRankingRow = {
  rank: number;
  apporteurId: string;
  contactName: string;
  companyName: string;
  recommandations: number;
};

function scrollToAnchor(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

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

export default function ApporteurPortalPage({
  token,
  conseillerSession = false,
}: {
  token: string;
  conseillerSession?: boolean;
}) {
  const [data, setData] = useState<PortalData | null>(null);
  const [ranking, setRanking] = useState<{
    me: ConseillerRankingRow | null;
    leaderboard: ConseillerRankingRow[];
  } | null>(null);
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
  const [activeAnchor, setActiveAnchor] = useState<string | null>(null);

  // IntersectionObserver for sticky nav — kept before early returns to respect rules of hooks.
  useEffect(() => {
    const ids = [
      "ap-hero", "ap-phase", "ap-formation", "ap-ranking", "ap-contract", "ap-benefits",
      "ap-script", "ap-journey", "ap-earnings", "ap-recruit", "ap-team", "ap-referrals", "ap-guide",
    ];
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => (b.intersectionRatio || 0) - (a.intersectionRatio || 0));
        if (visible[0]?.target?.id) setActiveAnchor(visible[0].target.id);
      },
      { root: null, threshold: [0.15, 0.3, 0.45, 0.6], rootMargin: "-88px 0px -60% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  });

  const highlightDossierId = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("etude");
  }, []);

  const adminPreviewToken = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("lcif_preview");
  }, []);

  const adminViewMode = Boolean(adminPreviewToken);

  const withPreviewQuery = useCallback(
    (path: string) => {
      if (!adminPreviewToken) return path;
      const sep = path.includes("?") ? "&" : "?";
      return `${path}${sep}lcif_preview=${encodeURIComponent(adminPreviewToken)}`;
    },
    [adminPreviewToken],
  );

  const fetchPortal = useCallback(
    (path: string, init?: RequestInit) => {
      const fullPath = withPreviewQuery(path);
      if (adminPreviewToken) return fetch(getApiUrl(fullPath), { ...init, credentials: "include" });
      if (conseillerSession) return apiFetch(fullPath, init);
      return fetch(getApiUrl(fullPath), { ...init, credentials: "include" });
    },
    [conseillerSession, adminPreviewToken, withPreviewQuery],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPortal(`/api/apporteur-portal/${encodeURIComponent(token)}`);
      const json = await res.json().catch(() => ({}));
      if (res.status === 401 && json.error === "session_required") {
        if (adminViewMode) {
          setError(
            "Lien de consultation admin invalide ou expiré. Regénérez un lien depuis l'administration (bouton « Consulter l'espace »).",
          );
          return;
        }
        clearConseillerSessionToken();
        window.location.href = "/conseiller";
        return;
      }
      if (!res.ok) throw new Error(json.error || "Lien invalide ou expiré.");
      setData(json);
      if (json?.apporteur?.type === CONSEILLER_IMMO_CLUB_TYPE) {
        setRanking(json?.conseillerRanking || null);
      } else setRanking(null);
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
  }, [token, fetchPortal, adminViewMode]);

  const handleConseillerLogout = async () => {
    try {
      await apiFetch("/api/conseiller-portal/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    clearConseillerSessionToken();
    window.location.href = "/conseiller";
  };

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
      const res = await fetchPortal(`/api/apporteur-portal/${encodeURIComponent(token)}/partner-recruits`, {
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
      const res = await fetchPortal(`/api/apporteur-portal/${encodeURIComponent(token)}/referrals`, {
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

  const navItems: PortalNavItem[] = [
    {
      id: "ap-hero",
      label: isConseillerClub ? "Mon espace" : "Tableau de bord",
      shortLabel: "Accueil",
      icon: PORTAL_NAV_ICONS.home,
      mobilePrimary: true,
    },
    {
      id: "ap-phase",
      label: "Phase LCIF",
      shortLabel: "Phase",
      icon: PORTAL_NAV_ICONS.phase,
      visible: Boolean(isConseillerClub && data.conseillerClub),
      mobilePrimary: Boolean(isConseillerClub && data.conseillerClub),
    },
    {
      id: "ap-formation",
      label: "Formation",
      shortLabel: "Formation",
      icon: PORTAL_NAV_ICONS.formation,
      visible: Boolean(isConseillerClub),
      mobilePrimary: Boolean(isConseillerClub),
    },
    {
      id: "ap-ranking",
      label: "Classement",
      shortLabel: "Classement",
      icon: PORTAL_NAV_ICONS.team,
      visible: Boolean(isConseillerClub),
      mobilePrimary: Boolean(isConseillerClub),
    },
    {
      id: "ap-contract",
      label: "Contrat",
      icon: PORTAL_NAV_ICONS.contract,
      visible: Boolean(data.contract?.signed),
    },
    { id: "ap-benefits", label: "Avantages", icon: PORTAL_NAV_ICONS.benefits },
    {
      id: "ap-script",
      label: isConseillerClub ? "Message client" : "Message type",
      shortLabel: "Message",
      icon: PORTAL_NAV_ICONS.script,
    },
    { id: "ap-journey", label: "Parcours client", icon: PORTAL_NAV_ICONS.journey },
    {
      id: "ap-earnings",
      label: "Gains & simulation",
      shortLabel: "Gains",
      icon: PORTAL_NAV_ICONS.earnings,
      visible: Boolean(!isConseillerClub),
      mobilePrimary: !isConseillerClub,
    },
    {
      id: "ap-recruit",
      label: "Recruter un partenaire",
      shortLabel: "Recruter",
      icon: PORTAL_NAV_ICONS.recruit,
      visible: Boolean(!isConseillerClub),
      mobilePrimary: !isConseillerClub,
    },
    {
      id: "ap-team",
      label: "Mon réseau",
      shortLabel: "Réseau",
      icon: PORTAL_NAV_ICONS.team,
      visible: Boolean(
        !isConseillerClub && (((data.downline?.length ?? 0) > 0) || ((data.partnerRecruits?.length ?? 0) > 0)),
      ),
    },
    {
      id: "ap-referrals",
      label: isConseillerClub ? "Mes dossiers clients" : "Mes clients",
      shortLabel: isConseillerClub ? "Dossiers" : "Clients",
      icon: PORTAL_NAV_ICONS.referrals,
      mobilePrimary: true,
    },
    { id: "ap-guide", label: "Aide & FAQ", icon: PORTAL_NAV_ICONS.guide },
  ];

  if (!unlocked) {
    return (
      <div className="min-h-[100dvh] bg-[var(--lcif-bg)]">
        <LcifPartnerHeader
          subtitle={adminViewMode ? "Consultation admin" : conseillerSession ? "Espace conseiller" : "Espace partenaire"}
          partnerName={data.apporteur.companyName}
          partnerContact={data.apporteur.contactName}
          partnerTypeLabel={typeLabel}
          onLogout={conseillerSession && !adminViewMode ? handleConseillerLogout : undefined}
        />
        <main className="max-w-3xl mx-auto px-4 sm:px-5 py-8 space-y-6">
          {submitMsg ? (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-2.5 text-center font-medium">
              {submitMsg}
            </p>
          ) : null}
          <PortalSection title="Signature du contrat partenaire" description="Débloquez votre espace après signature.">
            <PartnerContractWorkflow contractStatus={data.contract?.status || "sent"} semiAutoPreview={false} />
            <div className="mt-4">
              <PartnerContractSigning portalToken={token} sessionAuth={conseillerSession} previewToken={adminPreviewToken || undefined} onSigned={() => load()} />
            </div>
          </PortalSection>
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
    <div className="min-h-[100dvh] bg-[var(--lcif-bg)]">
      <LcifPartnerHeader
        subtitle={adminViewMode ? "Consultation admin" : conseillerSession ? "Espace conseiller" : "Espace partenaire"}
        partnerName={data.apporteur.companyName}
        partnerContact={data.apporteur.contactName}
        partnerTypeLabel={typeLabel}
        onLogout={conseillerSession && !adminViewMode ? handleConseillerLogout : undefined}
      />
      <div className="max-w-6xl mx-auto px-4 sm:px-5 py-6 pb-28 lg:pb-10">
        <div className="grid lg:grid-cols-[240px_1fr] gap-6 items-start">
          <aside className="hidden lg:block sticky top-28">
            <div className="lcif-card p-3">
              <p className="lcif-label px-2 pb-2">Sections</p>
              <PortalSidebarNav items={navItems} activeId={activeAnchor} onJump={scrollToAnchor} />
            </div>
          </aside>

          <div className="space-y-6 min-w-0">
            {adminViewMode ? (
              <p className="text-xs font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-center">
                Consultation admin — vous visualisez l&apos;espace du conseiller. Le partenaire n&apos;a aucun accès à
                l&apos;administration.
              </p>
            ) : null}
            {submitMsg ? (
              <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-2.5 text-center font-medium">
                {submitMsg}
              </p>
            ) : null}

            <div id="ap-hero" className="scroll-mt-24 lg:scroll-mt-28">
              <PartnerHeroSection
                apporteurType={data.apporteur.type}
                referralLink={data.referralLink}
                unlocked={unlocked}
                referralStats={data.referralStats}
                kpis={{
                  total: data.kpis.total,
                  open: data.kpis.open,
                  signed: data.kpis.signed,
                  conversionRate: data.kpis.conversionRate,
                }}
                onCopyLink={() => copyText(data.referralLink, "Lien client copié !")}
                onNewReferral={openNewReferral}
                onGoReferrals={() => scrollToAnchor("ap-referrals")}
              />
            </div>

        {isConseillerClub && data.conseillerClub ? (
          <div id="ap-phase" className="scroll-mt-28">
            <ConseillerPhaseBanner
              operatingPhase={data.conseillerClub.operatingPhase}
              signedCount={data.conseillerClub.signedCount}
              autonomyThreshold={data.conseillerClub.autonomyThreshold}
            />
          </div>
        ) : null}

        {isConseillerClub ? (
          <div id="ap-formation" className="scroll-mt-28">
            <ConseillerFormationSection portalToken={token} sessionAuth={conseillerSession} previewToken={adminPreviewToken || undefined} />
          </div>
        ) : null}

        {isConseillerClub ? (
          <div id="ap-ranking" className="scroll-mt-28">
            <PortalSection
              icon={PORTAL_NAV_ICONS.team}
              title="Classement conseillers"
              description="Classement basé uniquement sur le nombre de recommandations effectuées."
            >
              <div className="grid md:grid-cols-3 gap-3 mb-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-[11px] font-black uppercase text-slate-500">Votre rang</p>
                  <p className="text-2xl font-black text-slate-900 mt-1">
                    {ranking?.me?.rank ? `#${ranking.me.rank}` : "—"}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-[11px] font-black uppercase text-slate-500">Vos recommandations</p>
                  <p className="text-2xl font-black text-slate-900 mt-1">
                    {ranking?.me?.recommandations ?? 0}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-[11px] font-black uppercase text-slate-500">Règle</p>
                  <p className="text-xs text-slate-600 mt-1">
                    Uniquement le volume de recommandations (pas d'autres métriques).
                  </p>
                </div>
              </div>

              {(ranking?.leaderboard || []).length ? (
                <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <p className="text-sm font-bold text-slate-800">Top conseillers</p>
                    <p className="text-[11px] text-slate-500">Recommandations</p>
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {(ranking?.leaderboard || []).slice(0, 12).map((r) => (
                      <li key={r.apporteurId} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 truncate">
                            #{r.rank} — {r.contactName}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate">{r.companyName}</p>
                        </div>
                        <span className="shrink-0 text-sm font-black text-indigo-700">{r.recommandations}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="grid md:grid-cols-3 gap-3 mb-4">
                  <div className="md:col-span-3 text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-2xl p-4">
                    Pas encore de classement (aucun conseiller enregistré) — tout le monde est à 0.
                  </div>
                </div>
              )}
            </PortalSection>
          </div>
        ) : null}

            {data.contract?.signed ? (
              <section
                id="ap-contract"
                className="scroll-mt-28 bg-white rounded-xl border border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-sm"
              >
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

        <div id="ap-benefits" className="scroll-mt-24 lg:scroll-mt-28">
          <PortalSection
            icon={PORTAL_NAV_ICONS.benefits}
            title="Pourquoi recommander LCIF ?"
            description="Vos avantages en tant que partenaire."
          >
            <PartnerBenefitCards
              payoutPerSignatureEur={payoutPerSignature}
              payoutSharePercent={data.conseillerClub?.payoutSharePercent ?? data.remuneration.apporteurShareOfBrokerage}
              isConseiller={isConseillerClub}
            />
          </PortalSection>
        </div>

        <div id="ap-script" className="scroll-mt-24 lg:scroll-mt-28">
          <PortalSection
            icon={PORTAL_NAV_ICONS.script}
            title={isConseillerClub ? "Message à envoyer au client" : "Script client"}
            description="Copiez un message prêt à l'emploi pour vos clients."
          >
            <PartnerClientScript
              referralLink={data.referralLink}
              partnerContactName={data.apporteur.contactName}
              onCopy={copyText}
            />
          </PortalSection>
        </div>

        <div id="ap-journey" className="scroll-mt-24 lg:scroll-mt-28">
          <PortalSection
            icon={PORTAL_NAV_ICONS.journey}
            title="Parcours client"
            description="Les étapes vécues par vos clients recommandés."
          >
            <PartnerJourneyTimeline />
          </PortalSection>
        </div>

        {!isConseillerClub ? (
          <div id="ap-earnings" className="scroll-mt-28">
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
          </div>
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
        <section id="ap-recruit" className="scroll-mt-28 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
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
          <section id="ap-team" className="scroll-mt-28 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
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

        <PortalSection
          ref={referralsRef}
          id="ap-referrals"
          icon={PORTAL_NAV_ICONS.referrals}
            title={isConseillerClub ? "Mes dossiers clients" : "Mes clients recommandés"}
            description={
              isConseillerClub
                ? "Suivi des clients orientés vers LCIF — étapes, validations et souscription."
                : "Personnes orientées vers LCIF — suivi et commissions."
            }
            action={
              unlocked ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setShowForm((v) => !v)}>
                  <Plus className="w-3.5 h-3.5" />
                  {showForm ? "Fermer" : "Nouvelle reco"}
                </Button>
              ) : null
            }
          >
            <div className="space-y-4">
              {showForm && unlocked ? (
                <form onSubmit={submitReferral} className="border border-slate-200 rounded-2xl p-4 bg-slate-50/80 space-y-3">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Field label="Prénom" value={form.prenom} onChange={(v) => setForm((s) => ({ ...s, prenom: v }))} />
                    <Field label="Nom" value={form.nom} onChange={(v) => setForm((s) => ({ ...s, nom: v }))} />
                  </div>
                  <Field label="Email" value={form.email} onChange={(v) => setForm((s) => ({ ...s, email: v }))} type="email" />
                  <Field label="Téléphone" value={form.phone} onChange={(v) => setForm((s) => ({ ...s, phone: v }))} />
                  <label className="block text-xs font-bold text-slate-600">
                    Contexte (optionnel)
                    <textarea
                      className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-normal min-h-[72px] bento-input h-auto"
                      value={form.notes}
                      onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
                    />
                  </label>
                  <Button type="submit" disabled={submitting} className="w-full">
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Envoyer la recommandation
                  </Button>
                </form>
              ) : null}

              {data.referrals.length === 0 ? (
                <div className="text-center py-10 px-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/50">
                  <p className="text-sm font-bold text-slate-700">Aucun dossier pour le moment</p>
                  <p className="text-xs text-slate-500 mt-2 max-w-sm mx-auto">
                    {unlocked
                      ? "Copiez votre lien client ou créez une première recommandation depuis l'accueil."
                      : "Votre espace s'activera après signature du contrat."}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {data.referrals.map((r) => {
                    const name = [r.contact.prenom, r.contact.nom].filter(Boolean).join(" ") || "Contact";
                    const statusVariant =
                      r.status === "SIGNE"
                        ? "success"
                        : r.status === "REFUSE" || r.status === "PERDU"
                          ? "danger"
                          : r.status === "ETUDE_ENVOYEE"
                            ? "info"
                            : "warning";
                    return (
                      <article
                        key={r.id}
                        className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-indigo-100 transition-colors"
                      >
                        <div className="flex flex-wrap justify-between gap-2 mb-2">
                          <div>
                            <h3 className="font-black text-slate-900">{name}</h3>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {r.contact.email || "—"}
                              {r.contact.phone ? ` · ${r.contact.phone}` : ""}
                            </p>
                          </div>
                          <Badge variant={statusVariant}>{REFERRAL_STATUS_LABELS[r.status]}</Badge>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          Mis à jour le {new Date(r.updatedAt).toLocaleDateString("fr-FR")}
                        </p>
                        {r.tracking?.studyValidationPending ? (
                          <ConseillerStudyValidation
                            portalToken={token}
                            sessionAuth={conseillerSession}
                            previewToken={adminPreviewToken || undefined}
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
                            sessionAuth={conseillerSession}
                            previewToken={adminPreviewToken || undefined}
                            referralId={r.id}
                            existing={r.tracking.conseillerSubscription}
                            canSubmit={Boolean(r.tracking.canSubmitSubscription)}
                            onSubmitted={async () => {
                              setSubmitMsg("Formulaire transmis — LCIF va finaliser la souscription.");
                              await load();
                            }}
                          />
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </PortalSection>

            <div id="ap-guide" className="scroll-mt-24 lg:scroll-mt-28">
              <PartnerGuideSection />
            </div>
          </div>
        </div>
        <div className="mt-8">
          <LcifPartnerFooter />
        </div>
      </div>
      <PortalMobileNav items={navItems} activeId={activeAnchor} onJump={scrollToAnchor} />
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
