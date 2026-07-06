import React, { useCallback, useEffect, useState } from "react";
import { GraduationCap, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { adminFetch } from "../../lib/adminApi";
import type { ConseillerFormationModule } from "../../../shared/conseillerFormations";

function emptyModule(order: number): ConseillerFormationModule {
  return {
    id: `formation-${Date.now().toString(36)}`,
    order,
    title: "",
    description: "",
    embedUrl: "",
  };
}

export default function AdminConseillerFormationsEditor() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modules, setModules] = useState<ConseillerFormationModule[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch("/api/admin/conseiller-formations");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Chargement impossible");
      setModules(Array.isArray(data.modules) ? data.modules : []);
    } catch (e: any) {
      setError(e?.message || "Erreur");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const updateModule = (index: number, patch: Partial<ConseillerFormationModule>) => {
    setModules((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  };

  const removeModule = (index: number) => {
    setModules((prev) => prev.filter((_, i) => i !== index).map((m, i) => ({ ...m, order: i + 1 })));
  };

  const addModule = () => {
    setModules((prev) => [...prev, emptyModule(prev.length + 1)]);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payload = modules
        .map((m, index) => ({
          ...m,
          order: index + 1,
          title: m.title.trim(),
          description: m.description.trim(),
          embedUrl: m.embedUrl.trim(),
        }))
        .filter((m) => m.title);
      const res = await adminFetch("/api/admin/conseiller-formations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modules: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Enregistrement impossible");
      setModules(data.modules || payload);
      setMessage("Formations enregistrées.");
    } catch (e: any) {
      setError(e?.message || "Erreur");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 py-6">
        <Loader2 className="w-4 h-4 animate-spin" /> Chargement des formations…
      </div>
    );
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-indigo-800" />
            Formations conseillers (Coassemble)
          </h2>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl leading-relaxed">
            Titres et introductions affichés dans l&apos;espace conseiller. L&apos;accès aux contenus est
            géré par Coassemble — collez l&apos;URL iframe de chaque module.
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

      <div className="space-y-4">
        {modules.map((mod, index) => (
          <div key={mod.id} className="rounded-xl border border-slate-200 p-4 bg-slate-50/50 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-black uppercase text-indigo-800">Module {index + 1}</span>
              <button
                type="button"
                onClick={() => removeModule(index)}
                className="text-slate-400 hover:text-red-600 p-1"
                title="Supprimer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Titre</label>
              <input
                value={mod.title}
                onChange={(e) => updateModule(index, { title: e.target.value })}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                placeholder="Ex. Les fondamentaux de l'assurance emprunteur"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Introduction</label>
              <textarea
                value={mod.description}
                onChange={(e) => updateModule(index, { description: e.target.value })}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[72px]"
                placeholder="Quelques lignes pour expliquer l'objectif du module au conseiller…"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                URL iframe Coassemble
              </label>
              <input
                value={mod.embedUrl}
                onChange={(e) => updateModule(index, { embedUrl: e.target.value })}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono"
                placeholder="https://…"
              />
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addModule}
        className="inline-flex items-center gap-2 text-sm font-bold text-indigo-800 hover:underline"
      >
        <Plus className="w-4 h-4" /> Ajouter un module
      </button>
    </section>
  );
}
