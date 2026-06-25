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
  Library,
  Plus,
  Trash2,
} from "lucide-react";
import { showToast } from "../../lib/toast";
import { getAccessToken } from "../../lib/auth";
import { adminFetch } from "../../lib/adminApi";
import type { Dossier } from "../../types";
import AdminPortalPreviewModal from "./AdminPortalPreviewModal";
import AdminSubscriptionProgressPanel from "./AdminSubscriptionProgressPanel";

type GeminiUsageSummary = {
  sinceIso: string;
  totals: {
    totalTokens: number;
    estimatedTotalTokens: number;
    estimatedUsd: number;
    byModel: Record<string, { calls: number; totalTokens: number; estimatedTotalTokens: number; estimatedUsd: number }>;
    byOperation: Record<string, { calls: number; totalTokens: number; estimatedTotalTokens: number; estimatedUsd: number }>;
  };
  events: Array<{
    at: string;
    operation: string;
    model: string;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    estimatedTotalTokens: number | null;
    estimatedUsd: number | null;
  }>;
};

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
  studiesWithKpiInPeriod: number;
  totalEconomiesRealiseesLabel: string;
  totalMontantPretsAccompagnesLabel: string;
  totalGainsFraisCourtageLabel: string;
  periodEconomiesRealiseesLabel: string;
  periodMontantPretsAccompagnesLabel: string;
  periodGainsFraisCourtageLabel: string;
  kpiHelp?: {
    economies: string;
    prets: string;
    courtage: string;
    periodLabel: string;
  };
};

const METRICS_PERIOD_OPTIONS = [
  { days: 7, label: "7 j" },
  { days: 30, label: "30 j" },
  { days: 90, label: "90 j" },
  { days: 3650, label: "Tout" },
] as const;

function periodSubline(
  metrics: Metrics,
  periodField: "periodEconomiesRealiseesLabel" | "periodMontantPretsAccompagnesLabel" | "periodGainsFraisCourtageLabel",
  countInPeriod?: number,
): string {
  const periodLabel = metrics.kpiHelp?.periodLabel || `${metrics.periodDays} jours`;
  if (metrics.periodDays >= 3650) {
    return countInPeriod != null ? `${countInPeriod} étude(s) au total` : periodLabel;
  }
  const periodValue = metrics[periodField];
  const count =
    countInPeriod != null ? `${countInPeriod} étude(s)` : periodLabel;
  return `${count} sur ${periodLabel} · ${periodValue}`;
}

const priorityStyle: Record<string, string> = {
  critical: "border-red-300 bg-red-50",
  high: "border-amber-300 bg-amber-50",
  medium: "border-slate-200 bg-white",
  low: "border-slate-100 bg-slate-50",
};

export function AdminActivityBar({
  metrics,
  metricsPeriodDays = 7,
  onMetricsPeriodChange,
  onReanalyzeAll,
  onRefreshMetrics,
}: {
  metrics: Metrics | null;
  metricsPeriodDays?: number;
  onMetricsPeriodChange?: (days: number) => void;
  onReanalyzeAll?: () => void;
  onRefreshMetrics?: () => void;
}) {
  if (!metrics) return null;

  const businessCards = [
    {
      label: "Économies annoncées",
      sub: periodSubline(metrics, "periodEconomiesRealiseesLabel", metrics.studiesWithKpiInPeriod),
      value: metrics.totalEconomiesRealiseesLabel,
      help: metrics.kpiHelp?.economies,
      icon: Euro,
    },
    {
      label: "Capitaux accompagnés",
      sub: periodSubline(metrics, "periodMontantPretsAccompagnesLabel"),
      value: metrics.totalMontantPretsAccompagnesLabel,
      help: metrics.kpiHelp?.prets,
      icon: Landmark,
    },
    {
      label: "Courtage LCIF",
      sub: periodSubline(metrics, "periodGainsFraisCourtageLabel"),
      value: metrics.totalGainsFraisCourtageLabel,
      help: metrics.kpiHelp?.courtage,
      icon: Wallet,
    },
  ];

  const opsPeriodLabel = metrics.kpiHelp?.periodLabel || `${metrics.periodDays} jours`;
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
            Performance commerciale · cumul dossiers actifs
          </p>
          {onMetricsPeriodChange && (
            <div className="flex items-center gap-1 rounded-lg border border-white/15 p-0.5">
              {METRICS_PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.days}
                  type="button"
                  onClick={() => onMetricsPeriodChange(opt.days)}
                  className={`text-[10px] font-bold uppercase tracking-wide rounded-md px-2 py-1 transition ${
                    metricsPeriodDays === opt.days
                      ? "bg-white/20 text-white"
                      : "text-white/55 hover:text-white hover:bg-white/10"
                  }`}
                  title={`Filtrer l'activité opérationnelle et les sous-totaux sur ${opt.label}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          {onRefreshMetrics && (
            <button
              type="button"
              onClick={onRefreshMetrics}
              className="text-[10px] font-bold uppercase tracking-wide text-white/70 hover:text-white border border-white/20 hover:border-white/40 rounded-lg px-2.5 py-1 transition"
              title="Rafraîchir les totaux KPI"
            >
              Actualiser KPI
            </button>
          )}
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
          Activité opérationnelle ({opsPeriodLabel})
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
      const res = await adminFetch("/api/admin/work-queue", {
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
      const res = await adminFetch(`/api/admin/work-queue/${item.dossierId}/dismiss`, {
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
  const [metricsPeriodDays, setMetricsPeriodDays] = useState(7);
  const loadMetrics = useCallback(async () => {
    try {
      const res = await adminFetch(`/api/admin/activity-metrics?days=${metricsPeriodDays}`);
      const data = await res.json();
      setMetrics(data);
    } catch {
      setMetrics(null);
    }
  }, [metricsPeriodDays]);

  useEffect(() => {
    loadMetrics();
    const t = setInterval(loadMetrics, 120_000);
    return () => clearInterval(t);
  }, [loadMetrics]);

  return {
    metrics,
    reloadMetrics: loadMetrics,
    metricsPeriodDays,
    setMetricsPeriodDays,
  };
}

export function AdminOpsDailyReportPanel() {
  const [reportYmd, setReportYmd] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const loadPreview = useCallback(async (ymd?: string) => {
    setBusy(true);
    try {
      const q = ymd ? `?date=${encodeURIComponent(ymd)}&ai=1` : "?ai=1";
      const res = await adminFetch(`/api/admin/ops-daily-report${q}`);
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
      const res = await adminFetch("/api/admin/ops-daily-report/run", {
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

export function AdminGeminiUsagePanel() {
  const [days, setDays] = useState(14);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<GeminiUsageSummary | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await adminFetch(`/api/admin/gemini-usage?days=${days}`);
      const json = await res.json();
      if (!res.ok) {
        (window as any).showAppToast?.(json?.error || "Échec chargement usage Gemini", "error");
        setData(null);
        return;
      }
      setData(json);
    } catch {
      setData(null);
    } finally {
      setBusy(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const byModel: GeminiUsageSummary["totals"]["byModel"] = data?.totals?.byModel || {};
  const models = Object.entries(byModel)
    .sort((a, b) => (b[1]?.estimatedUsd || 0) - (a[1]?.estimatedUsd || 0))
    .slice(0, 8);

  return (
    <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-3 mb-4">
      <div className="flex items-center gap-2 flex-wrap">
        <BookOpen className="w-4 h-4 text-indigo-600" />
        <p className="text-xs font-black text-slate-900">Usage Gemini (estimations)</p>
        <select
          value={String(days)}
          onChange={(e) => setDays(Number(e.target.value))}
          className="ml-auto text-[11px] bg-white border border-slate-200 rounded px-2 py-1 text-slate-700"
          aria-label="Période"
        >
          <option value="7">7 jours</option>
          <option value="14">14 jours</option>
          <option value="30">30 jours</option>
          <option value="60">60 jours</option>
          <option value="90">90 jours</option>
        </select>
        <button
          type="button"
          disabled={busy}
          onClick={load}
          className="text-[10px] font-bold uppercase px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Actualiser
        </button>
      </div>

      {data ? (
        <>
          <p className="text-[11px] text-slate-500">
            Depuis {new Date(data.sinceIso).toLocaleDateString("fr-FR")} · tokens connus:{" "}
            <strong>{data.totals.totalTokens.toLocaleString("fr-FR")}</strong> · tokens estimés:{" "}
            <strong>{data.totals.estimatedTotalTokens.toLocaleString("fr-FR")}</strong> · coût estimé:{" "}
            <strong>${(data.totals.estimatedUsd || 0).toFixed(2)}</strong>
          </p>

          {models.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {models.map(([model, v]) => (
                <div key={model} className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-black text-slate-800 truncate" title={model}>
                      {model}
                    </p>
                    <p className="text-[11px] font-black text-slate-700">
                      ${(v.estimatedUsd || 0).toFixed(2)}
                    </p>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    {v.calls} appel(s) · est. {v.estimatedTotalTokens.toLocaleString("fr-FR")} tok
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-slate-400">Aucune donnée d'usage enregistrée sur la période.</p>
          )}

          {data.events?.length ? (
            <details className="group">
              <summary className="text-[11px] font-bold text-slate-500 cursor-pointer list-none flex items-center gap-2">
                <span className="group-open:rotate-90 transition-transform">▸</span>
                Derniers appels
              </summary>
              <div className="mt-2 max-h-44 overflow-y-auto text-[10px] text-slate-600 space-y-1">
                {data.events.slice(-30).reverse().map((e, idx) => (
                  <div key={`${e.at}-${idx}`} className="flex items-center justify-between gap-2">
                    <span className="truncate" title={`${e.operation} ${e.model}`}>
                      {new Date(e.at).toLocaleString("fr-FR")} · {e.operation} · {e.model}
                    </span>
                    <span className="shrink-0 text-slate-500">
                      {(e.totalTokens ?? e.estimatedTotalTokens ?? 0).toLocaleString("fr-FR")} tok · $
                      {(e.estimatedUsd ?? 0).toFixed(3)}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </>
      ) : (
        <p className="text-[11px] text-slate-400">Chargement…</p>
      )}
    </div>
  );
}

type PlaybookRow = {
  id: string;
  tags: string[];
  situationSummary: string;
  staffGuidance: string;
  clientMessagePattern: string;
  approvedReplyPlain: string;
  useCount: number;
  approvedAt: string;
};

export function AdminCamillePlaybooksPanel() {
  const [playbooks, setPlaybooks] = useState<PlaybookRow[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [situationSummary, setSituationSummary] = useState("");
  const [staffGuidance, setStaffGuidance] = useState("");
  const [clientPattern, setClientPattern] = useState("");
  const [approvedReply, setApprovedReply] = useState("");
  const [tagsText, setTagsText] = useState("question-client");

  const authHeaders = async () => {
    const token = await getAccessToken();
    return token
      ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" };
  };

  const loadPlaybooks = useCallback(async () => {
    try {
      const res = await adminFetch("/api/admin/camille-playbooks?limit=30");
      const data = await res.json();
      if (data.success) {
        setPlaybooks(data.playbooks || []);
        setTotal(data.total || 0);
      }
    } catch {
      setPlaybooks([]);
    }
  }, []);

  useEffect(() => {
    loadPlaybooks();
  }, [loadPlaybooks]);

  const seedDefaults = async () => {
    setBusy(true);
    try {
      const res = await adminFetch("/api/admin/camille-playbooks/seed-defaults", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ force: false }),
      });
      const data = await res.json();
      const audit = data.audit;
      const errCount = audit?.issues?.filter((i: { severity: string }) => i.severity === "error").length ?? 0;
      showToast(
        data.added > 0
          ? `${data.added} playbook(s) de base ajouté(s) — total ${data.total}`
          : `Playbooks déjà présents (${data.total || total})${errCount ? ` — ${errCount} alerte(s) audit` : ""}`,
        data.added > 0 ? "success" : errCount ? "error" : "info",
      );
      await loadPlaybooks();
    } catch {
      showToast("Erreur chargement playbooks", "error");
    } finally {
      setBusy(false);
    }
  };

  const auditPlaybooks = async () => {
    setBusy(true);
    try {
      const res = await adminFetch("/api/admin/camille-playbooks/audit");
      const data = await res.json();
      if (!data.success) {
        showToast(data.error || "Audit impossible", "error");
        return;
      }
      const errors = (data.issues || []).filter((i: { severity: string }) => i.severity === "error");
      const warns = (data.issues || []).filter((i: { severity: string }) => i.severity === "warn");
      showToast(
        `Audit : ${data.total} playbooks — self-check ${data.selfCheck?.ok ? "OK" : "FAIL"} — ${errors.length} erreur(s), ${warns.length} alerte(s)`,
        errors.length || !data.selfCheck?.ok ? "error" : warns.length ? "info" : "success",
      );
    } catch {
      showToast("Erreur audit playbooks", "error");
    } finally {
      setBusy(false);
    }
  };

  const createPlaybook = async () => {
    if (!situationSummary.trim() || !approvedReply.trim()) {
      showToast("Situation et réponse approuvée requises", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await adminFetch("/api/admin/camille-playbooks", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          situationSummary,
          staffGuidance: staffGuidance || "Consigne équipe",
          clientMessagePattern: clientPattern,
          approvedReplyPlain: approvedReply,
          tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
          approvedBy: "admin",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.error || "Échec création", "error");
        return;
      }
      showToast("Playbook enregistré", "success");
      setShowForm(false);
      setSituationSummary("");
      setStaffGuidance("");
      setClientPattern("");
      setApprovedReply("");
      await loadPlaybooks();
    } catch {
      showToast("Erreur réseau", "error");
    } finally {
      setBusy(false);
    }
  };

  const deletePlaybook = async (id: string) => {
    if (!window.confirm("Supprimer ce playbook ?")) return;
    setBusy(true);
    try {
      const res = await adminFetch(`/api/admin/camille-playbooks/${id}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!res.ok) {
        showToast("Suppression impossible", "error");
        return;
      }
      showToast("Playbook supprimé", "success");
      await loadPlaybooks();
    } catch {
      showToast("Erreur réseau", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 rounded-xl bg-violet-50 border border-violet-100 space-y-3 mb-4">
      <div className="flex items-center gap-2">
        <Library className="w-4 h-4 text-violet-800" />
        <p className="text-xs font-black text-violet-900">Playbooks Camille ({total})</p>
      </div>
      <p className="text-[11px] text-violet-800 leading-relaxed">
        Réponses validées par l&apos;équipe que Camille réutilise automatiquement ou comme modèle IA.
        Ajoutez un cas après chaque bonne réponse — sans repasser par le développeur.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => setShowForm((v) => !v)}
          className="text-[11px] font-bold px-3 py-2 rounded-lg bg-violet-700 text-white flex items-center gap-1.5 disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" /> Nouveau playbook
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={seedDefaults}
          className="text-[11px] font-bold px-3 py-2 rounded-lg border border-violet-300 bg-white text-violet-900 flex items-center gap-1.5 disabled:opacity-50"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Charger modèles de base
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={auditPlaybooks}
          className="text-[11px] font-bold px-3 py-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-950 flex items-center gap-1.5 disabled:opacity-50"
        >
          <AlertTriangle className="w-3.5 h-3.5" /> Vérifier cohérence
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={loadPlaybooks}
          className="text-[11px] font-bold px-3 py-2 rounded-lg border border-violet-200 bg-white text-violet-800"
        >
          Actualiser
        </button>
      </div>
      {showForm && (
        <div className="space-y-2 p-3 rounded-lg bg-white border border-violet-100">
          <input
            className="w-full text-xs border rounded-lg px-2 py-1.5"
            placeholder="Situation (ex. : client demande si l'étude est gratuite)"
            value={situationSummary}
            onChange={(e) => setSituationSummary(e.target.value)}
          />
          <input
            className="w-full text-xs border rounded-lg px-2 py-1.5"
            placeholder="Consigne équipe"
            value={staffGuidance}
            onChange={(e) => setStaffGuidance(e.target.value)}
          />
          <input
            className="w-full text-xs border rounded-lg px-2 py-1.5"
            placeholder="Mots-clés du mail client (ex. : gratuit lemoine documents)"
            value={clientPattern}
            onChange={(e) => setClientPattern(e.target.value)}
          />
          <input
            className="w-full text-xs border rounded-lg px-2 py-1.5"
            placeholder="Tags (virgules) : pre-etude, post-etude, question-client"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
          />
          <textarea
            className="w-full text-xs border rounded-lg px-2 py-1.5 min-h-[90px]"
            placeholder="Réponse approuvée (texte brut)"
            value={approvedReply}
            onChange={(e) => setApprovedReply(e.target.value)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={createPlaybook}
            className="text-[11px] font-bold px-3 py-2 rounded-lg bg-violet-700 text-white"
          >
            Enregistrer
          </button>
        </div>
      )}
      {playbooks.length > 0 && (
        <div className="space-y-2 max-h-56 overflow-y-auto">
          {playbooks.slice(0, 8).map((pb) => (
            <div key={pb.id} className="p-2 rounded-lg bg-white border border-violet-100 text-[10px]">
              <div className="flex justify-between gap-2">
                <span className="font-bold text-violet-900 line-clamp-1">{pb.situationSummary}</span>
                <button
                  type="button"
                  onClick={() => deletePlaybook(pb.id)}
                  className="text-red-600 shrink-0"
                  title="Supprimer"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <p className="text-violet-700 mt-0.5">
                {(pb.tags || []).join(" · ")} — utilisé {pb.useCount || 0}×
              </p>
              <p className="text-violet-400 font-mono text-[9px] mt-0.5 truncate" title={pb.id}>
                {pb.id}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AdminCamilleKnowledgePanel() {
  const [status, setStatus] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await adminFetch("/api/admin/camille-knowledge/status");
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
      const res = await adminFetch("/api/admin/camille-knowledge/setup", {
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
      const res = await adminFetch("/api/admin/camille-knowledge/sync", {
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
  const [savingPlaybook, setSavingPlaybook] = useState(false);
  const [refreshingKpi, setRefreshingKpi] = useState(false);
  const [savingManualKpi, setSavingManualKpi] = useState(false);
  const [showManualKpi, setShowManualKpi] = useState(false);
  const [manualGross, setManualGross] = useState("");
  const [manualCourtage, setManualCourtage] = useState("");
  const [manualCapital, setManualCapital] = useState("");
  const [studyKpi, setStudyKpi] = useState<any>((dossier as any).studyKpi ?? null);

  useEffect(() => {
    const kpi = (dossier as any).studyKpi ?? null;
    setStudyKpi(kpi);
    setManualGross(kpi?.grossSavingsEur != null ? String(kpi.grossSavingsEur) : "");
    setManualCourtage(kpi?.feesCourtageEur != null ? String(kpi.feesCourtageEur) : "");
    setManualCapital(kpi?.loanCapitalEur != null ? String(kpi.loanCapitalEur) : "");
  }, [dossier]);

  const reloadCamilleContext = useCallback(async () => {
    const [cRes, aRes] = await Promise.all([
      adminFetch(`/api/admin/dossiers/${dossier.id}/camille-context`),
      adminFetch(`/api/admin/dossiers/${dossier.id}/ai-audit`),
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
      const res = await adminFetch(`/api/admin/dossiers/${dossier.id}/refresh-study-kpi`, {
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
      onDossierUpdated?.();
    } catch {
      showToast("Erreur réseau", "error");
    } finally {
      setRefreshingKpi(false);
    }
  };

  const handleSaveManualKpi = async () => {
    const gross = Number(String(manualGross).replace(/\s/g, "").replace(",", "."));
    const courtage = Number(String(manualCourtage).replace(/\s/g, "").replace(",", "."));
    const capitalRaw = String(manualCapital).replace(/\s/g, "").replace(",", ".");
    const capital = capitalRaw.trim() ? Number(capitalRaw) : undefined;
    if (!Number.isFinite(gross) || gross < 0) {
      showToast("Économie brute invalide", "error");
      return;
    }
    if (!Number.isFinite(courtage) || courtage < 0) {
      showToast("Courtage invalide", "error");
      return;
    }
    if (capital != null && (!Number.isFinite(capital) || capital < 0)) {
      showToast("Capital prêt invalide", "error");
      return;
    }
    setSavingManualKpi(true);
    try {
      const res = await adminFetch(`/api/admin/dossiers/${dossier.id}/study-kpi`, {
        method: "PATCH",
        headers: await authHeaders(),
        body: JSON.stringify({
          grossSavingsEur: gross,
          feesCourtageEur: courtage,
          loanCapitalEur: capital,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        showToast(data.error || "Impossible d'enregistrer le KPI", "error");
        return;
      }
      setStudyKpi(data.studyKpi);
      (dossier as any).studyKpi = data.studyKpi;
      showToast(`KPI enregistré manuellement : ${gross} €`, "success");
      setShowManualKpi(false);
      await reloadCamilleContext();
      onDossierUpdated?.();
    } catch {
      showToast("Erreur réseau", "error");
    } finally {
      setSavingManualKpi(false);
    }
  };

  const handleSavePlaybookFromLastReply = async () => {
    setSavingPlaybook(true);
    try {
      const res = await fetch(
        getApiUrl(`/api/admin/dossiers/${dossier.id}/save-playbook-from-last-reply`),
        { method: "POST", headers: await authHeaders(), body: JSON.stringify({}) },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        showToast(data.error || "Impossible d'enregistrer le playbook", "error");
        return;
      }
      showToast(`Playbook enregistré (${data.playbook?.id || ""})`, "success");
    } catch {
      showToast("Erreur réseau", "error");
    } finally {
      setSavingPlaybook(false);
    }
  };

  const handleResumeCamille = async () => {
    setResumingCamille(true);
    try {
      showToast("Réactivation Camille et relance sur le dernier mail client…", "info");
      const res = await adminFetch(`/api/admin/dossiers/${dossier.id}/camille-resume`, {
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
    const res = await adminFetch(`/api/admin/dossiers/${dossier.id}/portal-link`);
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
          <p className="font-black">KPI mail d&apos;étude</p>
          <div className="flex gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setShowManualKpi((v) => !v)}
              className="text-[10px] font-bold px-2 py-1 rounded bg-white border border-emerald-400 text-emerald-900 hover:bg-emerald-100"
            >
              {showManualKpi ? "Fermer" : "Saisie manuelle"}
            </button>
            <button
              type="button"
              disabled={refreshingKpi}
              onClick={handleRefreshStudyKpi}
              className="text-[10px] font-bold px-2 py-1 rounded bg-emerald-800 text-white hover:bg-emerald-900 disabled:opacity-50"
            >
              {refreshingKpi ? "…" : "Recalculer"}
            </button>
          </div>
        </div>
        {studyKpi ? (
          <>
            <p>Économie brute : <strong>{studyKpi.grossSavingsEur} €</strong></p>
            <p>Courtage : <strong>{studyKpi.feesCourtageEur} €</strong> · Capital prêt : <strong>{studyKpi.loanCapitalEur} €</strong></p>
            {(studyKpi.confidence || studyKpi.grossSource || studyKpi.source) && (
              <p className="text-[10px] text-emerald-800 mt-1">
                {studyKpi.source === "manual" ? (
                  <span className="font-bold">Saisie manuelle</span>
                ) : (
                  <>
                    Confiance : {studyKpi.confidence || "—"}
                    {studyKpi.grossSource ? ` · source ${studyKpi.grossSource}` : ""}
                  </>
                )}
              </p>
            )}
          </>
        ) : (
          <p className="text-emerald-800">Aucun KPI — utilisez la saisie manuelle ou recalculer après sync Gmail.</p>
        )}
        {showManualKpi && (
          <div className="mt-3 pt-3 border-t border-emerald-200 space-y-2">
            <p className="text-[10px] text-emerald-800">
              Valeurs affichées dans le mail d&apos;étude — prioritaire sur l&apos;extraction auto.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label className="block">
                <span className="text-[10px] font-bold">Économie brute (€)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={manualGross}
                  onChange={(e) => setManualGross(e.target.value)}
                  className="mt-0.5 w-full rounded border border-emerald-300 px-2 py-1.5 text-sm"
                  placeholder="ex. 12500"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold">Courtage LCIF (€)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={manualCourtage}
                  onChange={(e) => setManualCourtage(e.target.value)}
                  className="mt-0.5 w-full rounded border border-emerald-300 px-2 py-1.5 text-sm"
                  placeholder="ex. 990"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold">Capital prêt (€)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={manualCapital}
                  onChange={(e) => setManualCapital(e.target.value)}
                  className="mt-0.5 w-full rounded border border-emerald-300 px-2 py-1.5 text-sm"
                  placeholder="auto si vide"
                />
              </label>
            </div>
            <button
              type="button"
              disabled={savingManualKpi}
              onClick={handleSaveManualKpi}
              className="text-[10px] font-bold px-3 py-2 rounded bg-emerald-900 text-white hover:bg-emerald-950 disabled:opacity-50"
            >
              {savingManualKpi ? "Enregistrement…" : "Enregistrer le KPI"}
            </button>
          </div>
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
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={savingPlaybook}
              onClick={handleSavePlaybookFromLastReply}
              className="text-[10px] font-black uppercase tracking-wide px-3 py-1.5 rounded-lg border border-violet-400 bg-white text-violet-900 hover:bg-violet-100 disabled:opacity-50"
              title="Enregistre la dernière réponse envoyée au client comme playbook réutilisable"
            >
              {savingPlaybook ? "…" : "→ Playbook"}
            </button>
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
