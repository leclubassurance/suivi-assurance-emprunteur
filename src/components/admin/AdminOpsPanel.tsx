import React, { useCallback, useEffect, useState } from "react";
import { Inbox, TrendingUp, AlertTriangle, Mail, FileWarning, Clock, Eye } from "lucide-react";
import { getApiUrl } from "../../lib/utils";
import type { Dossier } from "../../types";
import AdminPortalPreviewModal from "./AdminPortalPreviewModal";

type WorkQueueItem = {
  dossierId: string;
  clientName: string;
  kind: string;
  priority: string;
  title: string;
  detail: string;
  updatedAt: string;
};

type Metrics = {
  periodDays: number;
  totalDossiers: number;
  newDossiers: number;
  openEscalations: number;
  awaitingClient: number;
  clientMessages7d: number;
  camilleReplies7d: number;
  loanDocsOkRate: number;
  certainDocProblemCount: number;
};

const priorityStyle: Record<string, string> = {
  critical: "border-red-300 bg-red-50",
  high: "border-amber-300 bg-amber-50",
  medium: "border-slate-200 bg-white",
  low: "border-slate-100 bg-slate-50",
};

export function AdminActivityBar({ metrics }: { metrics: Metrics | null }) {
  if (!metrics) return null;
  const cards = [
    { label: "Nouveaux", value: metrics.newDossiers, icon: TrendingUp },
    { label: "Escalades", value: metrics.openEscalations, icon: AlertTriangle },
    { label: "Mails client (7j)", value: metrics.clientMessages7d, icon: Mail },
    { label: "Docs prêt OK", value: `${metrics.loanDocsOkRate}%`, icon: FileWarning },
    { label: "PDF à refaire", value: metrics.certainDocProblemCount, icon: Clock },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4 bg-slate-900 text-white">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl bg-white/10 px-3 py-2">
          <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-white/60">
            <c.icon className="w-3.5 h-3.5" /> {c.label}
          </div>
          <p className="text-xl font-black mt-1">{c.value}</p>
        </div>
      ))}
    </div>
  );
}

export function AdminWorkQueuePanel({
  onSelect,
  selectedId,
}: {
  onSelect: (id: string) => void;
  selectedId?: string;
}) {
  const [items, setItems] = useState<WorkQueueItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl("/api/admin/work-queue"));
      const data = await res.json();
      setItems(data.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  const snooze = async (id: string) => {
    await fetch(getApiUrl(`/api/admin/work-queue/${id}/snooze`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours: 24 }),
    });
    load();
  };

  const dismiss = async (id: string) => {
    await fetch(getApiUrl(`/api/admin/work-queue/${id}/dismiss`), { method: "POST" });
    load();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b flex items-center justify-between bg-amber-50">
        <span className="text-xs font-black text-amber-900 flex items-center gap-2">
          <Inbox className="w-4 h-4" /> À traiter ({items.length})
        </span>
        <button type="button" onClick={load} className="text-[10px] font-bold text-amber-800 underline">
          Actualiser
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && <p className="p-4 text-xs text-slate-400">Chargement…</p>}
        {!loading && items.length === 0 && (
          <p className="p-4 text-xs text-slate-500">Rien en attente — bravo.</p>
        )}
        {items.map((item) => (
          <div
            key={`${item.dossierId}-${item.kind}`}
            className={`p-3 border-b cursor-pointer hover:bg-indigo-50/50 ${selectedId === item.dossierId ? "bg-indigo-50" : ""} ${priorityStyle[item.priority] || ""}`}
            onClick={() => onSelect(item.dossierId)}
          >
            <div className="flex justify-between gap-2">
              <span className="font-bold text-sm text-slate-900">{item.title}</span>
              <span className="text-[10px] font-mono uppercase text-slate-500">{item.priority}</span>
            </div>
            <p className="text-xs text-slate-600 mt-1">{item.clientName}</p>
            <p className="text-xs text-slate-500 mt-1 line-clamp-2">{item.detail}</p>
            <p className="text-[10px] font-mono text-slate-400 mt-2">{item.dossierId}</p>
            <div className="flex gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => snooze(item.dossierId)}
                className="text-[10px] font-bold px-2 py-1 rounded bg-white border"
              >
                +24h
              </button>
              <button
                type="button"
                onClick={() => dismiss(item.dossierId)}
                className="text-[10px] font-bold px-2 py-1 rounded bg-white border"
              >
                OK
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function useAdminOpsData() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const loadMetrics = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl("/api/admin/activity-metrics?days=7"));
      if (res.ok) setMetrics(await res.json());
    } catch {
      setMetrics(null);
    }
  }, []);
  useEffect(() => {
    loadMetrics();
    const t = setInterval(loadMetrics, 120000);
    return () => clearInterval(t);
  }, [loadMetrics]);
  return { metrics, reloadMetrics: loadMetrics };
}

export function AdminCamillePanel({ dossier }: { dossier: Dossier }) {
  const [ctx, setCtx] = useState<any>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const [showPortalPreview, setShowPortalPreview] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cRes, aRes] = await Promise.all([
          fetch(getApiUrl(`/api/admin/dossiers/${dossier.id}/camille-context`)),
          fetch(getApiUrl(`/api/admin/dossiers/${dossier.id}/ai-audit`)),
        ]);
        if (!cancelled && cRes.ok) setCtx(await cRes.json());
        if (!cancelled && aRes.ok) {
          const a = await aRes.json();
          setAudit(a.entries || []);
        }
      } catch {
        if (!cancelled) {
          setCtx(null);
          setAudit([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dossier.id]);

  const copyPortal = async () => {
    const res = await fetch(getApiUrl(`/api/admin/dossiers/${dossier.id}/portal-link`));
    const data = await res.json();
    if (data.url) {
      await navigator.clipboard.writeText(data.url);
      (window as any).showAppToast?.("Lien suivi client copié.", "success");
    }
  };

  if (!ctx) return <p className="text-xs text-slate-400">Chargement contexte Camille…</p>;

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
        <p className="text-xs font-black text-slate-800 mb-1">Page de suivi client (lien personnel)</p>
        <p className="text-[11px] text-slate-600 leading-relaxed mb-3">
          Le client voit une page sobre avec logo LCIF, statut, étapes et documents — sans compte. Le lien est
          généré automatiquement (aucun paramétrage secret sur Railway).
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowPortalPreview(true)}
            className="text-[11px] font-bold px-3 py-2 rounded-lg bg-[#111318] text-white flex items-center gap-1.5"
          >
            <Eye className="w-3.5 h-3.5" /> Aperçu client
          </button>
          <button
            type="button"
            onClick={copyPortal}
            className="text-[11px] font-bold px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-800"
          >
            Copier le lien
          </button>
        </div>
      </div>

      {showPortalPreview && (
        <AdminPortalPreviewModal dossierId={dossier.id} onClose={() => setShowPortalPreview(false)} />
      )}

      <div className="p-4 rounded-xl bg-violet-50 border border-violet-100">
        <div className="flex justify-between items-start gap-2 mb-2">
          <p className="text-xs font-black text-violet-900">Ce que Camille sait</p>
        </div>
        <pre className="text-[11px] text-violet-950 whitespace-pre-wrap font-sans leading-relaxed">{ctx.summary}</pre>
        <p className="text-xs font-semibold text-violet-800 mt-3">Prochaine étape suggérée</p>
        <p className="text-xs text-violet-700">{ctx.suggestedNextStep}</p>
      </div>
      {ctx.lastClientMessage && (
        <div className="p-3 rounded-xl bg-slate-50 border text-xs">
          <p className="font-bold text-slate-700">Dernier mail client</p>
          <p className="text-slate-500 mt-1">{ctx.lastClientMessage.subject}</p>
        </div>
      )}
      <div className="p-4 rounded-xl bg-slate-900 text-slate-100">
        <p className="text-xs font-black mb-2">Journal IA (Camille)</p>
        <ul className="space-y-2 max-h-48 overflow-y-auto">
          {audit.length === 0 && <li className="text-[11px] text-slate-400">Aucune entrée.</li>}
          {audit.map((row: any) => (
            <li key={row.id} className="text-[11px] border-b border-white/10 pb-2">
              <span className="text-slate-400">{row.at?.slice(0, 16)}</span> ·{" "}
              <span className="font-bold">{row.action}</span> ({row.outcome})
              <br />
              {row.summary || row.instructionPreview}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
