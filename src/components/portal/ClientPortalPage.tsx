import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { getApiUrl } from "../../lib/utils";
import { ClientPortalContent, type ClientPortalData } from "./ClientPortalContent";

export default function ClientPortalPage({ token }: { token: string }) {
  const [data, setData] = useState<ClientPortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(getApiUrl(`/api/portail/${token}`));
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Ce lien de suivi n'est plus valide.");
        if (!cancelled) setData(json);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Impossible d'afficher le suivi.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[#f8f9fb]">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[#f8f9fb] p-6">
        <div className="w-full max-w-md bg-white rounded-[32px] border border-slate-200 p-10 text-center shadow-sm">
          <p className="text-slate-600 text-[15px] leading-relaxed">{error || "Suivi indisponible."}</p>
          <p className="text-slate-400 text-sm mt-4">
            Contactez-nous par email si vous avez besoin d&apos;aide.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#f8f9fb] flex flex-col items-center justify-center py-10 px-4">
      <ClientPortalContent data={data} />
    </div>
  );
}
