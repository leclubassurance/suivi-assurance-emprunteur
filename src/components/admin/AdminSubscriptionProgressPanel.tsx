import React, { useCallback, useEffect, useState } from "react";
import { Save, Send, CheckCircle2, UserCheck, Flag } from "lucide-react";
import { showToast } from "../../lib/toast";
import { adminFetch } from "../../lib/adminApi";
import type { Dossier } from "../../types";

type SubscriptionView = {
  studySent: boolean;
  clientAccepted: boolean;
  clientAcceptedAt?: string | null;
  clientAcceptedSource?: string | null;
  clientAcceptedNote?: string | null;
  effectivePhase: string | null;
  effectivePhaseLabel: string | null;
  manualPhase: string | null;
  manualUpdatedAt: string | null;
  manualNote: string | null;
  options: { value: string; label: string }[];
  dossierStatus: string;
};

const QUICK_PHASES = [
  {
    value: "awaiting_decision",
    label: "En attente décision",
    icon: UserCheck,
    hint: "Étude envoyée, le client n'a pas encore confirmé",
  },
  {
    value: "decision_received",
    label: "Accord client",
    icon: CheckCircle2,
    hint: "Mail client OU accord oral confirmé par le conseiller / l'équipe",
  },
  {
    value: "adhesion_space_sent",
    label: "Espace adhésion envoyé",
    icon: Send,
    hint: "Lien Kereis / espace adhérent transmis au client",
  },
  {
    value: "completed",
    label: "Dossier clos",
    icon: Flag,
    hint: "Souscription terminée en ligne",
  },
] as const;

export default function AdminSubscriptionProgressPanel({
  dossier,
  onUpdated,
}: {
  dossier: Dossier;
  onUpdated?: () => void;
}) {
  const [view, setView] = useState<SubscriptionView | null>(null);
  const [phase, setPhase] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await adminFetch(`/api/admin/dossiers/${dossier.id}/subscription-progress`);
    if (!res.ok) {
      setView(null);
      return;
    }
    const json = (await res.json()) as SubscriptionView;
    setView(json);
    setPhase(json.effectivePhase || json.manualPhase || "awaiting_decision");
    setNote(json.manualNote || "");
  }, [dossier.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await load();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const savePhase = async (nextPhase?: string, nextNote?: string) => {
    const p = nextPhase || phase;
    if (!p) return;
    setSaving(true);
    try {
      const res = await adminFetch(`/api/admin/dossiers/${dossier.id}/subscription-progress`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phase: p,
          note: (nextNote ?? note).trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || "Échec enregistrement", "error");
        return;
      }
      if (json.subscription) setView(json.subscription);
      if (json.dossierStatus) {
        (dossier as any).status = json.dossierStatus;
      }
      (dossier as any).subscriptionProgress = json.subscription
        ? {
            phase: json.subscription.effectivePhase,
            updatedAt: json.subscription.manualUpdatedAt,
            note: json.subscription.manualNote,
          }
        : (dossier as any).subscriptionProgress;
      showToast("Phase souscription enregistrée — Camille et le portail client sont à jour", "success");
      await load();
      onUpdated?.();
    } catch {
      showToast("Erreur réseau", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-100 text-xs text-indigo-800">
        Chargement phase souscription…
      </div>
    );
  }

  if (!view) {
    return (
      <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
        Impossible de charger la phase souscription.
      </div>
    );
  }

  const disabled = !view.studySent;

  return (
    <div className="p-4 rounded-xl bg-indigo-50 border-2 border-indigo-200 space-y-3">
      <div>
        <p className="text-xs font-black text-indigo-950 uppercase tracking-wide">
          Phase souscription — Camille &amp; portail client
        </p>
        <p className="text-[11px] text-indigo-800 mt-1 leading-relaxed">
          Après l&apos;étude : indiquez l&apos;accord client (mail auto ou oral conseiller). Camille, le portail
          client et le suivi conseiller se synchronisent sur cette phase.
        </p>
      </div>

      {disabled ? (
        <p className="text-xs text-amber-900 bg-amber-100 border border-amber-200 rounded-lg px-3 py-2">
          L&apos;étude n&apos;est pas encore détectée sur ce dossier — les phases post-étude seront disponibles
          après envoi de l&apos;étude (ou synchronisation Gmail).
        </p>
      ) : (
        <>
          <div className="bg-white rounded-lg border border-indigo-100 px-3 py-2 text-xs">
            <p className="text-slate-500">Phase actuelle (effective)</p>
            <p className="font-black text-indigo-950 mt-0.5">
              {view.effectivePhaseLabel || "En attente décision (par défaut)"}
            </p>
            <p className="text-[10px] text-slate-500 mt-1">
              Statut CRM : <strong>{view.dossierStatus}</strong>
              {view.clientAccepted
                ? ` · Accord enregistré${view.clientAcceptedSource ? ` (${view.clientAcceptedSource})` : ""}`
                : " · Pas d'accord enregistré — utilisez « Accord client » ou ADHÉSION EN COURS"}
            </p>
            {view.clientAcceptedNote ? (
              <p className="text-[10px] text-slate-500 mt-1 italic">{view.clientAcceptedNote}</p>
            ) : null}
            {view.manualUpdatedAt && (
              <p className="text-[10px] text-slate-400 mt-1">
                Dernière mise à jour admin : {view.manualUpdatedAt.slice(0, 16).replace("T", " ")}
              </p>
            )}
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase text-indigo-700 mb-2">Raccourcis</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {QUICK_PHASES.map((q) => {
                const Icon = q.icon;
                const active = view.effectivePhase === q.value;
                return (
                  <button
                    key={q.value}
                    type="button"
                    disabled={saving}
                    title={q.hint}
                    onClick={() => savePhase(q.value)}
                    className={`text-left text-[11px] font-bold px-3 py-2.5 rounded-lg border flex items-start gap-2 transition-colors disabled:opacity-50 ${
                      active
                        ? "bg-indigo-700 text-white border-indigo-800"
                        : "bg-white text-indigo-900 border-indigo-200 hover:bg-indigo-100"
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      {q.label}
                      {!active && <span className="block font-normal opacity-80 mt-0.5">{q.hint}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2 pt-1 border-t border-indigo-200">
            <p className="text-[10px] font-bold uppercase text-indigo-700">Réglage fin</p>
            <select
              value={phase}
              onChange={(e) => setPhase(e.target.value)}
              className="w-full text-sm border border-indigo-200 rounded-lg px-3 py-2 bg-white"
            >
              {view.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note interne (ex. lien Kereis envoyé le 09/06 par Charles)"
              className="w-full text-xs border border-indigo-200 rounded-lg px-3 py-2 bg-white"
            />
            <button
              type="button"
              disabled={saving}
              onClick={() => savePhase()}
              className="text-xs font-bold flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-700 text-white hover:bg-indigo-800 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              Enregistrer la phase
            </button>
          </div>
        </>
      )}
    </div>
  );
}
