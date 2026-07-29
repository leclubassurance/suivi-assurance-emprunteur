import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Users } from "lucide-react";
import { adminFetch } from "../../lib/adminApi";
import { showToast } from "../../lib/toast";
import type { Dossier } from "../../types";

type ApporteurOption = {
  id: string;
  contactName?: string;
  contactPrenom?: string;
  contactNom?: string;
  companyName?: string;
  email?: string;
  type?: string;
  active?: boolean;
};

function labelFor(a: ApporteurOption): string {
  const name =
    [a.contactPrenom, a.contactNom].filter(Boolean).join(" ").trim() ||
    String(a.contactName || "").trim() ||
    String(a.companyName || "").trim() ||
    a.email ||
    a.id;
  const company = String(a.companyName || "").trim();
  const suffix = company && company !== name ? ` — ${company}` : "";
  return `${name}${suffix}`;
}

export default function AdminDossierApporteurAttach({
  dossier,
  onAttached,
}: {
  dossier: Dossier;
  onAttached?: () => void;
}) {
  const current = (dossier as Dossier & { apporteur?: { apporteurId?: string; apporteurLabel?: string } })
    .apporteur;
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ApporteurOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState(current?.apporteurId || "");
  const [filter, setFilter] = useState("");

  const loadOptions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/apporteurs");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(json.error || "Impossible de charger les partenaires", "error");
        return;
      }
      const list = (json.apporteurs || []) as ApporteurOption[];
      setOptions(list.filter((a) => a.active !== false));
    } catch {
      showToast("Erreur réseau", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSelectedId(current?.apporteurId || "");
    loadOptions().catch(() => undefined);
  }, [open, current?.apporteurId, loadOptions]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return options;
    return options.filter((a) => labelFor(a).toLowerCase().includes(q) || String(a.email || "").toLowerCase().includes(q));
  }, [options, filter]);

  const attach = async () => {
    if (!selectedId) {
      showToast("Choisissez un conseiller / apporteur", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await adminFetch(`/api/admin/dossiers/${dossier.id}/attach-apporteur`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apporteurId: selectedId, notify: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(json.error || "Rattachement impossible", "error");
        return;
      }
      (dossier as any).apporteur = json.dossier?.apporteur || {
        apporteurId: selectedId,
        apporteurLabel: json.apporteurLabel,
      };
      showToast(
        json.notified
          ? `Rattaché — mail « Dossier ouvert » envoyé à ${json.apporteurLabel || "le partenaire"}`
          : `Rattaché à ${json.apporteurLabel || "le partenaire"}`,
        "success",
      );
      setOpen(false);
      onAttached?.();
    } catch {
      showToast("Erreur réseau", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      {current?.apporteurLabel ? (
        <p className="text-xs font-bold text-indigo-700 inline-flex items-center gap-1 bg-indigo-50 px-2 py-1 rounded-full">
          <Users className="w-3.5 h-3.5" />
          Apporté par {current.apporteurLabel}
        </p>
      ) : (
        <p className="text-xs font-bold text-amber-800 inline-flex items-center gap-1 bg-amber-50 px-2 py-1 rounded-full">
          <Users className="w-3.5 h-3.5" />
          Non rattaché à un conseiller
        </p>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-bold text-indigo-700 hover:text-indigo-900 underline underline-offset-2"
        >
          {current?.apporteurId ? "Changer le conseiller" : "Attribuer un conseiller"}
        </button>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2 max-w-md">
          <p className="text-[11px] font-black uppercase text-slate-500 tracking-wide">
            Rattachement partenaire
          </p>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrer par nom ou email…"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          />
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={loading || saving}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="">{loading ? "Chargement…" : "— Choisir —"}</option>
            {filtered.map((a) => (
              <option key={a.id} value={a.id}>
                {labelFor(a)}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-slate-500">
            Le partenaire reçoit le mail habituel « Dossier ouvert » (comme après un dépôt via son lien ?ref=).
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving || !selectedId}
              onClick={() => void attach()}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold disabled:opacity-50"
            >
              {saving ? "Attribution…" : "Attribuer et notifier"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
