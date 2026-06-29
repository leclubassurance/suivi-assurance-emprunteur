import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { getApiUrl } from "../lib/utils";
import LcifPartnerHeader, { LcifPartnerFooter } from "../components/portal/LcifPartnerHeader";

export default function NetworkJoinPage({ joinToken }: { joinToken: string }) {
  const [sponsorName, setSponsorName] = useState<string | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [form, setForm] = useState({ contactName: "", email: "", phone: "" });

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(getApiUrl(`/api/public/network-join/${encodeURIComponent(joinToken)}`));
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error("Lien de recrutement invalide.");
        setSponsorName(json.sponsorName || null);
      } catch (e: any) {
        setError(e?.message || "Lien invalide");
      } finally {
        setLoadingMeta(false);
      }
    })();
  }, [joinToken]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(getApiUrl(`/api/public/network-join/${encodeURIComponent(joinToken)}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Inscription impossible");
      setSuccess(true);
    } catch (e: any) {
      setError(e?.message || "Erreur");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingMeta) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[#f4f6fb]">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (error && !sponsorName) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[#f4f6fb] p-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center max-w-md">
          <p className="text-slate-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#f4f6fb] flex flex-col">
      <LcifPartnerHeader partnerName="Réseau LCIF" partnerContact="" partnerTypeLabel="Recrutement" />
      <main className="flex-1 max-w-md mx-auto w-full px-5 py-10">
        {success ? (
          <div className="bg-white rounded-2xl border border-emerald-200 p-8 text-center shadow-sm">
            <h1 className="text-xl font-black text-emerald-800 mb-2">Demande enregistrée</h1>
            <p className="text-sm text-slate-600">
              Le Club Immobilier Français va valider votre inscription et vous envoyer l&apos;accès à votre espace
              membre.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
            <h1 className="text-xl font-black text-slate-900 mb-1">Rejoindre le réseau</h1>
            {sponsorName ? (
              <p className="text-sm text-slate-500 mb-6">
                Invité par <strong>{sponsorName}</strong>
              </p>
            ) : null}
            {error ? <p className="text-sm text-red-600 mb-4">{error}</p> : null}
            <form onSubmit={submit} className="space-y-4">
              <label className="block text-xs font-bold text-slate-500">
                Nom complet
                <input
                  required
                  value={form.contactName}
                  onChange={(e) => setForm((s) => ({ ...s, contactName: e.target.value }))}
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs font-bold text-slate-500">
                Email
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs font-bold text-slate-500">
                Téléphone
                <input
                  value={form.phone}
                  onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))}
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 rounded-xl bg-indigo-600 text-white font-bold text-sm disabled:opacity-50"
              >
                {submitting ? "Envoi…" : "Envoyer ma candidature"}
              </button>
            </form>
          </div>
        )}
      </main>
      <LcifPartnerFooter />
    </div>
  );
}
