import React, { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { showToast } from "../../lib/toast";
import { adminFetch } from "../../lib/adminApi";
import type { Dossier } from "../../types";

type SubscriptionView = {
  studySent: boolean;
  effectivePhase: string | null;
  effectivePhaseLabel: string | null;
  manualPhase: string | null;
  options: { value: string; label: string }[];
  dossierStatus: string;
};

const CRM_STATUS_OPTIONS = [
  { value: "PROSPECT", label: "PROSPECT (pré-formulaire)" },
  { value: "NOUVEAU", label: "NOUVEAU" },
  { value: "EN_COURS", label: "EN COURS D'ÉTUDE" },
  { value: "EN_ATTENTE_CLIENT", label: "ATTENTE REPONSE CLIENT" },
  { value: "MAIL_ENVOYÉ", label: "MAIL ENVOYÉ (étude)" },
  { value: "DECISION_EN_ATTENTE", label: "DÉCISION EN ATTENTE" },
  { value: "ADHESION_EN_COURS", label: "ADHÉSION EN COURS" },
  { value: "TRAITÉ", label: "TRAITÉ" },
  { value: "REFUSÉ", label: "REFUSÉ / SANS SUITE" },
] as const;

export default function AdminDossierBannerControls({
  dossier,
  onStatusChange,
  onPhaseUpdated,
  onDelete,
}: {
  dossier: Dossier;
  onStatusChange: (id: string, status: string) => void;
  onPhaseUpdated?: () => void;
  onDelete: (id: string) => void;
}) {
  const [view, setView] = useState<SubscriptionView | null>(null);
  const [phase, setPhase] = useState("");
  const [savingPhase, setSavingPhase] = useState(false);

  const loadPhase = useCallback(async () => {
    const res = await adminFetch(`/api/admin/dossiers/${dossier.id}/subscription-progress`);
    if (!res.ok) {
      setView(null);
      return;
    }
    const json = (await res.json()) as SubscriptionView;
    setView(json);
    setPhase(json.effectivePhase || json.manualPhase || "awaiting_decision");
  }, [dossier.id]);

  useEffect(() => {
    loadPhase().catch(() => undefined);
  }, [loadPhase]);

  const savePhase = async (nextPhase: string) => {
    if (!nextPhase) return;
    setSavingPhase(true);
    try {
      const res = await adminFetch(`/api/admin/dossiers/${dossier.id}/subscription-progress`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: nextPhase }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || "Échec enregistrement", "error");
        return;
      }
      if (json.dossierStatus) {
        (dossier as Dossier & { status: string }).status = json.dossierStatus;
      }
      showToast("Phase mise à jour — Camille et le portail client sont synchronisés", "success");
      await loadPhase();
      onPhaseUpdated?.();
    } catch {
      showToast("Erreur réseau", "error");
    } finally {
      setSavingPhase(false);
    }
  };

  const phaseDisabled = !view?.studySent;

  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-end gap-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-700">
          Phase souscription
        </span>
        <select
          value={phase}
          disabled={phaseDisabled || savingPhase || !view}
          title={
            phaseDisabled
              ? "Disponible après envoi de l'étude"
              : "Ex. espace adhésion envoyé — visible par Camille et le portail client"
          }
          onChange={async (e) => {
            const next = e.target.value;
            setPhase(next);
            await savePhase(next);
          }}
          className="bg-white border-2 border-indigo-200 text-sm rounded-lg px-3 py-2 font-bold cursor-pointer hover:border-indigo-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-w-[220px]"
        >
          {!view && <option value="">Chargement…</option>}
          {phaseDisabled && view && (
            <option value="">Étude non envoyée</option>
          )}
          {view?.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {view?.effectivePhaseLabel && !phaseDisabled && (
          <span className="text-[10px] text-slate-500 max-w-[240px] text-right leading-tight">
            Actif : {view.effectivePhaseLabel}
          </span>
        )}
      </div>

      <div className="flex flex-col items-end gap-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
          Statut dossier
        </span>
        <select
          value={dossier.status}
          onChange={(e) => onStatusChange(dossier.id, e.target.value)}
          className="bg-white border-2 border-slate-200 text-sm rounded-lg px-3 py-2 font-bold cursor-pointer hover:border-indigo-300 transition-colors min-w-[200px]"
        >
          {CRM_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={() => onDelete(dossier.id)}
        className="flex justify-center items-center bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 transition w-10 h-10 rounded-lg border border-red-200 mt-5"
        title="Supprimer définitivement"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}
