import React, { useEffect, useState } from "react";
import { X, ExternalLink, Save } from "lucide-react";
import { showToast } from "../../lib/toast";
import { adminFetch } from "../../lib/adminApi";
import { ClientPortalContent, type ClientPortalData } from "../portal/ClientPortalContent";

const PHASE_OPTIONS = [
  { value: "awaiting_decision", label: "En attente décision client" },
  { value: "decision_received", label: "Accord client reçu (auto si mail)" },
  { value: "adhesion_space_sent", label: "Espace adhésion envoyé au client" },
  { value: "completed", label: "Dossier clos" },
];

function normalizePhaseForSelect(phase?: string): string {
  if (!phase) return "awaiting_decision";
  if (phase.startsWith("kereis_")) return "adhesion_space_sent";
  return phase;
}

export default function AdminPortalPreviewModal({
  dossierId,
  onClose,
}: {
  dossierId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<ClientPortalData | null>(null);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [previewRes, linkRes] = await Promise.all([
      adminFetch(`/api/admin/dossiers/${dossierId}/portal-preview`),
      adminFetch(`/api/admin/dossiers/${dossierId}/portal-link`),
    ]);
    if (previewRes.ok) {
      const json = await previewRes.json();
      setData(json);
      setPhase(normalizePhaseForSelect(json.subscriptionPhase || "awaiting_decision"));
    }
    if (linkRes.ok) {
      const link = await linkRes.json();
      setPortalUrl(link.url || null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dossierId]);

  const savePhase = async () => {
    if (!phase) return;
    setSaving(true);
    try {
      const res = await adminFetch(`/api/admin/dossiers/${dossierId}/subscription-progress`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase, note: note.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || "Échec enregistrement", "error");
        return;
      }
      setData(json.portal);
      showToast("Suivi client mis à jour", "success");
    } catch {
      showToast("Erreur réseau", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-slate-100 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[95vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 bg-white border-b">
          <div>
            <p className="text-sm font-black text-slate-900">Aperçu — page client</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Après accord : cochez uniquement « Espace adhésion envoyé » pour faire avancer le client.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {portalUrl && (
              <a
                href={portalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-bold text-indigo-700 flex items-center gap-1 px-3 py-2 rounded-lg bg-indigo-50 hover:bg-indigo-100"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Ouvrir le lien réel
              </a>
            )}
            <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100" aria-label="Fermer">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {!loading && data && (
          <div className="px-5 py-3 bg-white border-b space-y-2">
            <p className="text-[11px] font-bold uppercase text-slate-500">Étape côté client (admin)</p>
            <div className="flex flex-wrap gap-2 items-end">
              <select
                value={phase}
                onChange={(e) => setPhase(e.target.value)}
                className="flex-1 min-w-[200px] text-sm border border-slate-200 rounded-lg px-3 py-2"
              >
                {PHASE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={saving}
                onClick={savePhase}
                className="text-xs font-bold flex items-center gap-1 px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                Enregistrer
              </button>
            </div>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note interne (optionnel)"
              className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2"
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 bg-[#f8f9fb]">
          {loading && <p className="text-center text-sm text-slate-500 py-12">Chargement de l&apos;aperçu…</p>}
          {!loading && data && <ClientPortalContent data={data} />}
        </div>
      </div>
    </div>
  );
}
