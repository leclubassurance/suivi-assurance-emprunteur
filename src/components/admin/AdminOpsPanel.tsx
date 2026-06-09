import React, { useCallback, useEffect, useState } from "react";
import {
  Inbox,
  TrendingUp,
  AlertTriangle,
  Mail,
  FileWarning,
  Eye,
  Euro,
  Landmark,
  Wallet,
  X,
  BookOpen,
  RefreshCw,
  FolderPlus,
  FileBarChart,
  Send,
} from "lucide-react";
import { showToast } from "../../lib/toast";
import { getApiUrl } from "../../lib/utils";
import { getAccessToken } from "../../lib/auth";
import type { Dossier } from "../../types";
import AdminPortalPreviewModal from "./AdminPortalPreviewModal";
import AdminSubscriptionProgressPanel from "./AdminSubscriptionProgressPanel";

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

export function AdminOpsDailyReportPanel() {
  const [reportYmd, setReportYmd] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const loadPreview = useCallback(async (ymd?: string) => {
    setBusy(true);
    try {
      const q = ymd ? `?date=${encodeURIComponent(ymd)}&ai=1` : "?ai=1";
      const res = await fetch(getApiUrl(`/api/admin/ops-daily-report${q}`));
      const data = await res.json();
      setPreview(data);
      if (data?.report?.reportYmd) setReportYmd(data.report.reportYmd);
    } catch {
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  const runReport = async (deliver: boolean) => {
    setBusy(true);
    try {
      const res = await fetch(getApiUrl("/api/admin/ops-daily-report/run"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: reportYmd || undefined,
          deliver,
          sendEmail: deliver,
          sendTelegram: deliver,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        (window as any).showAppToast?.(data.error || "Échec rapport ops", "error");
        return;
      }
      (window as any).showAppToast?.(
        deliver
          ? `Rapport ${data.reportYmd} envoyé (${data.incidentCount} incident(s))`
          : `Rapport ${data.reportYmd} régénéré (${data.incidentCount} incident(s))`,
        "success",
      );
      await loadPreview(data.reportYmd);
    } catch {
      (window as any).showAppToast?.("Erreur rapport ops", "error");
    } finally {
      setBusy(false);
    }
  };

  const m = preview?.report?.metrics;
  const incidents = preview?.report?.incidents || [];

  return (
    <div className="p-4 rounded-xl bg-slate-800 border border-slate-700 space-y-3 mb-4 text-white">
      <div className="flex items-center gap-2 flex-wrap">
        <FileBarChart className="w-4 h-4 text-emerald-400" />
        <p className="text-xs font-black text-emerald-100">Rapport ops quotidien</p>
        <input
          type="date"
          value={reportYmd}
          onChange={(e) => setReportYmd(e.target.value)}
          className="ml-auto text-[11px] bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white"
        />
      </div>
      {m && (
        <p className="text-[10px] text-slate-300 leading-relaxed">
          {m.periodLabel} · {m.dossiersWithActivity} dossier(s) actifs · 🔴 {m.incidentsCritical} · 🟠{" "}
          {m.incidentsWarning} · escalades ouvertes {m.openEscalationsEndOfDay}
        </p>
      )}
      {preview?.report?.ai?.executiveSummary && (
        <p className="text-[10px] text-emerald-200/90 leading-relaxed whitespace-pre-wrap border-t border-slate-600 pt-2">
          {preview.report.ai.executiveSummary}
        </p>
      )}
      {incidents.length > 0 && (
        <ul className="text-[10px] text-slate-400 space-y-1 max-h-24 overflow-y-auto">
          {incidents.slice(0, 5).map((inc: any) => (
            <li key={inc.id}>
              <span className="text-slate-200">{inc.dossierId}</span> — {inc.title}
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          disabled={busy}
          onClick={() => loadPreview(reportYmd || undefined)}
          className="text-[10px] font-bold uppercase px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Actualiser
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => runReport(false)}
          className="text-[10px] font-bold uppercase px-3 py-2 rounded-lg bg-emerald-900/60 hover:bg-emerald-800 disabled:opacity-50"
        >
          Régénérer
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => runReport(true)}
          className="text-[10px] font-bold uppercase px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 flex items-center gap-1"
        >
          <Send className="w-3 h-3" /> Envoyer
        </button>
      </div>
    </div>
  );
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

  const setupFolder = async () => {
    setBusy(true);
    try {
      const res = await fetch(getApiUrl("/api/admin/camille-knowledge/setup"), {
        method: "POST",
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

export function AdminCamillePanel({
  dossier,
  onDossierUpdated,
}: {
  dossier: Dossier;
  onDossierUpdated?: () => void;
}) {
  const [ctx, setCtx] = useState<any>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const [showPortalPreview, setShowPortalPreview] = useState(false);
  const [resumingCamille, setResumingCamille] = useState(false);
  const [refreshingKpi, setRefreshingKpi] = useState(false);
  const [studyKpi, setStudyKpi] = useState<any>((dossier as any).studyKpi ?? null);

  useEffect(() => {
    setStudyKpi((dossier as any).studyKpi ?? null);
  }, [dossier]);

  const reloadCamilleContext = useCallback(async () => {
    const [cRes, aRes] = await Promise.all([
      fetch(getApiUrl(`/api/admin/dossiers/${dossier.id}/camille-context`)),
      fetch(getApiUrl(`/api/admin/dossiers/${dossier.id}/ai-audit`)),
    ]);
    const c = await cRes.json();
    const a = await aRes.json();
    setCtx(c);
    setAudit(a.entries || []);
  }, [dossier.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reloadCamilleContext();
        if (cancelled) return;
      } catch {
        if (!cancelled) setCtx(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadCamilleContext]);

  const authHeaders = async () => {
    const token = await getAccessToken();
    return token
      ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" };
  };

  const handleRefreshStudyKpi = async () => {
    setRefreshingKpi(true);
    try {
      const res = await fetch(getApiUrl(`/api/admin/dossiers/${dossier.id}/refresh-study-kpi`), {
        method: "POST",
        headers: await authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        showToast("Impossible de recalculer le KPI (mail d'étude introuvable ou HTML incomplet)", "error");
        return;
      }
      setStudyKpi(data.studyKpi);
      (dossier as any).studyKpi = data.studyKpi;
      showToast(
        `KPI mis à jour : ${data.studyKpi?.grossSavingsEur ?? 0} € économie brute`,
        "success",
      );
      await reloadCamilleContext();
    } catch {
      showToast("Erreur réseau", "error");
    } finally {
      setRefreshingKpi(false);
    }
  };

  const handleResumeCamille = async () => {
    setResumingCamille(true);
    try {
      showToast("Réactivation Camille et relance sur le dernier mail client…", "info");
      const res = await fetch(getApiUrl(`/api/admin/dossiers/${dossier.id}/camille-resume`), {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ reprocessLastInbound: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || "Impossible de réactiver Camille", "error");
        return;
      }
      await reloadCamilleContext();
      showToast(
        data.aiReplies > 0
          ? `Camille a envoyé ${data.aiReplies} réponse(s) au client.`
          : "Camille réactivée. Si rien ne part, cliquez sur « Synchroniser Gmail ».",
        data.aiReplies > 0 ? "success" : "info",
      );
    } catch {
      showToast("Erreur réseau", "error");
    } finally {
      setResumingCamille(false);
    }
  };

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
      <AdminSubscriptionProgressPanel
        dossier={dossier}
        onUpdated={async () => {
          await reloadCamilleContext();
          onDossierUpdated?.();
        }}
      />

      <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950">
        <div className="flex justify-between items-start gap-2 mb-1 flex-wrap">
          <p className="font-black">KPI mail d&apos;étude (Gmail)</p>
          <button
            type="button"
            disabled={refreshingKpi}
            onClick={handleRefreshStudyKpi}
            className="text-[10px] font-bold px-2 py-1 rounded bg-emerald-800 text-white hover:bg-emerald-900 disabled:opacity-50"
          >
            {refreshingKpi ? "…" : "Recalculer"}
          </button>
        </div>
        {studyKpi ? (
          <>
            <p>Économie brute : <strong>{studyKpi.grossSavingsEur} €</strong></p>
            <p>Courtage : <strong>{studyKpi.feesCourtageEur} €</strong> · Capital prêt : <strong>{studyKpi.loanCapitalEur} €</strong></p>
            {studyKpi.confidence && (
              <p className="text-[10px] text-emerald-800 mt-1">Confiance extraction : {studyKpi.confidence}</p>
            )}
          </>
        ) : (
          <p className="text-emerald-800">Aucun KPI extrait — synchronisez Gmail ou envoyez l&apos;étude depuis ce dossier.</p>
        )}
      </div>

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
        <div className="flex justify-between items-start gap-2 mb-2 flex-wrap">
          <p className="text-xs font-black text-violet-900">Ce que Camille sait</p>
          <button
            type="button"
            disabled={resumingCamille}
            onClick={handleResumeCamille}
            className="text-[10px] font-black uppercase tracking-wide px-3 py-1.5 rounded-lg bg-violet-700 text-white hover:bg-violet-800 disabled:opacity-50"
            title="Réactive les réponses automatiques et relance le traitement du dernier mail client (si présent)"
          >
            {resumingCamille ? "En cours…" : "Réactiver Camille"}
          </button>
        </div>
        {ctx.camilleStaffUntil && new Date(ctx.camilleStaffUntil) > new Date() && (
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
            Mode équipe actif jusqu&apos;au {String(ctx.camilleStaffUntil).slice(0, 16).replace("T", " ")} — les
            réponses auto peuvent être suspendues. Utilisez « Réactiver Camille ».
          </p>
        )}
        {ctx.subscriptionPhaseLabel && (
          <p className="text-[11px] font-bold text-violet-900 bg-white/60 rounded-lg px-3 py-2 mb-2 border border-violet-200">
            Phase Camille : {ctx.subscriptionPhaseLabel}
          </p>
        )}
        <pre className="text-[11px] text-violet-950 whitespace-pre-wrap font-sans leading-relaxed">{ctx.summary}</pre>
        <p className="text-xs font-semibold text-violet-800 mt-3">Prochaine étape suggérée</p>
        <p className="text-xs text-violet-700">{ctx.suggestedNextStep}</p>
        {ctx.subscriptionGuidance && (
          <p className="text-[10px] text-violet-600 mt-2 italic border-t border-violet-200 pt-2">
            Conduite Camille : {ctx.subscriptionGuidance}
          </p>
        )}
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
