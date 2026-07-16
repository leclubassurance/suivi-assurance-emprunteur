import React, { useEffect, useMemo, useState } from "react";
import { Check, Loader2, UserRound } from "lucide-react";
import { getApiUrl, apiFetch } from "../../lib/utils";
import {
  APPORTEUR_PUBLIC_BIO_MAX,
  APPORTEUR_PUBLIC_TITLE_MAX,
  type ApporteurPublicProfile,
} from "../../../shared/apporteurPublicProfile";
import { Button } from "../ui/Button";

type Draft = {
  enabled: boolean;
  photoUrl: string;
  title: string;
  bio: string;
};

function toDraft(profile?: ApporteurPublicProfile | null): Draft {
  return {
    enabled: Boolean(profile?.enabled),
    photoUrl: profile?.photoUrl || "",
    title: profile?.title || "",
    bio: profile?.bio || "",
  };
}

function draftsEqual(a: Draft, b: Draft): boolean {
  return (
    a.enabled === b.enabled &&
    a.photoUrl.trim() === b.photoUrl.trim() &&
    a.title.trim() === b.title.trim() &&
    a.bio.trim() === b.bio.trim()
  );
}

export default function PartnerPublicProfileEditor({
  portalToken,
  sessionAuth = false,
  previewToken,
  contactName,
  initialProfile,
  referralLink,
  readOnly,
  onApplied,
}: {
  portalToken: string;
  sessionAuth?: boolean;
  previewToken?: string;
  contactName: string;
  initialProfile?: ApporteurPublicProfile | null;
  referralLink?: string;
  readOnly?: boolean;
  onApplied?: (profile: ApporteurPublicProfile | null) => void;
}) {
  const [saved, setSaved] = useState<Draft>(() => toDraft(initialProfile));
  const [draft, setDraft] = useState<Draft>(() => toDraft(initialProfile));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const next = toDraft(initialProfile);
    setSaved(next);
    setDraft(next);
  }, [
    initialProfile?.updatedAt,
    initialProfile?.enabled,
    initialProfile?.photoUrl,
    initialProfile?.title,
    initialProfile?.bio,
  ]);

  const dirty = useMemo(() => !draftsEqual(draft, saved), [draft, saved]);

  const portalFetch = (path: string, init?: RequestInit) => {
    const full =
      previewToken && !path.includes("lcif_preview=")
        ? `${path}${path.includes("?") ? "&" : "?"}lcif_preview=${encodeURIComponent(previewToken)}`
        : path;
    if (previewToken) return fetch(getApiUrl(full), { ...init, credentials: "include" });
    if (sessionAuth) return apiFetch(full, init);
    return fetch(getApiUrl(full), { ...init, credentials: "include" });
  };

  const apply = async () => {
    if (readOnly) return;
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await portalFetch(
        `/api/apporteur-portal/${encodeURIComponent(portalToken)}/public-profile`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enabled: draft.enabled,
            photoUrl: draft.photoUrl.trim() || null,
            title: draft.title.trim() || null,
            bio: draft.bio.trim() || null,
          }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setErr(json.error || "Impossible d'appliquer les modifications");
        return;
      }
      const next = toDraft(json.publicProfile);
      setSaved(next);
      setDraft(next);
      setMsg(
        next.enabled
          ? "Modifications appliquées — visibles sur votre lien client."
          : "Profil enregistré — bandeau masqué sur le lien client.",
      );
      onApplied?.(json.publicProfile || null);
    } catch {
      setErr("Erreur réseau");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 leading-relaxed">
        Personnalisez ce que vos clients voient en ouvrant votre lien de recommandation. Cliquez sur{" "}
        <strong>Appliquer les modifications</strong> pour publier photo, titre et bio sur la page client.
      </p>

      <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer">
        <input
          type="checkbox"
          className="mt-1"
          checked={draft.enabled}
          disabled={readOnly || saving}
          onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
        />
        <span>
          <span className="font-bold text-slate-900 text-sm block">Afficher mon profil sur le lien client</span>
          <span className="text-xs text-slate-500">
            Si décoché, le lien fonctionne toujours (attribution) mais sans bandeau « Recommandé par ».
          </span>
        </span>
      </label>

      <div className="grid sm:grid-cols-[120px_1fr] gap-4 items-start">
        <div className="flex flex-col items-center gap-2">
          <div className="w-[96px] h-[96px] rounded-full overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center">
            {draft.photoUrl.trim() ? (
              <img
                src={draft.photoUrl.trim()}
                alt=""
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <UserRound className="w-10 h-10 text-slate-300" />
            )}
          </div>
          <span className="text-[10px] text-slate-400 text-center">Aperçu photo</span>
        </div>

        <div className="space-y-3 min-w-0">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              URL photo (https)
            </label>
            <input
              type="url"
              value={draft.photoUrl}
              disabled={readOnly || saving}
              onChange={(e) => setDraft((d) => ({ ...d, photoUrl: e.target.value }))}
              placeholder="https://…"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Collez un lien image public (ex. fichier Drive « Tout utilisateur disposant du lien »).
            </p>
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              Titre ({draft.title.length}/{APPORTEUR_PUBLIC_TITLE_MAX})
            </label>
            <input
              type="text"
              value={draft.title}
              maxLength={APPORTEUR_PUBLIC_TITLE_MAX}
              disabled={readOnly || saving}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="Conseiller immobilier"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              Bio ({draft.bio.length}/{APPORTEUR_PUBLIC_BIO_MAX})
            </label>
            <textarea
              value={draft.bio}
              maxLength={APPORTEUR_PUBLIC_BIO_MAX}
              rows={3}
              disabled={readOnly || saving}
              onChange={(e) => setDraft((d) => ({ ...d, bio: e.target.value }))}
              placeholder="Je vous accompagne pour optimiser l'assurance de votre prêt immobilier…"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-y"
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
        <p className="text-[10px] font-black uppercase tracking-wide text-indigo-700 mb-2">
          Aperçu bandeau client
        </p>
        <div className="flex gap-3 items-start">
          <div className="w-12 h-12 rounded-full overflow-hidden bg-white border border-indigo-100 shrink-0 flex items-center justify-center">
            {draft.photoUrl.trim() ? (
              <img
                src={draft.photoUrl.trim()}
                alt=""
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <UserRound className="w-5 h-5 text-indigo-300" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-indigo-600">
              Recommandé par
            </p>
            <p className="font-bold text-slate-900">{contactName}</p>
            {draft.title.trim() ? (
              <p className="text-xs text-slate-600">{draft.title.trim()}</p>
            ) : null}
            {draft.bio.trim() ? (
              <p className="text-sm text-slate-600 mt-1 leading-snug">{draft.bio.trim()}</p>
            ) : null}
            {!draft.enabled ? (
              <p className="text-[11px] text-amber-700 mt-2 font-medium">
                Bandeau désactivé — non visible tant que vous n&apos;activez pas l&apos;affichage.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {referralLink ? (
        <p className="text-xs text-slate-500">
          Lien concerné :{" "}
          <a
            href={referralLink}
            target="_blank"
            rel="noreferrer"
            className="text-indigo-700 font-bold underline break-all"
          >
            {referralLink}
          </a>
        </p>
      ) : null}

      {err ? <p className="text-sm text-red-600 font-medium">{err}</p> : null}
      {msg ? <p className="text-sm text-emerald-700 font-medium">{msg}</p> : null}

      {!readOnly ? (
        <div className="flex flex-wrap gap-2 items-center">
          <Button type="button" onClick={apply} disabled={saving || !dirty} className="inline-flex items-center gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Appliquer les modifications
          </Button>
          {dirty ? (
            <button
              type="button"
              className="text-sm font-bold text-slate-500 hover:text-slate-800"
              disabled={saving}
              onClick={() => {
                setDraft(saved);
                setErr(null);
                setMsg(null);
              }}
            >
              Annuler
            </button>
          ) : (
            <span className="text-xs text-slate-400">Aucune modification en attente</span>
          )}
        </div>
      ) : (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          Mode consultation — les modifications se font depuis l&apos;espace du conseiller.
        </p>
      )}
    </div>
  );
}
