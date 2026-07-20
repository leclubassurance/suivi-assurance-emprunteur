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
  PiggyBank,
  Scale,
  X,
  BookOpen,
  RefreshCw,
  FolderPlus,
  FileBarChart,
  Send,
  Library,
  Plus,
  Trash2,
  Clock,
} from "lucide-react";
import { showToast } from "../../lib/toast";
import { getApiUrl } from "../../lib/utils";
import { getAccessToken } from "../../lib/auth";
import { adminFetch } from "../../lib/adminApi";
import type { Dossier } from "../../types";
import {
  CAMILLE_WEEKDAY_LABELS,
  CAMILLE_WEEKDAY_ORDER,
  normalizeCamilleSchedule,
  type CamilleSchedule,
} from "../../../shared/camilleSchedule";
import AdminPortalPreviewModal from "./AdminPortalPreviewModal";
import AdminSubscriptionProgressPanel from "./AdminSubscriptionProgressPanel";
import AdminConseillerSubscriptionPanel from "./AdminConseillerSubscriptionPanel";
import {
  computeClubRevenueBreakdown,
  KEREIS_MIA_CONTRACT,
  resolveFeesCourtageEur,
} from "../../../shared/kereisMiaRemuneration";
import { resolveAnnualPremiumEur, resolveFeesAssureurEur } from "../../../shared/studyClubEconomics";

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
  totalClubGrossLabel: string;
  totalClubNetLabel: string;
  periodClubGrossLabel: string;
  periodClubNetLabel: string;
  dossiersWithClubRevenue?: number;
  dossiersWithClubRevenueInPeriod?: number;
  kpiHelp?: {
    economies: string;
    prets: string;
    courtage: string;
    clubGross?: string;
    clubNet?: string;
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
  periodField:
    | "periodEconomiesRealiseesLabel"
    | "periodMontantPretsAccompagnesLabel"
    | "periodGainsFraisCourtageLabel"
    | "periodClubGrossLabel"
    | "periodClubNetLabel",
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
    {
      label: "Brut club LCIF",
      sub: metrics.kpiHelp?.clubGross
        ? `${metrics.dossiersWithClubRevenueInPeriod ?? 0} dossier(s) · ${metrics.periodClubGrossLabel}`
        : periodSubline(metrics, "periodClubGrossLabel", metrics.dossiersWithClubRevenueInPeriod),
      value: metrics.totalClubGrossLabel || "0 €",
      help: metrics.kpiHelp?.clubGross,
      icon: PiggyBank,
    },
    {
      label: "Net club LCIF",
      sub: metrics.kpiHelp?.clubNet
        ? `${metrics.dossiersWithClubRevenueInPeriod ?? 0} dossier(s) · ${metrics.periodClubNetLabel}`
        : periodSubline(metrics, "periodClubNetLabel", metrics.dossiersWithClubRevenueInPeriod),
      value: metrics.totalClubNetLabel || "0 €",
      help: metrics.kpiHelp?.clubNet,
      icon: Scale,
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

export function AdminCamilleSchedulePanel() {
  const [schedule, setSchedule] = useState<CamilleSchedule | null>(null);
  const [openNow, setOpenNow] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await adminFetch("/api/admin/camille-schedule");
      const data = await res.json();
      if (data.ok) {
        setSchedule(normalizeCamilleSchedule(data.schedule));
        setOpenNow(Boolean(data.openNow));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (next: CamilleSchedule) => {
    setBusy(true);
    try {
      const res = await adminFetch("/api/admin/camille-schedule", {
        method: "PUT",
        body: JSON.stringify({ schedule: next }),
      });
      const data = await res.json();
      if (data.ok) {
        setSchedule(normalizeCamilleSchedule(data.schedule));
        setOpenNow(Boolean(data.openNow));
        showToast("Horaires de Camille enregistrés.", "success");
      } else {
        showToast(data.error || "Échec de l'enregistrement.", "error");
      }
    } catch {
      showToast("Erreur réseau.", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!schedule) {
    return (
      <div className="bg-white border rounded-xl p-4">
        <p className="text-sm text-slate-400">Chargement des horaires Camille…</p>
      </div>
    );
  }

  const toggleDay = (day: number) => {
    const days = schedule.daysOfWeek.includes(day)
      ? schedule.daysOfWeek.filter((d) => d !== day)
      : [...schedule.daysOfWeek, day].sort((a, b) => a - b);
    setSchedule({ ...schedule, daysOfWeek: days });
  };

  return (
    <div className="bg-white border rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-indigo-700" />
          <h3 className="text-sm font-black text-slate-900">Horaires de Camille</h3>
        </div>
        {openNow !== null && schedule.enabled ? (
          <span
            className={`text-[11px] font-bold px-2 py-1 rounded-full ${
              openNow ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"
            }`}
          >
            {openNow ? "Active maintenant" : "En veille (hors horaires)"}
          </span>
        ) : null}
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed">
        Contrôle quand Camille traite automatiquement les emails entrants (réponses IA / brouillons
        Telegram). Hors de ces horaires, aucun traitement automatique. Fuseau : Europe/Paris.
      </p>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={schedule.enabled}
          onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })}
          className="rounded border-slate-300"
        />
        <span className="text-xs font-bold text-slate-700">
          {schedule.enabled ? "Camille activée" : "Camille en pause (aucun traitement auto)"}
        </span>
      </label>

      <div className={schedule.enabled ? "" : "opacity-40 pointer-events-none"}>
        <p className="text-[11px] font-black uppercase text-slate-400 mb-2">Jours actifs</p>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {CAMILLE_WEEKDAY_ORDER.map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => toggleDay(day)}
              className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg border ${
                schedule.daysOfWeek.includes(day)
                  ? "bg-indigo-700 text-white border-indigo-700"
                  : "bg-white text-slate-500 border-slate-200"
              }`}
            >
              {CAMILLE_WEEKDAY_LABELS[day].slice(0, 3)}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="text-[11px] font-black uppercase text-slate-400 mb-1">Début</p>
            <select
              value={schedule.startHour}
              onChange={(e) => setSchedule({ ...schedule, startHour: Number(e.target.value) })}
              className="text-xs font-bold border rounded-lg px-2 py-1.5 bg-slate-50"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {h}h
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="text-[11px] font-black uppercase text-slate-400 mb-1">Fin</p>
            <select
              value={schedule.endHour}
              onChange={(e) => setSchedule({ ...schedule, endHour: Number(e.target.value) })}
              className="text-xs font-bold border rounded-lg px-2 py-1.5 bg-slate-50"
            >
              {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => (
                <option key={h} value={h}>
                  {h}h
                </option>
              ))}
            </select>
          </div>
          <p className="text-[11px] text-slate-400">
            {schedule.startHour === schedule.endHour
              ? "24h/24 les jours actifs"
              : `${schedule.startHour}h → ${schedule.endHour}h (Paris)`}
          </p>
        </div>
      </div>

      <div className="pt-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => save(schedule)}
          className="text-[11px] font-bold px-3 py-2 rounded-lg bg-indigo-700 text-white flex items-center gap-1.5 disabled:opacity-50"
        >
          <Clock className="w-3.5 h-3.5" /> Enregistrer les horaires
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
  onDossierUpdated?: (opts?: { skipMetrics?: boolean }) => void;
}) {
  const [ctx, setCtx] = useState<any>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const [showPortalPreview, setShowPortalPreview] = useState(false);
  const [resumingCamille, setResumingCamille] = useState(false);
  const [confirmingDraft, setConfirmingDraft] = useState(false);
  const [savingPlaybook, setSavingPlaybook] = useState(false);
  const [refreshingKpi, setRefreshingKpi] = useState(false);
  const [savingManualKpi, setSavingManualKpi] = useState(false);
  const [savingCourtageOnly, setSavingCourtageOnly] = useState(false);
  const [showManualKpi, setShowManualKpi] = useState(false);
  const [manualGross, setManualGross] = useState("");
  const [manualCourtage, setManualCourtage] = useState("");
  const [manualCapital, setManualCapital] = useState("");
  const [manualPremium, setManualPremium] = useState("");
  const [manualFeesAssureur, setManualFeesAssureur] = useState("");
  const [studyKpi, setStudyKpi] = useState<any>((dossier as any).studyKpi ?? null);
  const [changePlan, setChangePlan] = useState<any>((dossier as any).insuranceChangePlan ?? null);
  const [manualChangeDate, setManualChangeDate] = useState("");
  const [savingChangeDate, setSavingChangeDate] = useState(false);
  const [clubRevenueKpi, setClubRevenueKpi] = useState<any>((dossier as any).clubRevenueKpi ?? null);
  const [manualLinearPercent, setManualLinearPercent] = useState("");
  const [defaultLinearPercent, setDefaultLinearPercent] = useState("15");
  const [savingClubRevenue, setSavingClubRevenue] = useState(false);
  const [syncingClubRevenue, setSyncingClubRevenue] = useState(false);
  const [savingDefaultLinearPercent, setSavingDefaultLinearPercent] = useState(false);

  useEffect(() => {
    const kpi = (dossier as any).studyKpi ?? null;
    const plan = (dossier as any).insuranceChangePlan ?? null;
    const club = (dossier as any).clubRevenueKpi ?? null;
    setStudyKpi(kpi);
    setChangePlan(plan);
    setClubRevenueKpi(club);
    setManualChangeDate(plan?.plannedDate ? String(plan.plannedDate).slice(0, 10) : "");
    setManualGross(kpi?.grossSavingsEur != null ? String(kpi.grossSavingsEur) : "");
    setManualCourtage(kpi?.feesCourtageEur != null ? String(kpi.feesCourtageEur) : "");
    setManualCapital(kpi?.loanCapitalEur != null ? String(kpi.loanCapitalEur) : "");
    setManualPremium(kpi?.annualPremiumEur != null ? String(kpi.annualPremiumEur) : "");
    setManualFeesAssureur(kpi?.feesAssureurEur != null ? String(kpi.feesAssureurEur) : "");
    setManualLinearPercent(
      club?.linearCommissionPercent != null ? String(club.linearCommissionPercent) : "",
    );
  }, [dossier]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSyncingClubRevenue(true);
      try {
        const token = await getAccessToken();
        const headers = token
          ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
          : { "Content-Type": "application/json" };
        const res = await adminFetch(`/api/admin/dossiers/${dossier.id}/sync-club-revenue`, {
          method: "POST",
          headers,
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled || !data.ok) return;
        if (data.studyKpi) {
          setStudyKpi(data.studyKpi);
          (dossier as any).studyKpi = data.studyKpi;
        }
        if (data.clubRevenueKpi) {
          setClubRevenueKpi(data.clubRevenueKpi);
          (dossier as any).clubRevenueKpi = data.clubRevenueKpi;
        }
      } catch {
        /* non bloquant */
      } finally {
        if (!cancelled) setSyncingClubRevenue(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dossier.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch("/api/admin/kereis-mia-settings");
        const data = await res.json().catch(() => ({}));
        if (!cancelled && data?.settings?.defaultLinearCommissionPercent != null) {
          setDefaultLinearPercent(String(data.settings.defaultLinearCommissionPercent));
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      if (data.insuranceChangePlan) {
        setChangePlan(data.insuranceChangePlan);
        (dossier as any).insuranceChangePlan = data.insuranceChangePlan;
        setManualChangeDate(String(data.insuranceChangePlan.plannedDate || "").slice(0, 10));
      }
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

  const handleSaveCourtageOnly = async () => {
    const courtage = Number(String(manualCourtage).replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(courtage) || courtage < 0) {
      showToast("Montant de courtage invalide", "error");
      return;
    }
    setSavingCourtageOnly(true);
    try {
      const res = await adminFetch(`/api/admin/dossiers/${dossier.id}/study-kpi`, {
        method: "PATCH",
        headers: await authHeaders(),
        body: JSON.stringify({ feesCourtageEur: courtage }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        showToast(data.error || "Impossible d'enregistrer le courtage", "error");
        return;
      }
      setStudyKpi(data.studyKpi);
      (dossier as any).studyKpi = data.studyKpi;
      showToast(`Frais de courtage enregistrés : ${courtage} €`, "success");
      await reloadCamilleContext();
      onDossierUpdated?.();
    } catch {
      showToast("Erreur réseau", "error");
    } finally {
      setSavingCourtageOnly(false);
    }
  };

  const handleSaveChangeDate = async (clear = false) => {
    setSavingChangeDate(true);
    try {
      const res = await adminFetch(`/api/admin/dossiers/${dossier.id}/insurance-change-plan`, {
        method: "PATCH",
        headers: await authHeaders(),
        body: JSON.stringify({ plannedDate: clear ? null : manualChangeDate || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || "Enregistrement impossible", "error");
        return;
      }
      setChangePlan(data.insuranceChangePlan);
      (dossier as any).insuranceChangePlan = data.insuranceChangePlan;
      if (data.insuranceChangePlan?.plannedDate) {
        setManualChangeDate(String(data.insuranceChangePlan.plannedDate).slice(0, 10));
      }
      showToast(
        clear || !data.insuranceChangePlan
          ? "Date de changement retirée"
          : `Date enregistrée : ${new Date(`${data.insuranceChangePlan.plannedDate}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })} (saisie manuelle)`,
        "success",
      );
      onDossierUpdated?.({ skipMetrics: true });
    } catch {
      showToast("Erreur réseau", "error");
    } finally {
      setSavingChangeDate(false);
    }
  };

  const handleSaveManualKpi = async () => {
    const grossRaw = String(manualGross).replace(/\s/g, "").replace(",", ".");
    const courtageRaw = String(manualCourtage).replace(/\s/g, "").replace(",", ".");
    const premiumRaw = String(manualPremium).replace(/\s/g, "").replace(",", ".");
    const feesAssureurRaw = String(manualFeesAssureur).replace(/\s/g, "").replace(",", ".");
    const grossProvided = grossRaw.trim().length > 0;
    const courtageProvided = courtageRaw.trim().length > 0;
    const premiumProvided = premiumRaw.trim().length > 0;
    const feesAssureurProvided = feesAssureurRaw.trim().length > 0;
    if (!grossProvided && !courtageProvided && !premiumProvided && !feesAssureurProvided) {
      showToast("Renseignez au moins un montant", "error");
      return;
    }
    const gross = grossProvided ? Number(grossRaw) : undefined;
    const courtage = courtageProvided ? Number(courtageRaw) : undefined;
    const premium = premiumProvided ? Number(premiumRaw) : undefined;
    const feesAssureur = feesAssureurProvided ? Number(feesAssureurRaw) : undefined;
    const capitalRaw = String(manualCapital).replace(/\s/g, "").replace(",", ".");
    const capital = capitalRaw.trim() ? Number(capitalRaw) : undefined;
    if (gross != null && (!Number.isFinite(gross) || gross < 0)) {
      showToast("Économie brute invalide", "error");
      return;
    }
    if (courtage != null && (!Number.isFinite(courtage) || courtage < 0)) {
      showToast("Courtage invalide", "error");
      return;
    }
    if (premium != null && (!Number.isFinite(premium) || premium < 0)) {
      showToast("Prime annuelle invalide", "error");
      return;
    }
    if (feesAssureur != null && (!Number.isFinite(feesAssureur) || feesAssureur < 0)) {
      showToast("Frais de dossier invalides", "error");
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
          ...(gross != null ? { grossSavingsEur: gross } : {}),
          ...(courtage != null ? { feesCourtageEur: courtage } : {}),
          ...(premium != null ? { annualPremiumEur: premium } : {}),
          ...(feesAssureur != null ? { feesAssureurEur: feesAssureur } : {}),
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
      showToast(
        courtage != null
          ? `KPI enregistré : ${courtage} € courtage${gross != null ? ` · ${gross} € économie` : ""}`
          : `KPI enregistré : ${gross} €`,
        "success",
      );
      setShowManualKpi(false);
      await reloadCamilleContext();
      onDossierUpdated?.();
    } catch {
      showToast("Erreur réseau", "error");
    } finally {
      setSavingManualKpi(false);
    }
  };

  const handleSaveClubRevenue = async () => {
    const percentRaw = String(manualLinearPercent).replace(/\s/g, "").replace(",", ".");
    const linearCommissionPercent =
      percentRaw.trim().length > 0 ? Number(percentRaw) : undefined;
    if (
      linearCommissionPercent != null &&
      (!Number.isFinite(linearCommissionPercent) ||
        linearCommissionPercent < 0 ||
        linearCommissionPercent > 100)
    ) {
      showToast("Taux linéaire invalide (0–100 %)", "error");
      return;
    }
    setSavingClubRevenue(true);
    try {
      const res = await adminFetch(`/api/admin/dossiers/${dossier.id}/club-revenue-kpi`, {
        method: "PATCH",
        headers: await authHeaders(),
        body: JSON.stringify({
          linearCommissionPercent: linearCommissionPercent ?? null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        showToast(data.error || "Impossible d'enregistrer le taux linéaire", "error");
        return;
      }
      setClubRevenueKpi(data.clubRevenueKpi);
      (dossier as any).clubRevenueKpi = data.clubRevenueKpi;
      showToast(
        `Taux linéaire enregistré — net LCIF ${data.breakdown?.clubNetEur ?? clubRevenuePreview.clubNetEur} €`,
        "success",
      );
      onDossierUpdated?.();
    } catch {
      showToast("Erreur réseau", "error");
    } finally {
      setSavingClubRevenue(false);
    }
  };

  const handleSaveDefaultLinearPercent = async () => {
    const raw = String(defaultLinearPercent).replace(",", ".");
    const pct = Number(raw);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      showToast("Taux par défaut invalide (0–100 %)", "error");
      return;
    }
    setSavingDefaultLinearPercent(true);
    try {
      const res = await adminFetch("/api/admin/kereis-mia-settings", {
        method: "PUT",
        headers: await authHeaders(),
        body: JSON.stringify({ settings: { defaultLinearCommissionPercent: pct } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        showToast(data.error || "Impossible d'enregistrer le taux par défaut", "error");
        return;
      }
      setDefaultLinearPercent(String(data.settings.defaultLinearCommissionPercent));
      showToast(`Taux linéaire par défaut : ${data.settings.defaultLinearCommissionPercent} %`, "success");
    } catch {
      showToast("Erreur réseau", "error");
    } finally {
      setSavingDefaultLinearPercent(false);
    }
  };

  const kereisSettings = {
    defaultLinearCommissionPercent: Number(defaultLinearPercent) || 15,
  };

  const economicsSlice = {
    ...dossier,
    studyKpi,
    studyDraft: (dossier as any).studyDraft,
    studyConseillerValidation: (dossier as any).studyConseillerValidation,
    communications: dossier.communications,
    clubRevenueKpi: {
      ...(clubRevenueKpi || {}),
      linearCommissionPercent: manualLinearPercent.trim()
        ? Number(String(manualLinearPercent).replace(/\s/g, "").replace(",", "."))
        : clubRevenueKpi?.linearCommissionPercent,
    },
  };

  const autoCourtageEur = resolveFeesCourtageEur(economicsSlice);
  const autoPremiumEur = resolveAnnualPremiumEur(economicsSlice);
  const autoFeesAssureurEur = resolveFeesAssureurEur(economicsSlice);

  const clubRevenuePreview = computeClubRevenueBreakdown(economicsSlice, { kereisSettings });

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

  const pendingDraft = (dossier as any).camillePendingReview as
    | { status?: string; proposedClientPlain?: string; reason?: string }
    | undefined;

  const handleConfirmDraft = async (action: "send" | "cancel") => {
    if (
      action === "cancel" &&
      !window.confirm("Annuler ce brouillon ? Aucun mail ne sera envoyé au client.")
    ) {
      return;
    }
    setConfirmingDraft(true);
    try {
      const res = await adminFetch(`/api/admin/dossiers/${dossier.id}/camille-confirm-draft`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.message || data.error || "Action impossible", "error");
        return;
      }
      showToast(
        action === "send"
          ? data.summary || "Mail client envoyé."
          : "Brouillon annulé.",
        "success",
      );
      await reloadCamilleContext();
      onDossierUpdated?.();
    } catch {
      showToast("Erreur réseau", "error");
    } finally {
      setConfirmingDraft(false);
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

  return (
    <div className="space-y-4">
      <AdminSubscriptionProgressPanel
        dossier={dossier}
        onUpdated={async () => {
          await reloadCamilleContext();
          onDossierUpdated?.();
        }}
      />

      <AdminConseillerSubscriptionPanel
        dossier={dossier}
        onUpdated={onDossierUpdated}
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
            <p>Capital prêt : <strong>{studyKpi.loanCapitalEur} €</strong></p>
            {studyKpi.annualPremiumEur != null && studyKpi.annualPremiumEur > 0 ? (
              <p>Prime annuelle : <strong>{studyKpi.annualPremiumEur} €</strong></p>
            ) : null}
            {studyKpi.feesAssureurEur != null && studyKpi.feesAssureurEur > 0 ? (
              <p>Frais de dossier : <strong>{studyKpi.feesAssureurEur} €</strong></p>
            ) : null}
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
        <div className="mt-3 pt-3 border-t border-emerald-200">
          <p className="text-[10px] font-black uppercase text-emerald-900 mb-1.5">Frais de courtage / distribution</p>
          <p className="text-[10px] text-emerald-800 mb-2">
            Courtage LCIF = frais de distribution Kereis (même montant). Rétro partenaire : 70 % conseiller, 50 % apporteur.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block flex-1 min-w-[140px]">
              <span className="text-[10px] font-bold">Montant (€)</span>
              <input
                type="text"
                inputMode="decimal"
                value={manualCourtage}
                onChange={(e) => setManualCourtage(e.target.value)}
                className="mt-0.5 w-full rounded border border-emerald-300 px-2 py-1.5 text-sm font-bold"
                placeholder="ex. 990"
              />
            </label>
            <button
              type="button"
              disabled={savingCourtageOnly}
              onClick={handleSaveCourtageOnly}
              className="text-[10px] font-bold px-3 py-2 rounded bg-emerald-900 text-white hover:bg-emerald-950 disabled:opacity-50 shrink-0"
            >
              {savingCourtageOnly ? "…" : "Enregistrer courtage"}
            </button>
          </div>
          {studyKpi?.feesCourtageEur != null && studyKpi.feesCourtageEur > 0 ? (
            <p className="text-[10px] text-emerald-800 mt-2">
              Actuel : <strong>{studyKpi.feesCourtageEur} €</strong>
              {studyKpi.source === "manual" ? " · saisie manuelle" : " · extrait du mail"}
              {" · "}
              {clubRevenuePreview.partnerLabel} :{" "}
              <strong>{clubRevenuePreview.partnerPayoutEur} €</strong>
              {" · "}
              Reste club sur courtage : <strong>{clubRevenuePreview.clubCourtageNetEur} €</strong>
            </p>
          ) : null}
        </div>
        {showManualKpi && (
          <div className="mt-3 pt-3 border-t border-emerald-200 space-y-2">
            <p className="text-[10px] text-emerald-800">
              Valeurs affichées dans le mail d&apos;étude et la rémunération club — prioritaires sur
              l&apos;extraction auto (utile si un second devis avec garanties différentes remplace le
              premier).
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
              <label className="block">
                <span className="text-[10px] font-bold">Prime annuelle (€)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={manualPremium}
                  onChange={(e) => setManualPremium(e.target.value)}
                  className="mt-0.5 w-full rounded border border-emerald-300 px-2 py-1.5 text-sm"
                  placeholder="ex. 1200"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold">Frais de dossier (€)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={manualFeesAssureur}
                  onChange={(e) => setManualFeesAssureur(e.target.value)}
                  className="mt-0.5 w-full rounded border border-emerald-300 px-2 py-1.5 text-sm"
                  placeholder="ex. 220"
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

      <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-200 text-xs text-indigo-950">
        <p className="font-black mb-1 flex items-center gap-2">
          Rémunération club — Kereis MIA (linéaire)
          {syncingClubRevenue ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-500" />
          ) : null}
        </p>
        <p className="text-[10px] text-indigo-800 mb-3 leading-relaxed">
          {KEREIS_MIA_CONTRACT.emprunteur.courtageEqualsDistribution}. Courtage et frais de dossier
          sont lus depuis le mail d&apos;étude ou le brouillon calculé ; la{" "}
          <strong>prime annuelle</strong> et les <strong>frais de dossier</strong> peuvent être
          corrigés via la saisie manuelle KPI (second devis, garanties différentes). Seul le{" "}
          <strong>% linéaire dossier</strong> est modifiable ci-dessous (sinon défaut global).
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          <div className="rounded-lg bg-white/70 border border-indigo-100 px-2.5 py-2">
            <p className="text-[10px] font-bold text-indigo-600 uppercase">Courtage / distribution</p>
            <p className="text-sm font-black">{autoCourtageEur > 0 ? `${autoCourtageEur} €` : "—"}</p>
          </div>
          <div className="rounded-lg bg-white/70 border border-indigo-100 px-2.5 py-2">
            <p className="text-[10px] font-bold text-indigo-600 uppercase">Prime annuelle</p>
            <p className="text-sm font-black">{autoPremiumEur > 0 ? `${autoPremiumEur} €` : "—"}</p>
          </div>
          <div className="rounded-lg bg-white/70 border border-indigo-100 px-2.5 py-2">
            <p className="text-[10px] font-bold text-indigo-600 uppercase">Frais de dossier</p>
            <p className="text-sm font-black">
              {autoFeesAssureurEur != null && autoFeesAssureurEur > 0 ? `${autoFeesAssureurEur} €` : "—"}
            </p>
          </div>
          <div className="rounded-lg bg-white/70 border border-indigo-100 px-2.5 py-2">
            <p className="text-[10px] font-bold text-indigo-600 uppercase">Commission Kereis / an</p>
            <p className="text-sm font-black">
              {clubRevenuePreview.kereisCommissionEur > 0
                ? `${clubRevenuePreview.kereisCommissionEur} €`
                : "—"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2 mb-3 p-2 rounded-lg bg-white/60 border border-indigo-100">
          <label className="block flex-1 min-w-[120px]">
            <span className="text-[10px] font-bold">Taux linéaire par défaut (%)</span>
            <input
              type="text"
              inputMode="decimal"
              value={defaultLinearPercent}
              onChange={(e) => setDefaultLinearPercent(e.target.value)}
              className="mt-0.5 w-full rounded border border-indigo-300 px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={savingDefaultLinearPercent}
            onClick={handleSaveDefaultLinearPercent}
            className="text-[10px] font-bold px-3 py-2 rounded bg-indigo-800 text-white hover:bg-indigo-900 disabled:opacity-50 shrink-0"
          >
            {savingDefaultLinearPercent ? "…" : "Enregistrer défaut"}
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <label className="block flex-1 min-w-[160px]">
            <span className="text-[10px] font-bold">% linéaire dossier (optionnel)</span>
            <input
              type="text"
              inputMode="decimal"
              value={manualLinearPercent}
              onChange={(e) => setManualLinearPercent(e.target.value)}
              className="mt-0.5 w-full rounded border border-indigo-300 px-2 py-1.5 text-sm font-bold"
              placeholder={`défaut ${defaultLinearPercent} %`}
            />
          </label>
          <button
            type="button"
            disabled={savingClubRevenue}
            onClick={handleSaveClubRevenue}
            className="text-[10px] font-bold px-3 py-2 rounded bg-indigo-900 text-white hover:bg-indigo-950 disabled:opacity-50 shrink-0"
          >
            {savingClubRevenue ? "…" : "Enregistrer % linéaire"}
          </button>
        </div>
        <div className="rounded-lg bg-white/70 border border-indigo-200 p-3 space-y-1 text-[11px]">
          <p>
            Courtage / distribution : <strong>{clubRevenuePreview.feesCourtageEur} €</strong>
            {" · "}
            − {clubRevenuePreview.partnerLabel} : <strong>{clubRevenuePreview.partnerPayoutEur} €</strong>
            {" → "}
            Reste courtage club : <strong>{clubRevenuePreview.clubCourtageNetEur} €</strong>
          </p>
          <p>
            Commission linéaire Kereis ({clubRevenuePreview.linearCommissionPercent} % ×{" "}
            {clubRevenuePreview.annualPremiumEur} € / an) :{" "}
            <strong>{clubRevenuePreview.kereisCommissionEur} € / an</strong>
            {clubRevenuePreview.kereisCommissionFromPercent ? " · calculé" : " · saisie manuelle"}
            {" · "}
            <strong>≈ {clubRevenuePreview.monthlyLinearCommissionEur} € / mois</strong> tant que le contrat est actif
          </p>
          <p className="text-indigo-900 font-black">
            Net club LCIF : {clubRevenuePreview.clubNetEur} €
          </p>
          <p className="text-[10px] text-indigo-700 pt-1 border-t border-indigo-100">
            {clubRevenuePreview.contractHelp}
          </p>
        </div>
      </div>

      <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-950">
        <p className="font-black mb-1">Date prévue du changement d&apos;assurance</p>
        <p className="text-[11px] text-blue-800 mb-3 leading-relaxed">
          Extraite automatiquement du mail d&apos;étude (libellé « changement prévu ») ou saisie manuelle.
          Visible sur la page suivi client et l&apos;espace apporteur.
        </p>
        {changePlan?.plannedDate ? (
          <p className="text-[11px] mb-2">
            Actuelle : <strong>{new Date(`${changePlan.plannedDate}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</strong>
            {" · "}
            {changePlan.source === "manual" ? "saisie manuelle" : "extraite du mail"}
          </p>
        ) : (
          <p className="text-[11px] text-blue-700 mb-2">Aucune date enregistrée pour ce dossier.</p>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label className="block flex-1 min-w-[160px]">
            <span className="text-[10px] font-bold">Date (AAAA-MM-JJ)</span>
            <input
              type="date"
              value={manualChangeDate}
              onChange={(e) => setManualChangeDate(e.target.value)}
              className="mt-0.5 w-full rounded border border-blue-300 px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={savingChangeDate}
            onClick={() => handleSaveChangeDate(false)}
            className="text-[10px] font-bold px-3 py-2 rounded bg-blue-900 text-white hover:bg-blue-950 disabled:opacity-50"
          >
            {savingChangeDate ? "…" : "Enregistrer"}
          </button>
          {changePlan?.plannedDate ? (
            <button
              type="button"
              disabled={savingChangeDate}
              onClick={() => handleSaveChangeDate(true)}
              className="text-[10px] font-bold px-3 py-2 rounded border border-blue-300 bg-white text-blue-900 hover:bg-blue-100 disabled:opacity-50"
            >
              Effacer
            </button>
          ) : null}
        </div>
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

      {!ctx ? (
        <p className="text-xs text-slate-400">Chargement contexte Camille…</p>
      ) : (
        <>
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
        {pendingDraft?.status === "awaiting_confirm" && (
          <div className="text-[11px] text-indigo-950 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-3 mb-2 space-y-2">
            <p className="font-bold">Brouillon Camille en attente — pas encore envoyé au client</p>
            {pendingDraft.proposedClientPlain && (
              <p className="text-indigo-900 whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">
                {String(pendingDraft.proposedClientPlain).slice(0, 600)}
              </p>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                disabled={confirmingDraft}
                onClick={() => handleConfirmDraft("send")}
                className="text-[10px] font-black uppercase px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {confirmingDraft ? "…" : "Envoyer au client"}
              </button>
              <button
                type="button"
                disabled={confirmingDraft}
                onClick={() => handleConfirmDraft("cancel")}
                className="text-[10px] font-bold px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Annuler
              </button>
            </div>
            <p className="text-[10px] text-indigo-700">
              Vous pouvez aussi répondre <b>OK ENVOIE</b> au mail [Camille] ou sur Telegram (bouton 📤).
            </p>
          </div>
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
        </>
      )}
    </div>
  );
}
