import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Copy,
  Link2,
  Mail,
  Plus,
  RefreshCw,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { adminFetch } from "../../lib/adminApi";
import type { Apporteur, PartnerRecruitRequest, PartnerRecruitStatus, Referral, ReferralStatus } from "../../../shared/apporteurTypes";
import {
  PARTNER_RECRUIT_FLOW,
  PARTNER_RECRUIT_STATUS_LABELS,
  REFERRAL_STATUS_LABELS,
  REFERRAL_STATUS_ORDER,
} from "../../../shared/apporteurTypes";
import { LCIF_LOGO_URL } from "../../../shared/apporteurBrand";
import { computeReferralKpis } from "../../../shared/apporteurKpis";
import KpiCard, { formatPercent } from "../portal/PartnerKpiGrid";
import PartnerContractWorkflow from "../portal/PartnerContractWorkflow";
import AdminApporteurLeaderboard from "./AdminApporteurLeaderboard";
import type { ApporteurLeaderboardRow } from "../../../shared/apporteurLeaderboard";
import ApporteurProfileFormFields, {
  EMPTY_APPORTEUR_PROFILE_FORM,
  type ApporteurProfileFormState,
} from "../portal/ApporteurProfileFormFields";
import { resolveApporteurTypeLabel } from "../../../shared/apporteurProfile";
import { formatReferralGeoDetail } from "../../../shared/referralGeo";

type Props = {
  onBack: () => void;
};

const EMPTY_APPORTEUR: ApporteurProfileFormState & { notes: string } = {
  ...EMPTY_APPORTEUR_PROFILE_FORM,
  notes: "",
};

const EMPTY_REFERRAL = {
  prenom: "",
  nom: "",
  email: "",
  phone: "",
  notes: "",
  dossierId: "",
};

export default function AdminApporteursPanel({ onBack }: Props) {
  const [loading, setLoading] = useState(true);
  const [apporteurs, setApporteurs] = useState<Apporteur[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [partnerRecruits, setPartnerRecruits] = useState<PartnerRecruitRequest[]>([]);
  const [summary, setSummary] = useState<Record<string, number | string> | null>(null);
  const [selectedApporteurId, setSelectedApporteurId] = useState<string | "all">("all");
  const [showNewApporteur, setShowNewApporteur] = useState(false);
  const [showNewReferral, setShowNewReferral] = useState(false);
  const [newApporteur, setNewApporteur] = useState({ ...EMPTY_APPORTEUR });
  const [newReferral, setNewReferral] = useState({ ...EMPTY_REFERRAL });
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [publicBaseUrl, setPublicBaseUrl] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [leaderboard, setLeaderboard] = useState<ApporteurLeaderboardRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch("/api/admin/apporteurs");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Chargement impossible");
      setApporteurs(data.apporteurs || []);
      setReferrals(data.referrals || []);
      setPartnerRecruits(data.partnerRecruits || []);
      setSummary(data.summary || null);
      setPublicBaseUrl(String(data.publicBaseUrl || ""));
      setLeaderboard(data.leaderboard || []);
    } catch (e: any) {
      setError(e?.message || "Erreur réseau");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredReferrals = useMemo(() => {
    if (selectedApporteurId === "all") return referrals;
    return referrals.filter((r) => r.apporteurId === selectedApporteurId);
  }, [referrals, selectedApporteurId]);

  const apporteurById = useMemo(() => {
    const map = new Map<string, Apporteur>();
    for (const a of apporteurs) map.set(a.id, a);
    return map;
  }, [apporteurs]);

  const globalKpis = useMemo(() => computeReferralKpis(referrals), [referrals]);
  const selectedKpis = useMemo(() => computeReferralKpis(filteredReferrals), [filteredReferrals]);

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };

  const createApporteur = async () => {
    setError(null);
    const res = await adminFetch("/api/admin/apporteurs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newApporteur),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Création impossible");
      return;
    }
    setShowNewApporteur(false);
    setNewApporteur({ ...EMPTY_APPORTEUR });
    await load();
  };

  const createReferral = async () => {
    if (selectedApporteurId === "all") {
      setError("Sélectionnez un apporteur avant d'ajouter une recommandation.");
      return;
    }
    setError(null);
    const res = await adminFetch("/api/admin/referrals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apporteurId: selectedApporteurId,
        contact: {
          prenom: newReferral.prenom,
          nom: newReferral.nom,
          email: newReferral.email,
          phone: newReferral.phone,
          notes: newReferral.notes,
        },
        dossierId: newReferral.dossierId || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Création impossible");
      return;
    }
    setShowNewReferral(false);
    setNewReferral({ ...EMPTY_REFERRAL });
    await load();
  };

  const updateReferralStatus = async (referralId: string, status: ReferralStatus) => {
    const res = await adminFetch(`/api/admin/referrals/${referralId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Mise à jour impossible");
      return;
    }
    await load();
  };

  const linkDossier = async (referralId: string, dossierId: string) => {
    const id = dossierId.trim().toUpperCase();
    if (!id) return;
    const res = await adminFetch(`/api/admin/referrals/${referralId}/link-dossier`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dossierId: id }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Liaison impossible");
      return;
    }
    await load();
  };

  const sendPortalInvite = async (apporteurId: string) => {
    setError(null);
    setSuccessMsg(null);
    const res = await adminFetch(`/api/admin/apporteurs/${apporteurId}/send-portal-invite`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Envoi impossible");
      return;
    }
    setSuccessMsg("Invitation espace apporteur envoyée par email.");
  };

  const sendContractSigningInvite = async (apporteurId: string) => {
    setError(null);
    setSuccessMsg(null);
    const res = await adminFetch(`/api/admin/apporteurs/${apporteurId}/send-contract-signing-invite`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Envoi impossible");
      return;
    }
    setSuccessMsg("Lien de signature du contrat envoyé par email.");
  };

  const updatePartnerRecruitStatus = async (recruitId: string, status: PartnerRecruitStatus) => {
    setError(null);
    const res = await adminFetch(`/api/admin/partner-recruits/${recruitId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Mise à jour impossible");
      return;
    }
    if (status === "CONTRAT_SIGNE" && data.recruit?.createdApporteurId) {
      setSuccessMsg(`Apporteur créé et rattaché au parrain (${data.recruit.createdApporteurId}).`);
      setSelectedApporteurId(data.recruit.createdApporteurId);
    } else if (status === "CONTRAT_ENVOYE") {
      setSuccessMsg("Lien de signature envoyé — le candidat peut signer en ligne depuis son espace.");
    } else if (status === "REFUSE") {
      setSuccessMsg("Candidature refusée.");
    }
    await load();
  };

  const deleteApporteur = async (apporteurId: string) => {
    setDeleting(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/apporteurs/${apporteurId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Suppression impossible");
      setDeleteConfirmId(null);
      setSelectedApporteurId("all");
      setSuccessMsg("Apporteur supprimé définitivement.");
      await load();
    } catch (e: any) {
      setError(e?.message || "Erreur");
    } finally {
      setDeleting(false);
    }
  };

  const pendingRecruits = useMemo(
    () => partnerRecruits.filter((r) => !["CONTRAT_SIGNE", "REFUSE"].includes(r.status)),
    [partnerRecruits],
  );

  const updateContractStatus = async (apporteurId: string, contractStatus: Apporteur["contractStatus"]) => {
    setError(null);
    const res = await adminFetch(`/api/admin/apporteurs/${apporteurId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractStatus }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Mise à jour contrat impossible");
      return;
    }
    setSuccessMsg(
      contractStatus === "signed"
        ? "Contrat marqué signé — portail débloqué pour l'apporteur."
        : `Statut contrat : ${contractStatus}`,
    );
    await load();
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-[#1E3A8A] text-white px-6 py-5 flex flex-wrap justify-between items-center gap-4">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-indigo-200 hover:text-white mb-2"
          >
            ← Retour au tableau de bord dossiers
          </button>
          <div className="flex items-center gap-4">
            <img src={LCIF_LOGO_URL} alt="LCIF" className="h-10 w-auto brightness-0 invert hidden sm:block" />
            <div>
              <h1 className="text-xl font-black flex items-center gap-2">
                <Users className="w-5 h-5" />
                Apporteurs d&apos;affaires
              </h1>
              {summary ? (
                <p className="text-xs text-indigo-200 mt-1">
                  {summary.activeApporteurs ?? summary.apporteurs} actif(s) · {summary.openReferrals ?? summary.open} reco ouverte(s)
                </p>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowNewApporteur(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white text-[#1E3A8A] text-sm font-bold hover:bg-indigo-50"
          >
            <Plus className="w-4 h-4" /> Nouvel apporteur
          </button>
          <button
            type="button"
            onClick={() => setShowNewReferral(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-white/30 bg-white/10 text-white text-sm font-bold hover:bg-white/20"
          >
            <UserPlus className="w-4 h-4" /> Recommandation
          </button>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-white/30 bg-white/10 text-white text-sm font-bold hover:bg-white/20"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      {error ? (
        <div className="mx-6 mt-4 rounded-lg bg-red-50 border border-red-100 text-red-800 text-sm px-4 py-3">
          {error}
        </div>
      ) : null}
      {successMsg ? (
        <div className="mx-6 mt-4 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-800 text-sm px-4 py-3">
          {successMsg}
        </div>
      ) : null}

      {pendingRecruits.length > 0 ? (
        <div className="mx-6 mt-4 bg-gradient-to-br from-amber-50 to-white border border-amber-200 rounded-2xl p-5 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-wide text-amber-900 mb-1">
            Candidatures à traiter ({pendingRecruits.length})
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            À l&apos;étape « signature en ligne », un email part au candidat avec le lien pour signer le contrat dans son espace.
          </p>
          <div className="space-y-4">
            {pendingRecruits.map((r) => {
              const created = r.createdApporteurId ? apporteurById.get(r.createdApporteurId) : undefined;
              const signingLink =
                created?.portalToken && publicBaseUrl
                  ? `${publicBaseUrl.replace(/\/$/, "")}/apporteur/${created.portalToken}`
                  : created?.portalToken
                    ? `/apporteur/${created.portalToken}`
                    : "";
              return (
              <PartnerRecruitCard
                key={r.id}
                recruit={r}
                sponsorLabel={apporteurById.get(r.sponsorApporteurId)?.contactName || r.sponsorApporteurId}
                sponsorCompany={apporteurById.get(r.sponsorApporteurId)?.companyName}
                signingLink={signingLink}
                onAdvance={(status) => updatePartnerRecruitStatus(r.id, status)}
                onRefuse={() => updatePartnerRecruitStatus(r.id, "REFUSE")}
                copyText={copyText}
              />
            );
            })}
          </div>
        </div>
      ) : null}

      <div className="mx-6 mt-4 space-y-3">
        <p className="text-xs font-black uppercase tracking-wide text-slate-400">
          {selectedApporteurId === "all" ? "Vue réseau" : `KPI — ${apporteurById.get(selectedApporteurId)?.companyName || ""}`}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {(selectedApporteurId === "all" ? globalKpis : selectedKpis) && (
            <>
              <KpiCard label="Total" value={(selectedApporteurId === "all" ? globalKpis : selectedKpis).total} accent="indigo" />
              <KpiCard label="En cours" value={(selectedApporteurId === "all" ? globalKpis : selectedKpis).open} accent="amber" />
              <KpiCard label="Signées" value={(selectedApporteurId === "all" ? globalKpis : selectedKpis).signed} accent="emerald" />
              <KpiCard label="Conversion" value={formatPercent((selectedApporteurId === "all" ? globalKpis : selectedKpis).conversionRate)} accent="violet" />
              <KpiCard label="Ce mois" value={(selectedApporteurId === "all" ? globalKpis : selectedKpis).thisMonth} />
              <KpiCard label="Études" value={(selectedApporteurId === "all" ? globalKpis : selectedKpis).etudeEnvoyee} accent="violet" />
              <KpiCard label="Refusés" value={(selectedApporteurId === "all" ? globalKpis : selectedKpis).refused} />
              <KpiCard label="Perdus" value={(selectedApporteurId === "all" ? globalKpis : selectedKpis).lost} />
            </>
          )}
        </div>
        {selectedApporteurId === "all" && summary ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <KpiCard label="Apporteurs" value={Number(summary.apporteurs) || 0} accent="indigo" />
            <KpiCard label="Actifs" value={Number(summary.activeApporteurs) || 0} accent="emerald" />
            <KpiCard
              label="Avec pipeline"
              value={Number(summary.apporteursWithOpenReferrals) || 0}
              sub="apporteurs avec reco ouverte"
            />
          </div>
        ) : null}
      </div>

      {selectedApporteurId === "all" && leaderboard.length > 0 ? (
        <AdminApporteurLeaderboard
          rows={leaderboard}
          onSelectApporteur={(id) => setSelectedApporteurId(id)}
        />
      ) : null}

      <div className="flex flex-1 overflow-hidden mt-2">
        <aside className="w-80 max-w-[40%] bg-white border-r border-slate-200 overflow-y-auto">
          <div className="p-3 border-b">
            <button
              type="button"
              onClick={() => setSelectedApporteurId("all")}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-bold ${
                selectedApporteurId === "all" ? "bg-indigo-50 text-indigo-900" : "hover:bg-slate-50"
              }`}
            >
              Tous les apporteurs
            </button>
          </div>
          {apporteurs.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setSelectedApporteurId(a.id)}
              className={`w-full text-left px-4 py-3 border-b border-slate-100 ${
                selectedApporteurId === a.id ? "bg-indigo-50" : "hover:bg-slate-50"
              }`}
            >
              <div className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                {a.companyName}
                {!a.active ? (
                  <span className="text-[10px] uppercase bg-slate-200 px-1.5 py-0.5 rounded">Inactif</span>
                ) : null}
              </div>
              <div className="text-xs text-slate-500 mt-1">{a.contactName} · {resolveApporteurTypeLabel(a)}</div>
              <div className="text-[11px] text-slate-400 mt-1 font-mono">ref={a.referralToken}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                {a.referralStats?.linkClicks ?? 0} visite{(a.referralStats?.linkClicks ?? 0) !== 1 ? "s" : ""} lien
                {(a.referralStats?.uniqueSessions ?? 0) > 0
                  ? ` · ${a.referralStats!.uniqueSessions} session${a.referralStats!.uniqueSessions > 1 ? "s" : ""}`
                  : ""}
              </div>
              <p className="text-[10px] text-slate-400 mt-0.5">Lien basé sur le contact — plusieurs personnes d&apos;une même société ont chacun leur ref.</p>
            </button>
          ))}
          {!loading && apporteurs.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">Aucun apporteur — créez le premier.</p>
          ) : null}
        </aside>

        <main className="flex-1 overflow-y-auto p-6">
          {selectedApporteurId !== "all" && apporteurById.get(selectedApporteurId) ? (
            <div className="bg-white border rounded-2xl p-5 mb-6 shadow-sm">
              {(() => {
                const a = apporteurById.get(selectedApporteurId)!;
                const link = publicBaseUrl
                  ? `${publicBaseUrl.replace(/\/$/, "")}/?ref=${encodeURIComponent(a.referralToken)}`
                  : `/?ref=${a.referralToken}`;
                const portalLink = a.portalToken
                  ? publicBaseUrl
                    ? `${publicBaseUrl.replace(/\/$/, "")}/apporteur/${a.portalToken}`
                    : `/apporteur/${a.portalToken}`
                  : "";
                return (
                  <>
                    <h2 className="text-lg font-black text-slate-900 mb-1 flex flex-wrap items-center justify-between gap-2">
                      <span>{a.companyName}</span>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(a.id)}
                        className="inline-flex items-center gap-1 text-xs font-bold text-red-600 hover:text-red-800 border border-red-100 px-2 py-1 rounded-lg hover:bg-red-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Supprimer
                      </button>
                    </h2>
                    <p className="text-sm text-slate-600 mb-3">
                      {a.contactName} — {a.email}
                      {a.phone ? ` · ${a.phone}` : ""}
                    </p>
                    {a.sponsorId ? (
                      <p className="text-xs text-indigo-700 mb-2">
                        Parrain : {apporteurById.get(a.sponsorId)?.contactName || a.sponsorId}
                      </p>
                    ) : null}
                    <div className="space-y-4">
                      <div className="border border-slate-100 rounded-xl p-4 bg-slate-50/80">
                        <p className="text-[11px] font-black uppercase text-slate-400 mb-2">Contrat partenaire (signature en ligne)</p>
                        <PartnerContractWorkflow contractStatus={a.contractStatus || "none"} semiAutoPreview />
                        <div className="flex flex-wrap gap-2 mt-3">
                          {(a.contractStatus || "none") !== "signed" ? (
                            <>
                              <button
                                type="button"
                                onClick={() => sendContractSigningInvite(a.id)}
                                className="text-xs font-bold px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
                              >
                                Envoyer lien signature
                              </button>
                              <button
                                type="button"
                                onClick={() => updateContractStatus(a.id, "signed")}
                                className="text-xs font-bold px-2.5 py-1.5 rounded-lg border border-emerald-300 text-emerald-800 bg-emerald-50 hover:bg-emerald-100"
                              >
                                Marquer signé (hors ligne)
                              </button>
                            </>
                          ) : (
                            <div className="space-y-1">
                              <p className="text-xs text-emerald-700 font-bold">
                                Signé{a.contractSignedAt ? ` le ${new Date(a.contractSignedAt).toLocaleDateString("fr-FR")}` : ""}
                                {a.contractSignature?.signerName ? ` · ${a.contractSignature.signerName}` : ""}
                              </p>
                              {a.contractSignature?.pdfFileName ? (
                                <p className="text-[10px] text-slate-500">PDF : {a.contractSignature.pdfFileName}</p>
                              ) : null}
                              {a.contractSignature?.driveLink ? (
                                <a
                                  href={a.contractSignature.driveLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[10px] font-bold text-indigo-700 hover:underline"
                                >
                                  Voir sur Google Drive
                                </a>
                              ) : null}
                            </div>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 mt-2">
                          Le partenaire signe depuis son espace privé — le portail se débloque automatiquement.
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-black uppercase text-slate-400 mb-1">Espace apporteur (privé)</p>
                        <div className="flex flex-wrap gap-2 items-center">
                          <code className="text-xs bg-indigo-50 text-indigo-900 px-2 py-1 rounded">{portalLink || "—"}</code>
                          {portalLink ? (
                            <button
                              type="button"
                              onClick={() => copyText(portalLink)}
                              className="inline-flex items-center gap-1 text-xs font-bold text-indigo-700 hover:underline"
                            >
                              <Copy className="w-3.5 h-3.5" /> Copier
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => sendPortalInvite(a.id)}
                            className="inline-flex items-center gap-1 text-xs font-bold text-indigo-700 hover:underline"
                          >
                            <Mail className="w-3.5 h-3.5" /> Envoyer par email
                          </button>
                        </div>
                      </div>
                      <div>
                        <p className="text-[11px] font-black uppercase text-slate-400 mb-1">Lien client (?ref=)</p>
                        <div className="flex flex-wrap gap-2 items-center">
                          <code className="text-xs bg-slate-100 px-2 py-1 rounded">{link}</code>
                          <button
                            type="button"
                            onClick={() => copyText(link)}
                            className="inline-flex items-center gap-1 text-xs font-bold text-indigo-700 hover:underline"
                          >
                            <Copy className="w-3.5 h-3.5" /> Copier le lien
                          </button>
                          <span className="text-xs text-slate-400 inline-flex items-center gap-1">
                            <Link2 className="w-3.5 h-3.5" /> Attribution auto au dépôt formulaire
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-2">
                          {a.referralStats?.linkClicks ?? 0} visite{(a.referralStats?.linkClicks ?? 0) !== 1 ? "s" : ""} du lien
                          {(a.referralStats?.uniqueSessions ?? 0) > 0
                            ? ` · ${a.referralStats!.uniqueSessions} session(s) distincte(s)`
                            : ""}
                          {a.referralStats?.lastClickAt
                            ? ` · dernière : ${new Date(a.referralStats.lastClickAt).toLocaleString("fr-FR")}`
                            : ""}
                        </p>
                        {(() => {
                          const geo = formatReferralGeoDetail(a.referralStats);
                          if (!geo.cities && !geo.countries) return null;
                          return (
                            <div className="text-[11px] text-slate-500 mt-1.5 space-y-0.5">
                              {geo.cities ? (
                                <p>
                                  <span className="font-bold text-slate-600">Villes :</span> {geo.cities}
                                </p>
                              ) : null}
                              {geo.countries ? (
                                <p>
                                  <span className="font-bold text-slate-600">Pays :</span> {geo.countries}
                                </p>
                              ) : null}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          ) : null}

          <h3 className="text-sm font-black uppercase tracking-wide text-slate-500 mb-3">
            Recommandations ({filteredReferrals.length})
          </h3>

          <div className="space-y-3">
            {filteredReferrals.map((r) => {
              const apporteur = apporteurById.get(r.apporteurId);
              const name = [r.contact.prenom, r.contact.nom].filter(Boolean).join(" ") || "Contact";
              return (
                <div key={r.id} className="bg-white border rounded-xl p-4 shadow-sm">
                  <div className="flex flex-wrap justify-between gap-2 mb-2">
                    <div>
                      <div className="font-bold text-slate-900">{name}</div>
                      <div className="text-xs text-slate-500">
                        {r.contact.email || "—"}
                        {r.contact.phone ? ` · ${r.contact.phone}` : ""}
                      </div>
                      {selectedApporteurId === "all" && apporteur ? (
                        <div className="text-[11px] text-indigo-700 font-bold mt-1">{apporteur.companyName}</div>
                      ) : null}
                    </div>
                    <select
                      value={r.status}
                      onChange={(e) => updateReferralStatus(r.id, e.target.value as ReferralStatus)}
                      className="text-xs font-bold border rounded-lg px-2 py-1.5 bg-slate-50"
                    >
                      {REFERRAL_STATUS_ORDER.map((s) => (
                        <option key={s} value={s}>
                          {REFERRAL_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                  {r.contact.notes ? (
                    <p className="text-xs text-slate-600 mb-2 whitespace-pre-wrap">{r.contact.notes}</p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono text-slate-400">{r.id}</span>
                    {r.dossierId ? (
                      <span className="font-mono text-slate-500">{r.dossierId}</span>
                    ) : (
                      <form
                        className="inline-flex gap-1 items-center"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const input = (e.currentTarget.elements.namedItem("dossierId") as HTMLInputElement);
                          linkDossier(r.id, input.value);
                        }}
                      >
                        <input
                          name="dossierId"
                          placeholder="LCIF-000000"
                          className="border rounded px-2 py-1 w-28 font-mono text-[11px]"
                        />
                        <button type="submit" className="text-indigo-700 font-bold hover:underline">
                          Lier
                        </button>
                      </form>
                    )}
                    <span className="text-slate-400">
                      {new Date(r.updatedAt).toLocaleDateString("fr-FR")}
                    </span>
                  </div>
                </div>
              );
            })}
            {!loading && filteredReferrals.length === 0 ? (
              <p className="text-sm text-slate-500">Aucune recommandation pour cette sélection.</p>
            ) : null}
          </div>
        </main>
      </div>

      {showNewApporteur ? (
        <Modal title="Nouvel apporteur" onClose={() => setShowNewApporteur(false)}>
          <div className="grid gap-3">
            <ApporteurProfileFormFields
              value={newApporteur}
              onChange={(next) => setNewApporteur((s) => ({ ...s, ...next }))}
            />
            <p className="text-[10px] text-slate-500 -mt-1">
              Le lien client (?ref=) sera généré à partir du prénom et nom (ex. marie-dupont).
            </p>
            <label className="text-xs font-bold text-slate-600">
              Notes internes
              <textarea
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm min-h-[72px]"
                value={newApporteur.notes}
                onChange={(e) => setNewApporteur((s) => ({ ...s, notes: e.target.value }))}
              />
            </label>
            <button type="button" onClick={createApporteur} className="mt-2 w-full py-2.5 rounded-lg bg-indigo-600 text-white font-bold">
              Créer
            </button>
          </div>
        </Modal>
      ) : null}

      {showNewReferral ? (
        <Modal title="Nouvelle recommandation" onClose={() => setShowNewReferral(false)}>
          <div className="grid gap-3">
            {selectedApporteurId === "all" ? (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                Sélectionnez d&apos;abord un apporteur dans la liste de gauche.
              </p>
            ) : null}
            <Field label="Prénom" value={newReferral.prenom} onChange={(v) => setNewReferral((s) => ({ ...s, prenom: v }))} />
            <Field label="Nom" value={newReferral.nom} onChange={(v) => setNewReferral((s) => ({ ...s, nom: v }))} />
            <Field label="Email" value={newReferral.email} onChange={(v) => setNewReferral((s) => ({ ...s, email: v }))} />
            <Field label="Téléphone" value={newReferral.phone} onChange={(v) => setNewReferral((s) => ({ ...s, phone: v }))} />
            <Field label="Dossier LCIF (optionnel)" value={newReferral.dossierId} onChange={(v) => setNewReferral((s) => ({ ...s, dossierId: v }))} />
            <label className="text-xs font-bold text-slate-600">
              Contexte
              <textarea
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm min-h-[72px]"
                value={newReferral.notes}
                onChange={(e) => setNewReferral((s) => ({ ...s, notes: e.target.value }))}
              />
            </label>
            <button
              type="button"
              onClick={createReferral}
              disabled={selectedApporteurId === "all"}
              className="mt-2 w-full py-2.5 rounded-lg bg-indigo-600 text-white font-bold disabled:opacity-50"
            >
              Enregistrer
            </button>
          </div>
        </Modal>
      ) : null}

      {deleteConfirmId ? (
        <Modal title="Supprimer définitivement ?" onClose={() => setDeleteConfirmId(null)}>
          <p className="text-sm text-slate-600 mb-4">
            L&apos;apporteur <strong>{apporteurById.get(deleteConfirmId)?.contactName}</strong> sera supprimé avec
            ses recommandations. Les filleuls seront détachés (sans parrain). Cette action est irréversible.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDeleteConfirmId(null)}
              className="flex-1 py-2.5 rounded-lg border border-slate-200 font-bold text-sm"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={() => deleteApporteur(deleteConfirmId)}
              className="flex-1 py-2.5 rounded-lg bg-red-600 text-white font-bold text-sm disabled:opacity-50"
            >
              {deleting ? "Suppression…" : "Supprimer"}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function recruitNextAction(status: PartnerRecruitStatus): { label: string; next: PartnerRecruitStatus } | null {
  if (status === "NOUVEAU") return { label: "1. Valider la candidature", next: "VALIDE_LCIF" };
  if (status === "VALIDE_LCIF") return { label: "2. Activer la signature en ligne", next: "CONTRAT_ENVOYE" };
  return null;
}

function PartnerRecruitCard({
  recruit,
  sponsorLabel,
  sponsorCompany,
  signingLink,
  onAdvance,
  onRefuse,
  copyText,
}: {
  recruit: PartnerRecruitRequest;
  sponsorLabel: string;
  sponsorCompany?: string;
  signingLink?: string;
  onAdvance: (status: PartnerRecruitStatus) => void;
  onRefuse: () => void;
  copyText: (text: string) => void;
}) {
  const stepIndex = PARTNER_RECRUIT_FLOW.indexOf(recruit.status);
  const action = recruitNextAction(recruit.status);
  const mailto = `mailto:${encodeURIComponent(recruit.email)}?subject=${encodeURIComponent("Contrat apporteur — Le Club Immobilier Français")}`;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex flex-wrap justify-between gap-3 mb-4">
        <div>
          <p className="text-lg font-black text-slate-900">{recruit.contactName}</p>
          {recruit.companyName ? <p className="text-sm text-slate-600">{recruit.companyName}</p> : null}
          <p className="text-xs text-slate-500 mt-1">
            {recruit.email}
            {recruit.phone ? ` · ${recruit.phone}` : ""}
          </p>
          <p className="text-[11px] text-indigo-700 mt-1 font-medium">
            Parrain : {sponsorLabel}
            {sponsorCompany ? ` (${sponsorCompany})` : ""}
          </p>
          {recruit.notes ? <p className="text-xs text-slate-400 mt-2 italic">{recruit.notes}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2 items-start">
          <button
            type="button"
            onClick={() => copyText(recruit.email)}
            className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 border px-2 py-1 rounded-lg hover:bg-slate-50"
          >
            <Copy className="w-3 h-3" /> Email
          </button>
          <a
            href={mailto}
            className="inline-flex items-center gap-1 text-xs font-bold text-indigo-700 border border-indigo-200 px-2 py-1 rounded-lg hover:bg-indigo-50"
          >
            <Mail className="w-3 h-3" /> Envoyer contrat
          </a>
        </div>
      </div>

      <ol className="flex flex-wrap gap-1 mb-4">
        {PARTNER_RECRUIT_FLOW.map((step, i) => {
          const done = stepIndex > i;
          const active = recruit.status === step;
          return (
            <li
              key={step}
              className={`text-[10px] font-bold uppercase px-2 py-1 rounded-full ${
                done ? "bg-emerald-100 text-emerald-800" : active ? "bg-indigo-100 text-indigo-800 ring-2 ring-indigo-300" : "bg-slate-100 text-slate-400"
              }`}
            >
              {PARTNER_RECRUIT_STATUS_LABELS[step]}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-3">
        {action ? (
          <button
            type="button"
            onClick={() => onAdvance(action.next)}
            className="text-sm font-bold px-4 py-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
          >
            {action.label}
          </button>
        ) : recruit.status === "CONTRAT_ENVOYE" ? (
          <div className="space-y-2 w-full">
            <p className="text-sm text-amber-800 font-bold bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              En attente de signature en ligne par le candidat
            </p>
            {signingLink ? (
              <div className="flex flex-wrap gap-2 items-center">
                <code className="text-[11px] bg-slate-100 px-2 py-1 rounded break-all">{signingLink}</code>
                <button
                  type="button"
                  onClick={() => copyText(signingLink)}
                  className="text-xs font-bold text-indigo-700 hover:underline"
                >
                  Copier le lien
                </button>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => onAdvance("CONTRAT_SIGNE")}
              className="text-xs font-bold text-emerald-700 hover:underline"
            >
              Marquer signé manuellement (hors ligne)
            </button>
          </div>
        ) : (
          <span className="text-sm text-emerald-700 font-bold">Terminé</span>
        )}
        <button type="button" onClick={onRefuse} className="text-xs font-bold text-red-600 hover:underline ml-auto">
          Refuser la candidature
        </button>
      </div>
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-black text-lg">{title}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 text-sm font-bold">
            Fermer
          </button>
        </div>
        {children}
      </div>
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
    <label className="text-xs font-bold text-slate-600 block">
      {label}
      <input
        className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
