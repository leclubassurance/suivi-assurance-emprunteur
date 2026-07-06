import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch } from "../../lib/utils";
import ApporteurPortalPage from "./ApporteurPortalPage";
import LcifPartnerHeader, { LcifPartnerFooter } from "./LcifPartnerHeader";

export default function ConseillerEspacePage({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [portalToken, setPortalToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch("/api/conseiller-portal/me");
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.ok && data.portalToken) {
          setPortalToken(String(data.portalToken));
          return;
        }
        onSessionExpired();
      } catch {
        if (!cancelled) onSessionExpired();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onSessionExpired]);

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-slate-50">
        <LcifPartnerHeader />
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

  if (!portalToken) return null;

  return <ApporteurPortalPage token={portalToken} conseillerSession />;
}
