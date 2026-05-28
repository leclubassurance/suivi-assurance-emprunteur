import React, { useCallback, useEffect, useState } from "react";
import { Inbox, TrendingUp, AlertTriangle, Mail, FileWarning, Eye, Euro, Landmark, Wallet, X, BookOpen, RefreshCw, FolderPlus } from "lucide-react";
import { getAccessToken } from "../../lib/auth";
import { showToast } from "../../lib/toast";
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
  action: string;
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
  studiesWithKpi: number;
  totalEconomiesRealiseesLabel: string;
  totalMontantPretsAccompagnesLabel: string;
  totalGainsFraisCourtageLabel: string;
  kpiHelp?: {
    economies: string;
    prets: string;
    courtage: string;
    periodLabel: string;
  };
};

const priorityStyle: Record<string, string> = {
  critical: "border-red-300 bg-red-50",
  high: "border-amber-300 bg-amber-50",
  medium: "border-slate-200 bg-white",
  low: "border-slate-100 bg-slate-50",
};

export function AdminActivityBar({
  metrics,
  onReanalyzeAll,
}: {
  metrics: Metrics | null;
  onReanalyzeAll?: () => void;
}) {
  if (!metrics) return null;

  const businessCards = [
    {
      label: "Économies annoncées",
      sub: `${metrics.studiesWithKpi} étude(s)`,
      value: metrics.totalEconomiesRealiseesLabel,
      help: metrics.kpiHelp?.economies,
      icon: Euro,
    },
    {
      label: "Capitaux accompagnés",
      sub: metrics.kpiHelp?.periodLabel,
      value: metrics.totalMontantPretsAccompagnesLabel,
      help: metrics.kpiHelp?.prets,
      icon: Landmark,
    },
    {
      label: "Courtage LCIF",
      sub: "lu dans les mails d'étude",
      value: metrics.totalGainsFraisCourtageLabel,
      help: metrics.kpiHelp?.courtage,
      icon: Wallet,
    },
  ];

  const opsCards = [
    { label: "Nouveaux", value: metrics.newDossiers, icon: TrendingUp },
    { label: "Escalades", value: metrics.openEscalations, icon: AlertTriangle },
    { label: "Mails client", value: metrics.clientMessages7d, icon: Mail },
    { label: "Docs prêt OK", value: `${metrics.loanDocsOkRate}%`, icon: FileWarning },
  ];

  return (
    <div className="bg-slate-900 text-white p-4 space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <p className="text-[10px] uppercase font-bold text-white/50 tracking-wide">
            Performance commerciale · {metrics.kpiHelp?.periodLabel || "7 jours"}
          </p>
          {onReanalyzeAll && (
            <button
              type="button"
              onClick={onReanalyzeAll}
              className="ml-auto text-[10px] font-bold uppercase tracking-wide text-violet-200 hover:text-white border border-violet-400/50 hover:border-violet-300 rounded-lg px-2.5 py-1 transition"
              title="Réanalyser tous les dossiers avec OCR hybride"
            >
              OCR — tout réanalyser
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {businessCards.map((c) => (
            <div
              key={c.label}
              className="rounded-xl bg-white/10 px-4 py-3 border border-white/10"
              title={c.help}
            >
              <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-white/60">
                <c.icon className="w-3.5 h-3.5 shrink-0" /> {c.label}
              </div>
              <p className="text-2xl font-black mt-1.5">{c.value}</p>
              <p className="text-[11px] text-white/45 mt-1">{c.sub}</p>
            </div>
          ))}
        </div>
      </div>

      <details className="group">
        <summary className="text-[11px] font-bold text-white/50 cursor-pointer list-none flex items-center gap-2">
          <span className="group-open:rotate-90 transition-transform">▸</span>
          Activité opérationnelle (file, mails, qualité docs)
        </summary>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
          {opsCards.map((c) => (
            <div key={c.label} className="rounded-lg bg-white/5 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[9px] uppercase font-bold text-white/50">
                <c.icon className="w-3 h-3" /> {c.label}
              </div>
              <p className="text-lg font-black mt-0.5">{c.value}</p>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

export function AdminWorkQueuePanel({
  onSelect,
  selectedId,
  authHeaders,
}: {
  onSelect: (id: string) => void;
  selectedId?: string;
  authHeaders: (json?: boolean) => Promise<HeadersInit>;
}) {
  const [items, setItems] = useState<WorkQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissing, setDismissing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl("/api/admin/work-queue"), {
        headers: await authHeaders(false),
      });
      const data = await res.json();
      setItems(data.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  const dismissItem = async (item: WorkQueueItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const key = `${item.dossierId}-${item.kind}`;
    setDismissing(key);
    try {
      const res = await fetch(getApiUrl(`/api/admin/work-queue/${item.dossierId}/dismiss`), {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ kind: item.kind }),
      });
      if (res.ok) {
        setItems((prev) => prev.filter((i) => !(i.dossierId === item.dossierId && i.kind === item.kind)));
        showToast("Notification retirée de la file.", "success");
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || "Impossible de masquer cette notification.", "error");
      }
    } catch {
      showToast("Erreur réseau.", "error");
    } finally {
      setDismissing(null);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="w-full lg:w-80 shrink-0 border-r border-slate-200 bg-slate-50 flex flex-col max-h-[calc(100vh-120px)]">
      <div className="p-4 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-2 font-black text-slate-800 text-sm">
          <Inbox className="w-4 h-4" /> File « À traiter »
        </div>
        <p className="text-[11px] text-slate-500 mt-1">Triée par priorité</p>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
        {loading && <p className="text-xs text-slate-400 p-2">Chargement…</p>}
        {!loading && items.length === 0 && (
          <p className="text-xs text-slate-500 p-2">Rien en attente.</p>
        )}
        {items.map((item) => (
          <div
            key={`${item.dossierId}-${item.kind}`}
            className={`relative rounded-xl border transition-all ${priorityStyle[item.priority] || priorityStyle.medium} ${
              selectedId === item.dossierId ? "ring-2 ring-indigo-400" : ""
            }`}
          >
            <button
              type="button"
              onClick={(e) => dismissItem(item, e)}
              disabled={dismissing === `${item.dossierId}-${item.kind}`}
              className="absolute top-2 right-2 z-10 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white/80 transition"
              title="Retirer de la file"
              aria-label="Retirer de la file"
            >
              <X className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onSelect(item.dossierId)}
              className="w-full text-left p-3 pr-10"
            >
              <p className="text-[11px] font-bold text-slate-500">{item.clientName}</p>
              <p className="text-sm font-bold text-slate-900 mt-0.5">{item.title}</p>
              <p className="text-[11px] text-slate-600 mt-1 line-clamp-2">{item.detail}</p>
            </button>
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
      const data = await res.json();
      setMetrics(data);
    } catch {
      setMetrics(null);
    }
  }, []);

  useEffect(() => {
    loadMetrics();
    const t = setInterval(loadMetrics, 120_000);
    return () => clearInterval(t);
  }, [loadMetrics]);

  return { metrics, reloadMetrics: loadMetrics };
}

export function AdminCamilleKnowledgePanel() {
  const [status, setStatus] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl("/api/admin/camille-knowledge/status"));
      setStatus(await res.json());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const authHeaders = (): HeadersInit => {
    const t = getAccessToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
  };

  const setupFolder = async () => {
    setBusy(true);
    try {
      const res = await fetch(getApiUrl("/api/admin/camille-knowledge/setup"), {
        method: "POST",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data.folderId) {
        await navigator.clipboard.writeText(data.envLine || "");
        (window as any).showAppToast?.(
          data.created
            ? "Dossier créé — ID copié pour Railway (CAMILLE_KNOWLEDGE_DRIVE_FOLDER_ID)."
            : "Dossier trouvé — ID copié pour Railway.",
          "success",
        );
        if (data.webViewLink) window.open(data.webViewLink, "_blank", "noopener,noreferrer");
      } else {
        (window as any).showAppToast?.(data.error || "Échec création dossier", "error");
      }
      await loadStatus();
    } catch {
      (window as any).showAppToast?.("Erreur création dossier Drive", "error");
    } finally {
      setBusy(false);
    }
  };

  const syncDocs = async () => {
    setBusy(true);
    try {
      const res = await fetch(getApiUrl("/api/admin/camille-knowledge/sync"), {
        method: "POST",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data.success !== false) {
        (window as any).showAppToast?.(
          `${data.fileCount ?? 0} fichier(s) indexé(s) pour Camille.`,
          "success",
        );
      } else {
        (window as any).showAppToast?.(data.error || "Sync échouée", "error");
      }
      await loadStatus();
    } catch {
      (window as any).showAppToast?.("Erreur synchronisation", "error");
    } finally {
      setBusy(false);
    }
  };

  const cache = status?.cache;

  return (
    <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-100 space-y-3">
      <div className="flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-indigo-800" />
        <p className="text-xs font-black text-indigo-900">Documentation Camille (Drive)</p>
      </div>
      <p className="text-[11px] text-indigo-800 leading-relaxed">
        Dossier <strong>Documentation Camille</strong> pour vos fiches produits PDF. FAQ métier déjà intégrée
        dans l&apos;app ; les PDF complètent les réponses clients.
      </p>
      {cache && (
        <p className="text-[10px] text-indigo-700">
          Dernière sync : {cache.syncedAt?.slice(0, 16) || "—"} · {cache.fileCount ?? 0} fichier(s)
          {status?.configuredFolderId ? ` · ID configuré` : " · ID à définir sur Railway"}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={setupFolder}
          className="text-[11px] font-bold px-3 py-2 rounded-lg bg-indigo-700 text-white flex items-center gap-1.5 disabled:opacity-50"
        >
          <FolderPlus className="w-3.5 h-3.5" /> Créer / ouvrir dossier Drive
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={syncDocs}
          className="text-[11px] font-bold px-3 py-2 rounded-lg border border-indigo-300 bg-white text-indigo-900 flex items-center gap-1.5 disabled:opacity-50"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Synchroniser
        </button>
      </div>
    </div>
  );
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
        const c = await cRes.json();
        const a = await aRes.json();
        if (!cancelled) {
          setCtx(c);
          setAudit(a.entries || []);
        }
      } catch {
        if (!cancelled) setCtx(null);
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

  const sk = (dossier as any).studyKpi;

  return (
    <div className="space-y-4">
      {sk && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950">
          <p className="font-black mb-1">KPI mail d&apos;étude (Gmail)</p>
          <p>Économie brute : <strong>{sk.grossSavingsEur} €</strong></p>
          <p>Courtage : <strong>{sk.feesCourtageEur} €</strong> · Capital prêt : <strong>{sk.loanCapitalEur} €</strong></p>
        </div>
      )}

      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
        <p className="text-xs font-black text-slate-800 mb-1">Page de suivi client (lien personnel)</p>
        <p className="text-[11px] text-slate-600 leading-relaxed mb-3">
          Le client voit une page sobre avec logo LCIF, statut, étapes et documents — sans compte.
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href="/apercu-suivi-client"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-bold px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 flex items-center gap-1.5"
          >
            <Eye className="w-3.5 h-3.5" /> Démo publique
          </a>
          <button
            type="button"
            onClick={() => setShowPortalPreview(true)}
            className="text-[11px] font-bold px-3 py-2 rounded-lg bg-[#1E3A8A] text-white flex items-center gap-1.5"
          >
            <Eye className="w-3.5 h-3.5" /> Aperçu ce dossier
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
