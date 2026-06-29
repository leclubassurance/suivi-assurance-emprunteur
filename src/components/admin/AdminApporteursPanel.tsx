import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Copy,
  Link2,
  Plus,
  RefreshCw,
  UserPlus,
  Users,
} from "lucide-react";
import { adminFetch } from "../../lib/adminApi";
import type { Apporteur, ApporteurType, Referral, ReferralStatus } from "../../../shared/apporteurTypes";
import {
  APPORTEUR_TYPE_LABELS,
  REFERRAL_STATUS_LABELS,
  REFERRAL_STATUS_ORDER,
} from "../../../shared/apporteurTypes";

type Props = {
  onBack: () => void;
  onOpenDossier?: (dossierId: string) => void;
};

const EMPTY_APPORTEUR = {
  companyName: "",
  contactName: "",
  email: "",
  phone: "",
  type: "agent_immo" as ApporteurType,
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

export default function AdminApporteursPanel({ onBack, onOpenDossier }: Props) {
  const [loading, setLoading] = useState(true);
  const [apporteurs, setApporteurs] = useState<Apporteur[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [summary, setSummary] = useState<Record<string, number | string> | null>(null);
  const [selectedApporteurId, setSelectedApporteurId] = useState<string | "all">("all");
  const [showNewApporteur, setShowNewApporteur] = useState(false);
  const [showNewReferral, setShowNewReferral] = useState(false);
  const [newApporteur, setNewApporteur] = useState({ ...EMPTY_APPORTEUR });
  const [newReferral, setNewReferral] = useState({ ...EMPTY_REFERRAL });
  const [error, setError] = useState<string | null>(null);
  const [publicBaseUrl, setPublicBaseUrl] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch("/api/admin/apporteurs");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Chargement impossible");
      setApporteurs(data.apporteurs || []);
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

  const filteredReferrals = useMemo(() => {
    if (selectedApporteurId === "all") return referrals;
    return referrals.filter((r) => r.apporteurId === selectedApporteurId);
  }, [referrals, selectedApporteurId]);

  const apporteurById = useMemo(() => {
    const map = new Map<string, Apporteur>();
    for (const a of apporteurs) map.set(a.id, a);
    return map;
  }, [apporteurs]);

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

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex flex-wrap justify-between items-center gap-3">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-slate-500 hover:text-slate-800 mb-1"
          >
            ← Retour aux dossiers
          </button>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-600" />
            Apporteurs d&apos;affaires
          </h1>
          {summary ? (
            <p className="text-xs text-slate-500 mt-1">
              {summary.apporteurs} apporteur(s) · {summary.openReferrals} recommandation(s) ouverte(s)
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowNewApporteur(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700"
          >
            <Plus className="w-4 h-4" /> Nouvel apporteur
          </button>
          <button
            type="button"
            onClick={() => setShowNewReferral(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-bold hover:bg-slate-50"
          >
            <UserPlus className="w-4 h-4" /> Recommandation
          </button>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-bold hover:bg-slate-50"
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

      <div className="flex flex-1 overflow-hidden">
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
              <div className="text-xs text-slate-500 mt-1">{a.contactName} · {APPORTEUR_TYPE_LABELS[a.type]}</div>
              <div className="text-[11px] text-slate-400 mt-1 font-mono">ref={a.referralToken}</div>
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
                return (
                  <>
                    <h2 className="text-lg font-black text-slate-900 mb-1">{a.companyName}</h2>
                    <p className="text-sm text-slate-600 mb-3">
                      {a.contactName} — {a.email}
                      {a.phone ? ` · ${a.phone}` : ""}
                    </p>
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
                      <button
                        type="button"
                        onClick={() => onOpenDossier?.(r.dossierId!)}
                        className="font-mono font-bold text-indigo-700 hover:underline"
                      >
                        {r.dossierId}
                      </button>
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
            <Field label="Société / réseau" value={newApporteur.companyName} onChange={(v) => setNewApporteur((s) => ({ ...s, companyName: v }))} />
            <Field label="Contact" value={newApporteur.contactName} onChange={(v) => setNewApporteur((s) => ({ ...s, contactName: v }))} />
            <Field label="Email" value={newApporteur.email} onChange={(v) => setNewApporteur((s) => ({ ...s, email: v }))} />
            <Field label="Téléphone" value={newApporteur.phone} onChange={(v) => setNewApporteur((s) => ({ ...s, phone: v }))} />
            <label className="text-xs font-bold text-slate-600">
              Type
              <select
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                value={newApporteur.type}
                onChange={(e) => setNewApporteur((s) => ({ ...s, type: e.target.value as ApporteurType }))}
              >
                {Object.entries(APPORTEUR_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-600">
              Notes
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
