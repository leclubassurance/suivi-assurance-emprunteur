import React, { useEffect, useState } from "react";
import { X, ExternalLink } from "lucide-react";
import { getApiUrl } from "../../lib/utils";
import { ClientPortalContent, type ClientPortalData } from "../portal/ClientPortalContent";

export default function AdminPortalPreviewModal({
  dossierId,
  onClose,
}: {
  dossierId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<ClientPortalData | null>(null);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [previewRes, linkRes] = await Promise.all([
          fetch(getApiUrl(`/api/admin/dossiers/${dossierId}/portal-preview`)),
          fetch(getApiUrl(`/api/admin/dossiers/${dossierId}/portal-link`)),
        ]);
        if (!cancelled && previewRes.ok) setData(await previewRes.json());
        if (!cancelled && linkRes.ok) {
          const link = await linkRes.json();
          setPortalUrl(link.url || null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dossierId]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-slate-100 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[95vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 bg-white border-b">
          <div>
            <p className="text-sm font-black text-slate-900">Aperçu — page client</p>
            <p className="text-xs text-slate-500 mt-0.5">Exactement ce que voit votre client via le lien de suivi.</p>
          </div>
          <div className="flex items-center gap-2">
            {portalUrl && (
              <a
                href={portalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-bold text-indigo-700 flex items-center gap-1 px-3 py-2 rounded-lg bg-indigo-50 hover:bg-indigo-100"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Ouvrir le lien réel
              </a>
            )}
            <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100" aria-label="Fermer">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6 bg-[#f8f9fb]">
          {loading && <p className="text-center text-sm text-slate-500 py-12">Chargement de l&apos;aperçu…</p>}
          {!loading && data && <ClientPortalContent data={data} />}
        </div>
      </div>
    </div>
  );
}
