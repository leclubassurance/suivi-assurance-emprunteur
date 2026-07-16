import React, { useEffect, useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { adminFetch } from "../../lib/adminApi";
import type { Apporteur } from "../../../shared/apporteurTypes";
import {
  APPORTEUR_PUBLIC_BIO_MAX,
  APPORTEUR_PUBLIC_TITLE_MAX,
} from "../../../shared/apporteurPublicProfile";
import { Button } from "../ui/Button";

type Draft = {
  enabled: boolean;
  photoUrl: string;
  title: string;
  bio: string;
};

function toDraft(a: Apporteur): Draft {
  const p = a.publicProfile;
  return {
    enabled: Boolean(p?.enabled),
    photoUrl: p?.photoUrl || "",
    title: p?.title || "",
    bio: p?.bio || "",
  };
}

export default function AdminApporteurPublicProfileEditor({
  apporteur,
  onSaved,
}: {
  apporteur: Apporteur;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(apporteur));
  const [saved, setSaved] = useState<Draft>(() => toDraft(apporteur));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const next = toDraft(apporteur);
    setDraft(next);
    setSaved(next);
    setErr(null);
    setMsg(null);
  }, [apporteur.id, apporteur.publicProfile?.updatedAt, apporteur.publicProfile?.enabled]);

  const dirty = useMemo(
    () =>
      draft.enabled !== saved.enabled ||
      draft.photoUrl.trim() !== saved.photoUrl.trim() ||
      draft.title.trim() !== saved.title.trim() ||
      draft.bio.trim() !== saved.bio.trim(),
    [draft, saved],
  );

  const apply = async () => {
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await adminFetch(`/api/admin/apporteurs/${apporteur.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicProfile: {
            enabled: draft.enabled,
            photoUrl: draft.photoUrl.trim() || null,
            title: draft.title.trim() || null,
            bio: draft.bio.trim() || null,
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setErr(json.error || "Échec enregistrement");
        return;
      }
      setSaved({ ...draft });
      setMsg("Profil lien client appliqué.");
      onSaved();
    } catch {
      setErr("Erreur réseau");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
      <p className="text-[11px] font-black uppercase text-slate-400">Profil lien client (bandeau)</p>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={draft.enabled}
          disabled={saving}
          onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
        />
        Afficher sur le lien client
      </label>
      <input
        type="url"
        value={draft.photoUrl}
        disabled={saving}
        onChange={(e) => setDraft((d) => ({ ...d, photoUrl: e.target.value }))}
        placeholder="URL photo https://"
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
      <input
        type="text"
        value={draft.title}
        maxLength={APPORTEUR_PUBLIC_TITLE_MAX}
        disabled={saving}
        onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
        placeholder="Titre (ex. Conseiller immobilier)"
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
      <textarea
        value={draft.bio}
        maxLength={APPORTEUR_PUBLIC_BIO_MAX}
        rows={2}
        disabled={saving}
        onChange={(e) => setDraft((d) => ({ ...d, bio: e.target.value }))}
        placeholder="Bio courte"
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-y"
      />
      {err ? <p className="text-xs text-red-600 font-medium">{err}</p> : null}
      {msg ? <p className="text-xs text-emerald-700 font-medium">{msg}</p> : null}
      <Button type="button" size="sm" onClick={apply} disabled={saving || !dirty} className="inline-flex items-center gap-1.5">
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        Appliquer les modifications
      </Button>
    </div>
  );
}
