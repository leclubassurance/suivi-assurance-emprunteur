import React, { useCallback, useEffect, useState } from "react";
import { GraduationCap, Loader2, Save } from "lucide-react";
import { adminFetch } from "../../lib/adminApi";
import type { ConseillerFormationParcours } from "../../../shared/conseillerFormations";

export default function AdminConseillerFormationsEditor() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [parcours, setParcours] = useState<ConseillerFormationParcours>({
    title: "",
    description: "",
    embedUrl: "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch("/api/admin/conseiller-formations");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Chargement impossible");
      setParcours(data.parcours || data.modules?.[0] || { title: "", description: "", embedUrl: "" });
    } catch (e: any) {
      setError(e?.message || "Erreur");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payload: ConseillerFormationParcours = {
        title: parcours.title.trim(),
        description: parcours.description.trim(),
        embedUrl: parcours.embedUrl.trim(),
      };
      const res = await adminFetch("/api/admin/conseiller-formations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parcours: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Enregistrement impossible");
      setParcours(data.parcours || payload);
      setMessage("Parcours enregistré.");
    } catch (e: any) {
      setError(e?.message || "Erreur");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 py-6">
        <Loader2 className="w-4 h-4 animate-spin" /> Chargement…
      </div>
    );
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-indigo-800" />
            Parcours formation conseillers (Coassemble)
          </h2>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl leading-relaxed">
            Un seul parcours Coassemble regroupant tous les modules. Collez l&apos;URL iframe du parcours
            — Coassemble gère les modules et les accès.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1E3A8A] text-white text-sm font-bold disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Enregistrer
        </button>
      </div>

      {message ? <p className="text-sm text-emerald-700 font-medium">{message}</p> : null}
      {error ? <p className="text-sm text-red-600 font-medium">{error}</p> : null}

      <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/50 space-y-3">
        <div>
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Titre du parcours</label>
          <input
            value={parcours.title}
            onChange={(e) => setParcours((p) => ({ ...p, title: e.target.value }))}
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            placeholder="Ex. Formation assurance emprunteur LCIF"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Introduction</label>
          <textarea
            value={parcours.description}
            onChange={(e) => setParcours((p) => ({ ...p, description: e.target.value }))}
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[88px]"
            placeholder="Quelques lignes pour présenter le parcours au conseiller…"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">
            URL iframe du parcours Coassemble
          </label>
          <input
            value={parcours.embedUrl}
            onChange={(e) => setParcours((p) => ({ ...p, embedUrl: e.target.value }))}
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono"
            placeholder="https://…"
          />
        </div>
      </div>
    </section>
  );
}
