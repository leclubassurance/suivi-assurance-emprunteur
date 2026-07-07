import React, { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { getApiUrl, apiFetch } from "../../lib/utils";
import type { ConseillerSubscriptionPackage } from "../../../shared/conseillerSubscription";
import { CONSEILLER_SUBSCRIPTION_STATUS_LABELS } from "../../../shared/conseillerSubscription";

type Borrower = { prenom: string; nom: string; rib: string; identityRef: string };

type Props = {
  portalToken: string;
  referralId: string;
  existing?: ConseillerSubscriptionPackage | null;
  canSubmit: boolean;
  onSubmitted: () => void;
  sessionAuth?: boolean;
  previewToken?: string;
};

export default function ConseillerSubscriptionForm({
  portalToken,
  referralId,
  existing,
  canSubmit,
  onSubmitted,
  sessionAuth = false,
  previewToken,
}: Props) {
  const withPreview = (path: string) => {
    if (!previewToken) return path;
    const sep = path.includes("?") ? "&" : "?";
    return `${path}${sep}lcif_preview=${encodeURIComponent(previewToken)}`;
  };
  const portalFetch = (path: string, init?: RequestInit) => {
    const full = withPreview(path);
    if (previewToken) return fetch(getApiUrl(full), init);
    if (sessionAuth) return apiFetch(full, init);
    return fetch(getApiUrl(full), init);
  };
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creditOfferRef, setCreditOfferRef] = useState(existing?.creditOfferRef || "");
  const [addressLine, setAddressLine] = useState(existing?.addressLine || "");
  const [postalCode, setPostalCode] = useState(existing?.postalCode || "");
  const [city, setCity] = useState(existing?.city || "");
  const [borrowers, setBorrowers] = useState<Borrower[]>(
    existing?.borrowers?.length
      ? existing.borrowers.map((b) => ({
          prenom: b.prenom || "",
          nom: b.nom || "",
          rib: b.rib || "",
          identityRef: b.identityRef || "",
        }))
      : [{ prenom: "", nom: "", rib: "", identityRef: "" }],
  );

  if (existing?.submittedAt && existing.status !== "pending") {
    return (
      <div className="mt-3 pt-3 border-t border-slate-100">
        <p className="text-[11px] font-black uppercase text-violet-600 mb-1">Souscription phase B</p>
        <p className="text-xs text-slate-700">
          Formulaire transmis le {new Date(existing.submittedAt).toLocaleDateString("fr-FR")} —{" "}
          <strong>{CONSEILLER_SUBSCRIPTION_STATUS_LABELS[existing.status]}</strong>
        </p>
        {existing.adminNote ? (
          <p className="text-[11px] text-slate-500 mt-1">Note LCIF : {existing.adminNote}</p>
        ) : null}
      </div>
    );
  }

  if (!canSubmit) return null;

  const updateBorrower = (idx: number, patch: Partial<Borrower>) => {
    setBorrowers((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await portalFetch(
        `/api/apporteur-portal/${encodeURIComponent(portalToken)}/referrals/${encodeURIComponent(referralId)}/conseiller-subscription`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            creditOfferRef,
            addressLine,
            postalCode,
            city,
            borrowers: borrowers.map((b) => ({
              prenom: b.prenom.trim(),
              nom: b.nom.trim(),
              rib: b.rib.trim() || undefined,
              identityRef: b.identityRef.trim() || undefined,
            })),
          }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || json.error || "Envoi impossible");
      onSubmitted();
    } catch (err: any) {
      setError(err?.message || "Erreur");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 pt-3 border-t border-violet-100 space-y-3">
      <div>
        <p className="text-[11px] font-black uppercase text-violet-600">Transmission souscription (phase B)</p>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Le client a accepté — transmettez les informations pour que LCIF finalise la souscription.
        </p>
      </div>
      <label className="block text-xs font-bold text-slate-600">
        Référence offre de crédit
        <input
          className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal"
          value={creditOfferRef}
          onChange={(e) => setCreditOfferRef(e.target.value)}
          required
        />
      </label>
      <label className="block text-xs font-bold text-slate-600">
        Adresse du bien / emprunteur
        <input
          className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal"
          value={addressLine}
          onChange={(e) => setAddressLine(e.target.value)}
          required
        />
      </label>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block text-xs font-bold text-slate-600">
          Code postal
          <input
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal"
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value)}
            required
          />
        </label>
        <label className="block text-xs font-bold text-slate-600">
          Ville
          <input
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm font-normal"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            required
          />
        </label>
      </div>
      {borrowers.map((b, idx) => (
        <div key={idx} className="border border-slate-100 rounded-xl p-3 bg-slate-50/50 space-y-2">
          <p className="text-[10px] font-black uppercase text-slate-400">Emprunteur {idx + 1}</p>
          <div className="grid sm:grid-cols-2 gap-2">
            <input
              className="border rounded-lg px-3 py-2 text-sm"
              placeholder="Prénom"
              value={b.prenom}
              onChange={(e) => updateBorrower(idx, { prenom: e.target.value })}
              required
            />
            <input
              className="border rounded-lg px-3 py-2 text-sm"
              placeholder="Nom"
              value={b.nom}
              onChange={(e) => updateBorrower(idx, { nom: e.target.value })}
              required
            />
          </div>
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm"
            placeholder="RIB (IBAN)"
            value={b.rib}
            onChange={(e) => updateBorrower(idx, { rib: e.target.value })}
          />
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm"
            placeholder="Réf. pièce d'identité (ex. CNI déposée)"
            value={b.identityRef}
            onChange={(e) => updateBorrower(idx, { identityRef: e.target.value })}
          />
        </div>
      ))}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={submitting}
        className="w-full py-2.5 rounded-lg bg-violet-700 text-white font-bold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        Transmettre à LCIF
      </button>
    </form>
  );
}
