import React, { useEffect, useState } from "react";
import { GraduationCap, Loader2, PlayCircle } from "lucide-react";
import { getApiUrl, apiFetch } from "../../lib/utils";
import { adminFetch } from "../../lib/adminApi";
import type { ConseillerFormationParcours } from "../../../shared/conseillerFormations";

type ParcoursView = ConseillerFormationParcours & { available: boolean };

export default function ConseillerFormationSection({
  portalToken,
  sessionAuth = false,
  adminView = false,
}: {
  portalToken: string;
  sessionAuth?: boolean;
  adminView?: boolean;
}) {
  const portalFetch = (path: string, init?: RequestInit) => {
    if (adminView) return adminFetch(path, init);
    if (sessionAuth) return apiFetch(path, init);
    return fetch(getApiUrl(path), init);
  };
  const [parcours, setParcours] = useState<ParcoursView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await portalFetch(
          `/api/apporteur-portal/${encodeURIComponent(portalToken)}/formations`,
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.parcours) {
          setParcours(data.parcours as ParcoursView);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [portalToken]);

  if (loading) {
    return (
      <section className="bg-white rounded-2xl border border-slate-200 p-8 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-800" />
      </section>
    );
  }

  if (!parcours) return null;

  return (
    <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
      <div className="bg-gradient-to-r from-indigo-950 via-[#1E3A8A] to-indigo-800 px-5 py-5 sm:px-6 text-white">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
            <GraduationCap className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-black tracking-tight">{parcours.title}</h2>
            {parcours.description ? (
              <p className="text-sm text-indigo-100/90 mt-1 leading-relaxed max-w-xl">{parcours.description}</p>
            ) : (
              <p className="text-sm text-indigo-100/90 mt-1 leading-relaxed max-w-xl">
                Parcours réservé aux conseillers du Club — votre progression est enregistrée sur Coassemble.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        {parcours.available ? (
          <div className="rounded-xl border border-slate-200 overflow-hidden bg-slate-100 min-h-[360px]">
            <iframe
              title={parcours.title}
              src={parcours.embedUrl}
              className="w-full min-h-[360px] sm:min-h-[480px] border-0 bg-white"
              allow="fullscreen; autoplay; encrypted-media"
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 flex flex-col items-center justify-center text-center p-10 min-h-[240px]">
            <PlayCircle className="w-10 h-10 text-slate-300 mb-3" />
            <p className="text-sm font-semibold text-slate-600">Parcours en cours de publication</p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">
              L&apos;équipe LCIF finalise le lien Coassemble. Revenez prochainement.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
