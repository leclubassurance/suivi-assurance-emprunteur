import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Link2, Plus, RefreshCw, UserPlus, Users } from "lucide-react";
import { adminFetch } from "../../lib/adminApi";
import type { NetworkMember, NetworkReferral, ReferralStatus } from "../../../shared/networkTypes";
import { REFERRAL_STATUS_LABELS, REFERRAL_STATUS_ORDER } from "../../../shared/networkTypes";
import { LCIF_LOGO_URL } from "../../../shared/apporteurBrand";
import { computeReferralKpis } from "../../../shared/apporteurKpis";
import KpiCard, { formatPercent } from "../portal/PartnerKpiGrid";
import PartnerContractWorkflow from "../portal/PartnerContractWorkflow";

type Props = { onBack: () => void };

const EMPTY_MEMBER = { contactName: "", email: "", phone: "", notes: "", sponsorId: "" };
const EMPTY_REFERRAL = { prenom: "", nom: "", email: "", phone: "", notes: "", dossierId: "" };

export default function AdminNetworkPanel({ onBack }: Props) {
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<NetworkMember[]>([]);
  const [referrals, setReferrals] = useState<NetworkReferral[]>([]);
  const [summary, setSummary] = useState<Record<string, number | string> | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string | "all">("all");
  const [showNewMember, setShowNewMember] = useState(false);
  const [showNewReferral, setShowNewReferral] = useState(false);
  const [newMember, setNewMember] = useState({ ...EMPTY_MEMBER });
  const [newReferral, setNewReferral] = useState({ ...EMPTY_REFERRAL });
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [publicBaseUrl, setPublicBaseUrl] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch("/api/admin/reseau");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Chargement impossible");
      setMembers(data.members || []);
      setReferrals(data.referrals || []);
      setSummary(data.summary || null);
      setPublicBaseUrl(String(data.publicBaseUrl || ""));
    } catch (e: any) {
      setError(e?.message || "Erreur réseau");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const memberById = useMemo(() => {
    const map = new Map<string, NetworkMember>();
    for (const m of members) map.set(m.id, m);
    return map;
  }, [members]);

  const filteredReferrals = useMemo(() => {
    if (selectedMemberId === "all") return referrals;
    return referrals.filter((r) => r.memberId === selectedMemberId);
  }, [referrals, selectedMemberId]);

  const globalKpis = useMemo(() => computeReferralKpis(referrals), [referrals]);
  const selectedKpis = useMemo(() => computeReferralKpis(filteredReferrals), [filteredReferrals]);

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setSuccessMsg("Copié dans le presse-papiers.");
      setTimeout(() => setSuccessMsg(null), 2000);
    } catch {
      /* ignore */
    }
  };

  const portalUrl = (m: NetworkMember) =>
    `${publicBaseUrl.replace(/\/$/, "")}/reseau/${m.portalToken}`;
  const refUrl = (m: NetworkMember) =>
    `${publicBaseUrl.replace(/\/$/, "")}/?ref=${encodeURIComponent(m.referralToken)}`;
  const joinUrl = (m: NetworkMember) =>
    `${publicBaseUrl.replace(/\/$/, "")}/rejoindre/${encodeURIComponent(m.joinToken)}`;

  const createMember = async () => {
    setError(null);
    const res = await adminFetch("/api/admin/reseau", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...newMember,
        sponsorId: newMember.sponsorId || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Création impossible");
      return;
    }
    setShowNewMember(false);
    setNewMember({ ...EMPTY_MEMBER });
    await load();
  };

  const createReferral = async () => {
    if (selectedMemberId === "all") {
      setError("Sélectionnez un membre avant d'ajouter une recommandation.");
      return;
    }
    setError(null);
    const res = await adminFetch("/api/admin/network-referrals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        memberId: selectedMemberId,
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
    const res = await adminFetch(`/api/admin/network-referrals/${referralId}`, {
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

  const updateContractStatus = async (memberId: string, contractStatus: NetworkMember["contractStatus"]) => {
    setError(null);
    const res = await adminFetch(`/api/admin/reseau/${memberId}`, {
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
        ? "Contrat marqué signé — portail débloqué."
        : `Statut contrat : ${contractStatus}`,
    );
    await load();
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-[#0f172a] text-white px-6 py-5 flex flex-wrap justify-between items-center gap-4">
        <div>
          <button type="button" onClick={onBack} className="text-sm text-slate-300 hover:text-white mb-2">
            ← Retour au tableau de bord dossiers
          </button>
          <div className="flex items-center gap-4">
            <img src={LCIF_LOGO_URL} alt="LCIF" className="h-10 w-auto brightness-0 invert hidden sm:block" />
            <div>
              <h1 className="text-xl font-black flex items-center gap-2">
                <Users className="w-5 h-5" />
                Réseau — marketing de réseau
              </h1>
              {summary ? (
                <p className="text-xs text-slate-300 mt-1">
                  {summary.activeMembers ?? summary.members} actif(s) · {summary.openReferrals ?? summary.open} reco ouverte(s)
                </p>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowNewMember(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white text-slate-900 text-sm font-bold hover:bg-slate-100"
          >
            <Plus className="w-4 h-4" /> Nouveau membre
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
        <div className="mx-6 mt-4 rounded-lg bg-red-50 border border-red-100 text-red-800 text-sm px-4 py-3">{error}</div>
      ) : null}
      {successMsg ? (
        <div className="mx-6 mt-4 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-800 text-sm px-4 py-3">
          {successMsg}
        </div>
      ) : null}

      <div className="mx-6 mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <KpiCard label="Total reco" value={globalKpis.total} accent="indigo" />
        <KpiCard label="En cours" value={globalKpis.open} accent="amber" />
        <KpiCard label="Signées" value={globalKpis.signed} accent="emerald" />
        <KpiCard label="Conversion" value={formatPercent(globalKpis.conversionRate)} accent="violet" />
      </div>

      <div className="flex flex-1 overflow-hidden mt-4">
        <aside className="w-80 max-w-[40%] bg-white border-r border-slate-200 overflow-y-auto">
          <div className="p-3 border-b">
            <button
              type="button"
              onClick={() => setSelectedMemberId("all")}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-bold ${
                selectedMemberId === "all" ? "bg-slate-100 text-slate-900" : "hover:bg-slate-50"
              }`}
            >
              Tous les membres
            </button>
          </div>
          <ul className="p-2 space-y-1">
            {members.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setSelectedMemberId(m.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-sm ${
                    selectedMemberId === m.id ? "bg-indigo-50 text-indigo-900 font-bold" : "hover:bg-slate-50"
                  }`}
                >
                  <span className="block truncate">{m.contactName}</span>
                  <span className="text-[10px] text-slate-400 font-normal">
                    {m.sponsorId ? `Parrain : ${memberById.get(m.sponsorId)?.contactName || "—"}` : "Racine"}
                    {!m.active ? " · inactif" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          {selectedMemberId !== "all" && memberById.get(selectedMemberId) ? (
            <MemberDetail
              member={memberById.get(selectedMemberId)!}
              portalUrl={portalUrl(memberById.get(selectedMemberId)!)}
              refUrl={refUrl(memberById.get(selectedMemberId)!)}
              joinUrl={joinUrl(memberById.get(selectedMemberId)!)}
              onCopy={copyText}
              onContractStatus={(s) => updateContractStatus(selectedMemberId, s)}
            />
          ) : null}

          <section>
            <h2 className="text-sm font-black uppercase tracking-wide text-slate-400 mb-3">
              Recommandations {selectedMemberId !== "all" ? `— ${memberById.get(selectedMemberId)?.contactName}` : ""}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              <KpiCard label="Total" value={selectedKpis.total} />
              <KpiCard label="En cours" value={selectedKpis.open} accent="amber" />
              <KpiCard label="Signées" value={selectedKpis.signed} accent="emerald" />
              <KpiCard label="Conversion" value={formatPercent(selectedKpis.conversionRate)} accent="violet" />
            </div>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                  <tr>
                    <th className="px-4 py-2">Contact</th>
                    <th className="px-4 py-2">Membre</th>
                    <th className="px-4 py-2">Statut</th>
                    <th className="px-4 py-2">Dossier</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReferrals.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="px-4 py-2">
                        {[r.contact.prenom, r.contact.nom].filter(Boolean).join(" ") || "—"}
                        <div className="text-xs text-slate-400">{r.contact.email || r.contact.phone}</div>
                      </td>
                      <td className="px-4 py-2 text-xs">{memberById.get(r.memberId)?.contactName || r.memberId}</td>
                      <td className="px-4 py-2">
                        <select
                          value={r.status}
                          onChange={(e) => updateReferralStatus(r.id, e.target.value as ReferralStatus)}
                          className="text-xs border border-slate-200 rounded px-2 py-1"
                        >
                          {REFERRAL_STATUS_ORDER.map((s) => (
                            <option key={s} value={s}>
                              {REFERRAL_STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">{r.dossierId || "—"}</td>
                    </tr>
                  ))}
                  {!filteredReferrals.length ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                        Aucune recommandation
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>

      {showNewMember ? (
        <Modal title="Nouveau membre réseau" onClose={() => setShowNewMember(false)}>
          <div className="space-y-3">
            <Field label="Nom complet" value={newMember.contactName} onChange={(v) => setNewMember((s) => ({ ...s, contactName: v }))} />
            <Field label="Email" value={newMember.email} onChange={(v) => setNewMember((s) => ({ ...s, email: v }))} />
            <Field label="Téléphone" value={newMember.phone} onChange={(v) => setNewMember((s) => ({ ...s, phone: v }))} />
            <label className="block text-xs font-bold text-slate-500">
              Parrain (optionnel)
              <select
                value={newMember.sponsorId}
                onChange={(e) => setNewMember((s) => ({ ...s, sponsorId: e.target.value }))}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">— Aucun (racine) —</option>
                {members.filter((m) => m.active).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.contactName}
                  </option>
                ))}
              </select>
            </label>
            <Field label="Notes" value={newMember.notes} onChange={(v) => setNewMember((s) => ({ ...s, notes: v }))} />
            <button
              type="button"
              onClick={createMember}
              className="w-full py-2.5 rounded-xl bg-slate-900 text-white font-bold text-sm"
            >
              Créer le membre
            </button>
          </div>
        </Modal>
      ) : null}

      {showNewReferral ? (
        <Modal title="Nouvelle recommandation" onClose={() => setShowNewReferral(false)}>
          <div className="space-y-3">
            <Field label="Prénom" value={newReferral.prenom} onChange={(v) => setNewReferral((s) => ({ ...s, prenom: v }))} />
            <Field label="Nom" value={newReferral.nom} onChange={(v) => setNewReferral((s) => ({ ...s, nom: v }))} />
            <Field label="Email" value={newReferral.email} onChange={(v) => setNewReferral((s) => ({ ...s, email: v }))} />
            <Field label="Téléphone" value={newReferral.phone} onChange={(v) => setNewReferral((s) => ({ ...s, phone: v }))} />
            <Field label="Dossier LCIF (optionnel)" value={newReferral.dossierId} onChange={(v) => setNewReferral((s) => ({ ...s, dossierId: v }))} />
            <button type="button" onClick={createReferral} className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm">
              Enregistrer
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function MemberDetail({
  member,
  portalUrl,
  refUrl,
  joinUrl,
  onCopy,
  onContractStatus,
}: {
  member: NetworkMember;
  portalUrl: string;
  refUrl: string;
  joinUrl: string;
  onCopy: (t: string) => void;
  onContractStatus: (s: NetworkMember["contractStatus"]) => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-slate-900">{member.contactName}</h3>
          <p className="text-sm text-slate-500">{member.email}</p>
        </div>
        <PartnerContractWorkflow contractStatus={member.contractStatus || "none"} semiAutoPreview />
        <div className="flex flex-wrap gap-2 mt-3">
          <button
            type="button"
            onClick={() => onContractStatus("pending")}
            className="text-xs font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50"
          >
            Valider LCIF
          </button>
          <button
            type="button"
            onClick={() => onContractStatus("sent")}
            className="text-xs font-bold px-2.5 py-1.5 rounded-lg border border-indigo-200 text-indigo-800 bg-indigo-50"
          >
            Contrat envoyé
          </button>
          <button
            type="button"
            onClick={() => onContractStatus("signed")}
            className="text-xs font-bold px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white"
          >
            Marquer signé
          </button>
        </div>
      </div>
      <div className="grid sm:grid-cols-3 gap-3 text-xs">
        <LinkRow label="Portail membre" url={portalUrl} onCopy={onCopy} />
        <LinkRow label="Lien client ?ref=" url={refUrl} onCopy={onCopy} />
        <LinkRow label="Lien recrutement" url={joinUrl} onCopy={onCopy} />
      </div>
      <p className="text-[11px] text-slate-400">
        Token ref : <code className="bg-slate-100 px-1 rounded">{member.referralToken}</code> · join :{" "}
        <code className="bg-slate-100 px-1 rounded">{member.joinToken}</code>
      </p>
    </div>
  );
}

function LinkRow({ label, url, onCopy }: { label: string; url: string; onCopy: (t: string) => void }) {
  return (
    <div className="border border-slate-100 rounded-lg p-3">
      <p className="font-bold text-slate-500 mb-1 flex items-center gap-1">
        <Link2 className="w-3 h-3" /> {label}
      </p>
      <p className="truncate text-slate-700 mb-2">{url}</p>
      <button
        type="button"
        onClick={() => onCopy(url)}
        className="inline-flex items-center gap-1 text-indigo-600 font-bold hover:underline"
      >
        <Copy className="w-3 h-3" /> Copier
      </button>
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
        className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-normal text-slate-900"
      />
    </label>
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
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-black text-slate-900">{title}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
