import React, { useEffect, useState } from "react";
import { Loader2, Mail, Shield } from "lucide-react";
import { getApiUrl } from "../../lib/utils";
import LcifPartnerHeader, { LcifPartnerFooter } from "./LcifPartnerHeader";

const ERROR_LABELS: Record<string, string> = {
  cooldown: "Veuillez patienter avant de redemander un lien.",
  send_failed: "Envoi impossible — réessayez dans quelques minutes.",
  invalid_or_expired: "Ce lien a expiré ou n'est plus valide. Demandez un nouveau lien.",
  invalid_token: "Lien invalide.",
  no_portal: "Espace non configuré — contactez assurance@leclubimmobilier.fr.",
};

export default function ConseillerPortalLoginPage({
  loginToken,
  onAuthenticated,
}: {
  loginToken?: string | null;
  onAuthenticated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(Boolean(loginToken));

  useEffect(() => {
    if (!loginToken) return;
    let cancelled = false;
    (async () => {
      setVerifying(true);
      setError(null);
      try {
        const res = await fetch(
          getApiUrl(`/api/public/conseiller-portal/login/verify?token=${encodeURIComponent(loginToken)}`),
          { credentials: "include" },
        );
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && json.ok) {
          onAuthenticated();
          return;
        }
        setError(
          ERROR_LABELS[String(json.error || "")] ||
            json.message ||
            "Connexion impossible avec ce lien.",
        );
      } catch {
        if (!cancelled) setError("Erreur réseau — réessayez.");
      } finally {
        if (!cancelled) setVerifying(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loginToken, onAuthenticated]);

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes("@")) {
      setError("Saisissez votre email professionnel @leclubimmobilier.fr");
      return;
    }
    if (!trimmed.endsWith("@leclubimmobilier.fr")) {
      setError("Seuls les emails @leclubimmobilier.fr sont acceptés.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(getApiUrl("/api/public/conseiller-portal/login/request"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const json = await res.json().catch(() => ({}));
      if (json.ok) {
        setSent(true);
        setMaskedEmail(json.maskedEmail || trimmed);
      } else if (json.error === "cooldown") {
        setError(`Réessayez dans ${json.cooldownSeconds || 60} secondes.`);
      } else {
        setError(ERROR_LABELS[String(json.error || "")] || "Envoi impossible.");
      }
    } catch {
      setError("Erreur réseau");
    } finally {
      setSubmitting(false);
    }
  };

  if (verifying) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-slate-50">
        <LcifPartnerHeader />
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="text-center text-slate-600">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-indigo-800" />
            <p className="font-semibold">Connexion en cours…</p>
          </div>
        </main>
        <LcifPartnerFooter />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-slate-50">
      <LcifPartnerHeader />
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8">
          <div className="flex justify-center mb-4">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-900 flex items-center justify-center">
              <Shield className="w-7 h-7" />
            </div>
          </div>
          <h1 className="text-xl font-black text-center text-slate-900 mb-1">
            Espace conseiller LCIF
          </h1>
          <p className="text-sm text-center text-slate-500 mb-6 leading-relaxed">
            Connectez-vous avec votre email professionnel. Vous recevrez un lien sécurisé par email.
          </p>

          {sent ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <p className="font-bold mb-1">Email envoyé</p>
              <p>
                Si un compte existe pour <strong>{maskedEmail}</strong>, vous recevrez un lien de
                connexion valable 30 minutes. Vérifiez vos spams.
              </p>
            </div>
          ) : (
            <form onSubmit={handleRequest} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-1.5">
                  Email professionnel
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder="prenom.nom@leclubimmobilier.fr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl pl-10 pr-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                  />
                </div>
              </div>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 rounded-xl bg-[#1E3A8A] text-white font-bold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                Recevoir mon lien de connexion
              </button>
            </form>
          )}

          {loginToken && error ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {error}
              <button
                type="button"
                onClick={() => window.history.replaceState({}, "", "/conseiller")}
                className="block mt-2 font-bold text-indigo-800 underline"
              >
                Demander un nouveau lien
              </button>
            </div>
          ) : null}
        </div>
      </main>
      <LcifPartnerFooter />
    </div>
  );
}
