import React, { useCallback, useEffect, useState } from "react";
import { Save } from "lucide-react";
import { showToast } from "../../lib/toast";
import { adminFetch } from "../../lib/adminApi";
import type { Dossier } from "../../types";
import {
  CONSEILLER_SUBSCRIPTION_STATUS_LABELS,
  type ConseillerSubscriptionStatus,
} from "../../../shared/conseillerSubscription";

const STATUS_OPTIONS: ConseillerSubscriptionStatus[] = [
  "pending",
  "infos_recues",
  "souscription_en_cours",
  "souscription_faite",
];

export default function AdminConseillerSubscriptionPanel({
  dossier,
  onUpdated,
}: {
  dossier: Dossier;
  onUpdated?: () => void;
}) {
  const sub = (dossier as any).conseillerSubscription as
    | { status: ConseillerSubscriptionStatus; submittedAt?: string; adminNote?: string }
    | undefined;
  const [status, setStatus] = useState<ConseillerSubscriptionStatus>(sub?.status || "pending");
  const [note, setNote] = useState(sub?.adminNote || "");
  const [saving, setSaving] = useState(false);
  const [visible, setVisible] = useState(Boolean(sub?.submittedAt));

  const checkVisible = useCallback(async () => {
    const apporteurId = String((dossier as any).apporteur?.apporteurId || "").trim();
    if (!apporteurId && !sub?.submittedAt) {
      setVisible(false);
      return;
    }
    if (sub?.submittedAt) {
      setVisible(true);
      return;
    }
    try {
      const res = await adminFetch(`/api/admin/apporteurs?segment=conseiller_club`);
      if (!res.ok) return;
      const json = await res.json();
      const match = (json.apporteurs || []).find((a: any) => a.id === apporteurId);
      setVisible(Boolean(match));
    } catch {
      setVisible(Boolean(sub));
    }
  }, [dossier, sub]);

  useEffect(() => {
    void checkVisible();
  }, [checkVisible]);

  useEffect(() => {
    if (sub) {
      setStatus(sub.status || "pending");
      setNote(sub.adminNote || "");
    }
  }, [sub?.status, sub?.adminNote, sub?.submittedAt]);

  if (!visible) return null;

  const save = async () => {
    setSaving(true);
    try {
      const res = await adminFetch(`/api/admin/dossiers/${dossier.id}/conseiller-subscription`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, adminNote: note }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Échec");
      showToast("Statut souscription conseiller enregistré", "success");
      onUpdated?.();
    } catch (e: any) {
      showToast(e?.message || "Erreur", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 rounded-xl bg-violet-50 border border-violet-200 text-xs text-violet-950 space-y-3">
      <p className="font-black">Souscription conseiller (phase B)</p>
      {sub?.submittedAt ? (
        <p className="text-violet-800">
          Formulaire reçu le {new Date(sub.submittedAt).toLocaleString("fr-FR")} — statut actuel :{" "}
          <strong>{CONSEILLER_SUBSCRIPTION_STATUS_LABELS[sub.status]}</strong>
        </p>
      ) : (
        <p className="text-violet-700">En attente du formulaire conseiller (accord client requis).</p>
      )}
      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg border transition-colors ${
              status === s
                ? "bg-violet-800 text-white border-violet-800"
                : "bg-white border-violet-200 text-violet-900 hover:bg-violet-100"
            }`}
          >
            {CONSEILLER_SUBSCRIPTION_STATUS_LABELS[s]}
          </button>
        ))}
      </div>
      <label className="block font-bold">
        Note interne
        <textarea
          className="mt-1 w-full border border-violet-200 rounded-lg px-2 py-1.5 text-sm font-normal min-h-[56px]"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={saving}
        onClick={save}
        className="inline-flex items-center gap-1.5 text-[10px] font-bold px-3 py-1.5 rounded-lg bg-violet-800 text-white hover:bg-violet-900 disabled:opacity-50"
      >
        <Save className="w-3.5 h-3.5" />
        {saving ? "…" : "Enregistrer"}
      </button>
    </div>
  );
}
