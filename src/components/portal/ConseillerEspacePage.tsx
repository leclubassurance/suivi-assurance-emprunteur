import React, { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch, clearConseillerSessionToken } from "../../lib/utils";
import ApporteurPortalPage from "./ApporteurPortalPage";
import LcifPartnerHeader, { LcifPartnerFooter } from "./LcifPartnerHeader";
import PortalErrorBoundary from "./PortalErrorBoundary";

export default function ConseillerEspacePage({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [portalToken, setPortalToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);

  // Stable: évite de relancer /me à chaque render parent (sinon flash / page vide).
  const handleExpired = useCallback(() => {
    clearConseillerSessionToken();
    onSessionExpired();
  }, [onSessionExpired]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setBootError(null);
      try {
        const res = await apiFetch("/api/conseiller-portal/me");
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.ok && data.portalToken) {
          setPortalToken(String(data.portalToken));
          return;
        }
        if (res.status === 401) {
          handleExpired();
          return;
        }
        setBootError(data.error || "Impossible de charger votre espace conseiller.");
        setPortalToken(null);
      } catch {
        if (!cancelled) {
          setBootError("Erreur réseau. Vérifiez votre connexion puis réessayez.");
          setPortalToken(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handleExpired]);

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-slate-50">
        <LcifPartnerHeader
          subtitle="Espace conseiller"
          partnerName="Le Club Immobilier Français"
          partnerContact="…"
          partnerTypeLabel="Conseiller"
        />
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="text-center text-slate-600">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-indigo-800" />
            <p className="font-semibold">Chargement de votre espace…</p>
          </div>
        </main>
        <LcifPartnerFooter />
      </div>
    );
  }

  if (!portalToken) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-slate-50">
        <LcifPartnerHeader
          subtitle="Espace conseiller"
          partnerName="Le Club Immobilier Français"
          partnerContact="…"
          partnerTypeLabel="Conseiller"
        />
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 p-8 text-center shadow-sm space-y-4">
            <p className="text-slate-700 font-medium">{bootError || "Session expirée."}</p>
            <button
              type="button"
              onClick={handleExpired}
              className="inline-flex items-center justify-center rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm px-5 py-3"
            >
              Se reconnecter
            </button>
          </div>
        </main>
        <LcifPartnerFooter />
      </div>
    );
  }

  return (
    <PortalErrorBoundary>
      <ApporteurPortalPage token={portalToken} conseillerSession />
    </PortalErrorBoundary>
  );
}
