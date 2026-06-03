import fs from "fs";
import path from "path";
import type { Dossier } from "./dossierModel";
import { computeDocumentChecklistForDossier } from "../shared/documentChecklist";
import { getAdminChecklistOverrides } from "../shared/adminDocValidation";
import { assessCertainLoanDocProblems } from "./loanDocCertainty";
import { needsStatusStudySent } from "./dossierLifecycle";
import { getLoanCapitalFromDossier } from "./studyEmailKpi";
import {
  listRelatedDossiersForClient,
  emailClearlyTargetsDossier,
  extractLcifIdsFromText,
} from "./clientMultipleDossiers";
import { messageRequestsMissingLoanDocs } from "./camilleClientMessage";
import { getAiAuditTrail } from "./aiAuditLog";
import { sendEmail, isEmailConfigured } from "./emailProvider";
import { getAllowedChatIdsForNotify, isTelegramEnabled, sendTelegramRaw } from "./telegramCamille";

const PARIS = "Europe/Paris";

export type OpsIncidentSeverity = "critical" | "warning" | "info";
export type OpsIncidentScope = "day" | "state";

export type OpsIncidentCategory =
  | "checklist_mismatch"
  | "ocr_classification"
  | "camille_coherence"
  | "multi_dossier_routing"
  | "study_kpi"
  | "portal_status"
  | "manual_override"
  | "escalation"
  | "email_failure"
  | "camille_paused"
  | "documents_activity"
  | "firestore_pressure"
  | "positive";

export type OpsIncident = {
  id: string;
  category: OpsIncidentCategory;
  severity: OpsIncidentSeverity;
  scope: OpsIncidentScope;
  dossierId: string;
  clientName: string;
  title: string;
  detail: string;
  suggestedAction: string;
  evidence: string[];
  at?: string;
};

export type OpsDayActivity = {
  dossierId: string;
  clientName: string;
  status: string;
  highlights: string[];
};

export type OpsPriorityItem = {
  dossierId: string;
  clientName: string;
  score: number;
  reasons: string[];
};

export type OpsDailyMetrics = {
  reportYmd: string;
  periodLabel: string;
  dossiersWithActivity: number;
  newDossiers: number;
  clientMessagesIn: number;
  camilleRepliesOut: number;
  documentsUploaded: number;
  studiesSentOrDetected: number;
  manualChecklistValidations: number;
  emailFailures: number;
  escalationsOpened: number;
  escalationsResolved: number;
  openEscalationsEndOfDay: number;
  incidentsCritical: number;
  incidentsWarning: number;
  incidentsInfo: number;
  multiDossierClients: number;
};

export type OpsProductNote = {
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
};

export type OpsReportAiEnrichment = import("./opsDailyReportAi").OpsReportAiEnrichment;

export type DailyOpsReport = {
  version: 1;
  generatedAt: string;
  reportYmd: string;
  periodLabel: string;
  metrics: OpsDailyMetrics;
  incidents: OpsIncident[];
  dayActivity: OpsDayActivity[];
  priorityQueue: OpsPriorityItem[];
  productNotes: OpsProductNote[];
  markdown: string;
  telegramHtml: string;
  ai?: OpsReportAiEnrichment;
};

type SchedulerState = {
  lastDeliveredYmd?: string;
  lastAttemptAt?: string;
  lastError?: string;
};

function envFlag(name: string, defaultValue = "true") {
  const v = String((process.env as Record<string, string | undefined>)[name] ?? defaultValue).toLowerCase();
  return v !== "false" && v !== "0" && v !== "no";
}

function envInt(name: string, fallback: number) {
  const n = Number((process.env as Record<string, string | undefined>)[name]);
  return Number.isFinite(n) ? n : fallback;
}

export function parisDayKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PARIS }).format(d);
}

export function shiftParisYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  noonUtc.setUTCDate(noonUtc.getUTCDate() + days);
  return parisDayKey(noonUtc);
}

export function parisYesterdayYmd(): string {
  return shiftParisYmd(parisDayKey(), -1);
}

export function isOnParisDay(iso: string | number | undefined | null, ymd: string): boolean {
  if (!iso) return false;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return false;
  return parisDayKey(t) === ymd;
}

function getParisHourMinute(d = new Date()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PARIS,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return { hour, minute };
}

export function getOpsReportsDir(): string {
  if (process.env.VERCEL || process.env.RAILWAY_ENVIRONMENT) {
    return path.join("/tmp", "data", "ops-reports");
  }
  return path.join(process.cwd(), "data", "ops-reports");
}

function reportFilePath(ymd: string) {
  return path.join(getOpsReportsDir(), `${ymd}.json`);
}

function schedulerStatePath() {
  return path.join(getOpsReportsDir(), "_scheduler-state.json");
}

function readSchedulerState(): SchedulerState {
  try {
    const raw = fs.readFileSync(schedulerStatePath(), "utf8");
    return JSON.parse(raw) as SchedulerState;
  } catch {
    return {};
  }
}

function writeSchedulerState(state: SchedulerState) {
  const dir = getOpsReportsDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(schedulerStatePath(), JSON.stringify(state, null, 2), "utf8");
}

export function loadPersistedOpsReport(ymd: string): DailyOpsReport | null {
  try {
    const raw = fs.readFileSync(reportFilePath(ymd), "utf8");
    return JSON.parse(raw) as DailyOpsReport;
  } catch {
    return null;
  }
}

export function persistOpsReport(report: DailyOpsReport) {
  const dir = getOpsReportsDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(reportFilePath(report.reportYmd), JSON.stringify(report, null, 2), "utf8");
}

function clientName(d: Dossier): string {
  const a = d.formData?.assures?.[0];
  return [a?.prenom, a?.nom].filter(Boolean).join(" ") || d.id;
}

function adminBaseUrl(): string {
  return (
    process.env.PUBLIC_APP_URL ||
    process.env.APP_URL ||
    "https://assurance-emprunteur.up.railway.app"
  ).replace(/\/$/, "");
}

export function isStudyKpiSuspect(dossier: Dossier): boolean {
  const kpi = dossier.studyKpi;
  if (!kpi?.extractedAt) return false;
  const gross = Number(kpi.grossSavingsEur) || 0;
  const loan = getLoanCapitalFromDossier(dossier);
  return kpi.confidence === "low" || (gross > 0 && loan > 0 && gross > loan * 1.2);
}

function loanDocsChecklistOk(dossier: Dossier): boolean {
  const items = computeDocumentChecklistForDossier(dossier);
  const offre = items.find((x) => x.key === "offre");
  const amort = items.find((x) => x.key === "amort");
  return offre?.status === "ok" && amort?.status === "ok";
}

function incidentId(dossierId: string, category: string, suffix = "") {
  return `${dossierId}:${category}${suffix ? `:${suffix}` : ""}`;
}

function pushIncident(list: OpsIncident[], inc: OpsIncident) {
  if (list.some((x) => x.id === inc.id)) return;
  list.push(inc);
}

function dossierHadActivityOnDay(d: Dossier, ymd: string): boolean {
  if (isOnParisDay(d.createdAt, ymd) || isOnParisDay(d.updatedAt, ymd)) return true;

  for (const e of d.eventLog || []) {
    if (isOnParisDay(e.at, ymd)) return true;
  }
  for (const c of d.communications || []) {
    if (isOnParisDay((c as { date?: string }).date, ymd)) return true;
  }
  for (const doc of d.formData?.documents || []) {
    if (isOnParisDay((doc as { uploadedAt?: string }).uploadedAt, ymd)) return true;
  }
  for (const row of getAiAuditTrail(d)) {
    if (isOnParisDay(row.at, ymd)) return true;
  }
  for (const o of Object.values(getAdminChecklistOverrides(d))) {
    if (isOnParisDay(o.validatedAt, ymd)) return true;
  }
  return false;
}

function collectDayHighlights(d: Dossier, ymd: string): string[] {
  const lines: string[] = [];
  if (isOnParisDay(d.createdAt, ymd)) lines.push("Création dossier");
  let inbound = 0;
  let outbound = 0;
  let uploads = 0;
  for (const c of d.communications || []) {
    if (!isOnParisDay((c as { date?: string }).date, ymd)) continue;
    if ((c as { direction?: string }).direction === "inbound") inbound += 1;
    else outbound += 1;
  }
  if (inbound) lines.push(`${inbound} message(s) client`);
  if (outbound) lines.push(`${outbound} message(s) sortant(s)`);
  for (const doc of d.formData?.documents || []) {
    if (isOnParisDay((doc as { uploadedAt?: string }).uploadedAt, ymd)) uploads += 1;
  }
  if (uploads) lines.push(`${uploads} pièce(s) reçue(s)`);
  for (const e of d.eventLog || []) {
    if (!isOnParisDay(e.at, ymd)) continue;
    if (e.type === "EMAIL_FAILED") lines.push("Échec envoi mail");
    if (e.type === "STATUS_CHANGED") lines.push(`Statut → ${e.meta?.status || e.message || "?"}`);
    if (/escalade/i.test(String(e.message || ""))) lines.push("Escalade Camille");
  }
  return [...new Set(lines)];
}

function scanDossierIncidents(params: {
  dossier: Dossier;
  allDossiers: Dossier[];
  ymd: string;
  hadActivity: boolean;
}): OpsIncident[] {
  const { dossier: d, allDossiers, ymd, hadActivity } = params;
  const out: OpsIncident[] = [];
  const name = clientName(d);
  const checklist = computeDocumentChecklistForDossier(d);
  const inactive = ["CLOS", "REFUSE", "REFUSÉ"].includes(String(d.status || "").toUpperCase());

  if (!inactive || hadActivity) {
    for (const item of checklist) {
      const files = item.files || [];
      const hasPhysicalFiles = files.length > 0 || (item.matchedFiles?.length || 0) > 0;
      if (hasPhysicalFiles && item.status === "missing") {
        pushIncident(out, {
          id: incidentId(d.id, "checklist_mismatch", item.key),
          category: "checklist_mismatch",
          severity: "warning",
          scope: "state",
          dossierId: d.id,
          clientName: name,
          title: `Checklist « ${item.label} » manquant malgré fichier(s)`,
          detail: `Fichiers détectés : ${files.map((f) => f.name).join(", ") || item.matchedFiles?.join(", ")}`,
          suggestedAction: "Réanalyser OCR, reclasser le type de document, ou valider manuellement la ligne checklist.",
          evidence: files.map((f) => `${f.category}: ${f.name}`),
        });
      }
      if (item.status === "review" && item.key === "offre") {
        pushIncident(out, {
          id: incidentId(d.id, "ocr_classification", "offre_review"),
          category: "ocr_classification",
          severity: "warning",
          scope: "state",
          dossierId: d.id,
          clientName: name,
          title: "Offre de prêt à vérifier (OCR / type)",
          detail: item.reviewHint || "Statut review sur l'offre.",
          suggestedAction: "Vérifier FSI vs offre, tableau intégré, puis Réanalyser ou valider admin.",
          evidence: (item.files || []).map((f) => f.name),
        });
      }
    }

    const certain = assessCertainLoanDocProblems(d);
    if (certain.certain) {
      const detail = certain.problems
        .map((p) => `${p.category}: ${p.fileName} (${p.kind})`)
        .join(" · ");
      pushIncident(out, {
        id: incidentId(d.id, "ocr_classification", "certain"),
        category: "ocr_classification",
        severity: "critical",
        scope: "state",
        dossierId: d.id,
        clientName: name,
        title: "Problème document prêt quasi certain",
        detail,
        suggestedAction: "Demander PDF banque ou corriger le fichier, puis Réanalyser.",
        evidence: certain.problems.map((p) => p.fileName),
      });
    }

    if (isStudyKpiSuspect(d)) {
      const kpi = d.studyKpi!;
      pushIncident(out, {
        id: incidentId(d.id, "study_kpi"),
        category: "study_kpi",
        severity: "warning",
        scope: "state",
        dossierId: d.id,
        clientName: name,
        title: "KPI étude suspect",
        detail: `Économie brute ${kpi.grossSavingsEur} €, confiance ${kpi.confidence}, extrait le ${(kpi.extractedAt || "").slice(0, 10)}`,
        suggestedAction: "Bouton Recalculer KPI dans le panneau admin ou vérifier le HTML du mail d'étude.",
        evidence: kpi.subject ? [kpi.subject] : [],
      });
    }

    if (needsStatusStudySent(d)) {
      pushIncident(out, {
        id: incidentId(d.id, "portal_status"),
        category: "portal_status",
        severity: "info",
        scope: "state",
        dossierId: d.id,
        clientName: name,
        title: "Étude envoyée — statut portail pas à jour",
        detail: `Statut actuel : ${d.status}`,
        suggestedAction: "Passer le dossier en « Mail envoyé » après envoi de l'étude.",
        evidence: [],
      });
    }
  }

  const esc = d.camilleEscalation;
  if (esc?.lastAt && !esc.resolvedAt) {
    pushIncident(out, {
      id: incidentId(d.id, "escalation"),
      category: "escalation",
      severity: "critical",
      scope: "state",
      dossierId: d.id,
      clientName: name,
      title: "Escalade Camille ouverte",
      detail: esc.reason || `Depuis ${esc.lastAt?.slice(0, 16) || "?"}`,
      suggestedAction: "Traiter via Telegram ou admin, puis résoudre l'escalade.",
      evidence: esc.lastAt ? [esc.lastAt] : [],
      at: esc.lastAt,
    });
  }

  const siblings = listRelatedDossiersForClient(allDossiers, d);
  if (siblings.length > 1) {
    let ambiguousDay = false;
    if (hadActivity) {
      for (const c of d.communications || []) {
        if ((c as { direction?: string }).direction !== "inbound") continue;
        if (!isOnParisDay((c as { date?: string }).date, ymd)) continue;
        const subj = String((c as { subject?: string }).subject || "");
        const body = String((c as { body?: string }).body || (c as { snippet?: string }).snippet || "");
        const ids = extractLcifIdsFromText(`${subj}\n${body}`);
        if (ids.length === 0 || (ids.length === 1 && ids[0] !== d.id)) {
          if (!emailClearlyTargetsDossier({ subject: subj, body, dossierId: d.id })) {
            ambiguousDay = true;
          }
        }
      }
    }
    pushIncident(out, {
      id: incidentId(d.id, "multi_dossier_routing"),
      category: "multi_dossier_routing",
      severity: ambiguousDay ? "warning" : "info",
      scope: ambiguousDay ? "day" : "state",
      dossierId: d.id,
      clientName: name,
      title: `Client multi-dossiers (${siblings.length} actifs)`,
      detail: `Dossiers : ${siblings.map((s) => s.id).join(", ")}`,
      suggestedAction: "Exiger LCIF-XXXXXX dans le sujet des mails ; vérifier le routage Camille.",
      evidence: siblings.map((s) => s.id),
    });
  }

  for (const [key, o] of Object.entries(getAdminChecklistOverrides(d))) {
    if (isOnParisDay(o.validatedAt, ymd)) {
      pushIncident(out, {
        id: incidentId(d.id, "manual_override", key),
        category: "manual_override",
        severity: "info",
        scope: "day",
        dossierId: d.id,
        clientName: name,
        title: `Validation manuelle checklist : ${key}`,
        detail: o.note || `Statut ${o.status}`,
        suggestedAction: "Contrôler que la validation reflète bien les fichiers en base.",
        evidence: [o.validatedAt],
        at: o.validatedAt,
      });
    }
  }

  for (const e of d.eventLog || []) {
    if (!isOnParisDay(e.at, ymd)) continue;
    if (e.type === "EMAIL_FAILED") {
      pushIncident(out, {
        id: incidentId(d.id, "email_failure", e.at || ""),
        category: "email_failure",
        severity: "critical",
        scope: "day",
        dossierId: d.id,
        clientName: name,
        title: "Échec envoi email",
        detail: e.message || "EMAIL_FAILED",
        suggestedAction: "Vérifier SMTP / quota et renvoyer depuis l'admin.",
        evidence: [e.at || ""],
        at: e.at,
      });
    }
    if (/RESOURCE_EXHAUSTED|quota|firestore/i.test(String(e.message || ""))) {
      pushIncident(out, {
        id: incidentId(d.id, "firestore_pressure", e.at || ""),
        category: "firestore_pressure",
        severity: "warning",
        scope: "day",
        dossierId: d.id,
        clientName: name,
        title: "Pression Firestore / quota",
        detail: e.message || "RESOURCE_EXHAUSTED",
        suggestedAction: "Réduire écritures, compactage, ou étaler les sync.",
        evidence: [],
        at: e.at,
      });
    }
  }

  const staffUntilRaw = d.camilleStaffHandledUntil;
  const staffUntil = staffUntilRaw ? new Date(staffUntilRaw).getTime() : 0;
  if (staffUntil > Date.now()) {
    let inboundDay = false;
    for (const c of d.communications || []) {
      if ((c as { direction?: string }).direction !== "inbound") continue;
      if (isOnParisDay((c as { date?: string }).date, ymd)) inboundDay = true;
    }
    if (inboundDay) {
      pushIncident(out, {
        id: incidentId(d.id, "camille_paused"),
        category: "camille_paused",
        severity: "warning",
        scope: "day",
        dossierId: d.id,
        clientName: name,
        title: "Camille en pause — message client reçu",
        detail: `Reprise auto prévue après ${staffUntilRaw?.slice(0, 16) || "?"}`,
        suggestedAction: "Répondre manuellement ou réactiver Camille.",
        evidence: [],
      });
    }
  }

  if (hadActivity && loanDocsChecklistOk(d)) {
    for (const row of getAiAuditTrail(d)) {
      if (!isOnParisDay(row.at, ymd)) continue;
      if (row.action !== "AUTO_REPLY" || row.outcome !== "sent") continue;
      const text = `${row.summary || ""}\n${row.instructionPreview || ""}`;
      if (messageRequestsMissingLoanDocs(text)) {
        pushIncident(out, {
          id: incidentId(d.id, "camille_coherence", row.id),
          category: "camille_coherence",
          severity: "warning",
          scope: "day",
          dossierId: d.id,
          clientName: name,
          title: "Camille a demandé des docs prêt alors que checklist OK",
          detail: (row.summary || "").slice(0, 280),
          suggestedAction: "Vérifier prompt Camille : CNI/RIB uniquement après accord client pour le changement.",
          evidence: [row.at],
          at: row.at,
        });
      }
    }
  }

  if (hadActivity) {
    const uploadCount = (d.formData?.documents || []).filter((doc) =>
      isOnParisDay((doc as { uploadedAt?: string }).uploadedAt, ymd),
    ).length;
    if (uploadCount >= 2) {
      pushIncident(out, {
        id: incidentId(d.id, "documents_activity"),
        category: "documents_activity",
        severity: "info",
        scope: "day",
        dossierId: d.id,
        clientName: name,
        title: `${uploadCount} pièces reçues ce jour`,
        detail: "Activité documentaire notable — contrôler checklist ligne par fichier.",
        suggestedAction: "Ouvrir l'onglet Documents et valider chaque ligne.",
        evidence: [],
      });
    }
  }

  return out;
}

function buildPriorityQueue(incidents: OpsIncident[]): OpsPriorityItem[] {
  const scoreByDossier = new Map<string, OpsPriorityItem>();
  const weight: Record<OpsIncidentSeverity, number> = { critical: 12, warning: 5, info: 1 };

  for (const inc of incidents) {
    const prev = scoreByDossier.get(inc.dossierId) || {
      dossierId: inc.dossierId,
      clientName: inc.clientName,
      score: 0,
      reasons: [],
    };
    prev.score += weight[inc.severity];
    const short = `${inc.severity}: ${inc.title}`;
    if (!prev.reasons.includes(short)) prev.reasons.push(short);
    scoreByDossier.set(inc.dossierId, prev);
  }

  return [...scoreByDossier.values()]
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);
}

function buildProductNotes(incidents: OpsIncident[], metrics: OpsDailyMetrics): OpsProductNote[] {
  const byCat = new Map<string, number>();
  for (const i of incidents) byCat.set(i.category, (byCat.get(i.category) || 0) + 1);

  const notes: OpsProductNote[] = [];

  if ((byCat.get("checklist_mismatch") || 0) + (byCat.get("ocr_classification") || 0) >= 2) {
    notes.push({
      title: "Pipeline documents / OCR",
      detail:
        "Plusieurs dossiers avec décalage fichier ↔ checklist ou offre en review. Envisager garde-fou Camille « docs prêt OK » et alerte admin systématique à l'upload.",
      priority: "high",
    });
  }
  if ((byCat.get("camille_coherence") || 0) >= 1) {
    notes.push({
      title: "Cohérence Camille",
      detail:
        "Relances CNI/RIB sans accord client : durcir sanitize + consignes Telegram (relance étude sans pièces identité).",
      priority: "high",
    });
  }
  if ((byCat.get("multi_dossier_routing") || 0) >= 2 || metrics.multiDossierClients >= 2) {
    notes.push({
      title: "Multi-dossiers même client",
      detail:
        "Rappeler LCIF dans chaque sujet ; fil d'accueil portail pourrait lister les dossiers actifs.",
      priority: "medium",
    });
  }
  if ((byCat.get("study_kpi") || 0) >= 1) {
    notes.push({
      title: "KPI étude",
      detail: "Lancer un backfill KPI (endpoint activity-metrics) après correction parseur HTML.",
      priority: "medium",
    });
  }
  if ((byCat.get("firestore_pressure") || 0) >= 1) {
    notes.push({
      title: "Firestore",
      detail: "Surveiller RESOURCE_EXHAUSTED : limiter rewrites, allonger debounce sync, journal ops externe.",
      priority: "high",
    });
  }
  if (metrics.emailFailures > 0) {
    notes.push({
      title: "Délivrabilité email",
      detail: `${metrics.emailFailures} échec(s) — vérifier SMTP Railway et logs.`,
      priority: "high",
    });
  }
  if (notes.length === 0) {
    notes.push({
      title: "Journée stable",
      detail: "Peu d'incidents structurants — poursuivre surveillance multi-dossiers et KPI.",
      priority: "low",
    });
  }
  return notes;
}

function formatMarkdown(report: Omit<DailyOpsReport, "markdown" | "telegramHtml">): string {
  const m = report.metrics;
  const lines: string[] = [];
  lines.push(`# Rapport ops quotidien — ${m.periodLabel}`);
  lines.push("");
  lines.push(`Généré : ${report.generatedAt}`);
  lines.push("");
  lines.push("## Vue d'ensemble");
  lines.push("");
  lines.push("| Indicateur | Valeur |");
  lines.push("| --- | --- |");
  lines.push(`| Dossiers actifs (jour) | ${m.dossiersWithActivity} |`);
  lines.push(`| Nouveaux dossiers | ${m.newDossiers} |`);
  lines.push(`| Messages client | ${m.clientMessagesIn} |`);
  lines.push(`| Réponses Camille | ${m.camilleRepliesOut} |`);
  lines.push(`| Pièces uploadées | ${m.documentsUploaded} |`);
  lines.push(`| Études (détectées) | ${m.studiesSentOrDetected} |`);
  lines.push(`| Validations manuelles | ${m.manualChecklistValidations} |`);
  lines.push(`| Échecs email | ${m.emailFailures} |`);
  lines.push(`| Escalades ouvertes (fin de période) | ${m.openEscalationsEndOfDay} |`);
  lines.push(`| Incidents critique / alerte / info | ${m.incidentsCritical} / ${m.incidentsWarning} / ${m.incidentsInfo} |`);
  lines.push("");

  const severities: OpsIncidentSeverity[] = ["critical", "warning", "info"];
  for (const sev of severities) {
    const block = report.incidents.filter((i) => i.severity === sev);
    if (!block.length) continue;
    lines.push(`## ${sev === "critical" ? "🔴 Critiques" : sev === "warning" ? "🟠 Alertes" : "ℹ️ Informations"} (${block.length})`);
    lines.push("");
    for (const inc of block.slice(0, 40)) {
      lines.push(`### ${inc.dossierId} — ${inc.clientName}`);
      lines.push(`- **${inc.title}** (${inc.category}, ${inc.scope})`);
      lines.push(`- ${inc.detail}`);
      lines.push(`- *Action :* ${inc.suggestedAction}`);
      if (inc.evidence.length) lines.push(`- *Preuves :* ${inc.evidence.slice(0, 5).join(" · ")}`);
      lines.push("");
    }
    if (block.length > 40) lines.push(`_… et ${block.length - 40} autre(s)._`, "");
  }

  if (report.priorityQueue.length) {
    lines.push("## Priorité traitement");
    lines.push("");
    for (const p of report.priorityQueue.slice(0, 15)) {
      lines.push(`- **${p.dossierId}** (${p.clientName}) — score ${p.score} : ${p.reasons.slice(0, 3).join("; ")}`);
    }
    lines.push("");
  }

  if (report.dayActivity.length) {
    lines.push("## Activité par dossier (jour)");
    lines.push("");
    for (const a of report.dayActivity.slice(0, 50)) {
      lines.push(`- **${a.dossierId}** (${a.clientName}) [${a.status}] — ${a.highlights.join(", ") || "activité"}`);
    }
    lines.push("");
  }

  if (report.productNotes.length) {
    lines.push("## Pistes produit / process");
    lines.push("");
    for (const n of report.productNotes) {
      lines.push(`- **[${n.priority}]** ${n.title} — ${n.detail}`);
    }
  }

  lines.push("");
  lines.push(`Admin : ${adminBaseUrl()}`);
  return lines.join("\n");
}

function formatTelegramHtml(report: Omit<DailyOpsReport, "markdown" | "telegramHtml">): string {
  const m = report.metrics;
  const lines: string[] = [];
  lines.push(`<b>📊 Rapport ops — ${escapeHtml(m.periodLabel)}</b>`);
  lines.push("");
  lines.push(
    `Actifs: <b>${m.dossiersWithActivity}</b> · Nouveaux: <b>${m.newDossiers}</b> · Mails client: <b>${m.clientMessagesIn}</b>`,
  );
  lines.push(
    `🔴 ${m.incidentsCritical} · 🟠 ${m.incidentsWarning} · ℹ️ ${m.incidentsInfo} · Escalades ouvertes: <b>${m.openEscalationsEndOfDay}</b>`,
  );
  lines.push("");

  const top = report.priorityQueue.slice(0, 8);
  if (top.length) {
    lines.push("<b>Priorité</b>");
    for (const p of top) {
      lines.push(`• <b>${escapeHtml(p.dossierId)}</b> ${escapeHtml(p.clientName)} (${p.score})`);
      lines.push(`  <i>${escapeHtml(p.reasons[0] || "")}</i>`);
    }
    lines.push("");
  }

  const critical = report.incidents.filter((i) => i.severity === "critical").slice(0, 6);
  if (critical.length) {
    lines.push("<b>🔴 Critiques</b>");
    for (const inc of critical) {
      lines.push(`• <b>${escapeHtml(inc.dossierId)}</b> — ${escapeHtml(inc.title)}`);
    }
  }

  lines.push("");
  lines.push(`<i>Rapport complet par email · ${escapeHtml(adminBaseUrl())}</i>`);
  return lines.join("\n");
}

function escapeHtml(s: string) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildOpsDailyReport(dossiers: Dossier[], reportYmd: string): DailyOpsReport {
  const periodLabel = new Date(`${reportYmd}T12:00:00Z`).toLocaleDateString("fr-FR", {
    timeZone: PARIS,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const incidents: OpsIncident[] = [];
  const dayActivity: OpsDayActivity[] = [];
  let newDossiers = 0;
  let clientMessagesIn = 0;
  let camilleRepliesOut = 0;
  let documentsUploaded = 0;
  let studiesSentOrDetected = 0;
  let manualChecklistValidations = 0;
  let emailFailures = 0;
  let escalationsOpened = 0;
  let escalationsResolved = 0;
  let openEscalationsEndOfDay = 0;
  const multiClientKeys = new Set<string>();

  for (const d of dossiers) {
    const esc = d.camilleEscalation;
    if (esc?.lastAt && !esc.resolvedAt) openEscalationsEndOfDay += 1;

    const hadActivity = dossierHadActivityOnDay(d, reportYmd);
    if (!hadActivity) {
      const siblings = listRelatedDossiersForClient(dossiers, d);
      if (siblings.length > 1) {
        const email = d.formData?.assures?.[0]?.email || d.id;
        multiClientKeys.add(String(email).toLowerCase());
      }
      if (esc?.lastAt && !esc.resolvedAt) {
        incidents.push(
          ...scanDossierIncidents({ dossier: d, allDossiers: dossiers, ymd: reportYmd, hadActivity: false }),
        );
      }
      continue;
    }

    if (isOnParisDay(d.createdAt, reportYmd)) newDossiers += 1;

    for (const c of d.communications || []) {
      if (!isOnParisDay((c as { date?: string }).date, reportYmd)) continue;
      if ((c as { direction?: string }).direction === "inbound") clientMessagesIn += 1;
      if (
        (c as { direction?: string }).direction === "outbound" &&
        /camille/i.test(String((c as { from?: string }).from || ""))
      ) {
        camilleRepliesOut += 1;
      }
      const subj = String((c as { subject?: string }).subject || "");
      if ((c as { direction?: string }).direction === "outbound" && /étude|etude|économies|economies/i.test(subj)) {
        studiesSentOrDetected += 1;
      }
    }

    for (const doc of d.formData?.documents || []) {
      if (isOnParisDay((doc as { uploadedAt?: string }).uploadedAt, reportYmd)) documentsUploaded += 1;
    }

    for (const o of Object.values(getAdminChecklistOverrides(d))) {
      if (isOnParisDay(o.validatedAt, reportYmd)) manualChecklistValidations += 1;
    }

    for (const e of d.eventLog || []) {
      if (!isOnParisDay(e.at, reportYmd)) continue;
      if (e.type === "EMAIL_FAILED") emailFailures += 1;
      if (/escalade/i.test(String(e.message || "")) && !/résolue|resolue|annulé/i.test(String(e.message || ""))) {
        escalationsOpened += 1;
      }
      if (/escalade.*résolue|escalade.*resolue/i.test(String(e.message || ""))) escalationsResolved += 1;
    }

    const siblings = listRelatedDossiersForClient(dossiers, d);
    if (siblings.length > 1) {
      const email = d.formData?.assures?.[0]?.email || d.id;
      multiClientKeys.add(String(email).toLowerCase());
    }

    const highlights = collectDayHighlights(d, reportYmd);
    dayActivity.push({
      dossierId: d.id,
      clientName: clientName(d),
      status: String(d.status || ""),
      highlights,
    });

    incidents.push(
      ...scanDossierIncidents({ dossier: d, allDossiers: dossiers, ymd: reportYmd, hadActivity: true }),
    );
  }

  dayActivity.sort((a, b) => a.dossierId.localeCompare(b.dossierId));

  const metrics: OpsDailyMetrics = {
    reportYmd,
    periodLabel,
    dossiersWithActivity: dayActivity.length,
    newDossiers,
    clientMessagesIn,
    camilleRepliesOut,
    documentsUploaded,
    studiesSentOrDetected,
    manualChecklistValidations,
    emailFailures,
    escalationsOpened,
    escalationsResolved,
    openEscalationsEndOfDay,
    incidentsCritical: incidents.filter((i) => i.severity === "critical").length,
    incidentsWarning: incidents.filter((i) => i.severity === "warning").length,
    incidentsInfo: incidents.filter((i) => i.severity === "info").length,
    multiDossierClients: multiClientKeys.size,
  };

  const priorityQueue = buildPriorityQueue(incidents);
  const productNotes = buildProductNotes(incidents, metrics);

  const core = {
    version: 1 as const,
    generatedAt: new Date().toISOString(),
    reportYmd,
    periodLabel,
    metrics,
    incidents: incidents.sort((a, b) => {
      const sw = { critical: 0, warning: 1, info: 2 };
      return sw[a.severity] - sw[b.severity] || a.dossierId.localeCompare(b.dossierId);
    }),
    dayActivity,
    priorityQueue,
    productNotes,
  };

  return {
    ...core,
    markdown: formatMarkdown(core),
    telegramHtml: formatTelegramHtml(core),
  };
}

export type DeliverOpsReportOptions = {
  sendEmail?: boolean;
  sendTelegram?: boolean;
  emailTo?: string;
};

export async function deliverOpsDailyReport(
  report: DailyOpsReport,
  options: DeliverOpsReportOptions = {},
): Promise<{ email?: { ok: boolean; error?: string }; telegram?: { sent: number } }> {
  const result: { email?: { ok: boolean; error?: string }; telegram?: { sent: number } } = {};

  const wantEmail = options.sendEmail !== false;
  const wantTelegram = options.sendTelegram !== false;

  if (wantEmail) {
    const to =
      options.emailTo ||
      process.env.OPS_DAILY_REPORT_EMAIL ||
      process.env.AI_ESCALATION_EMAIL ||
      "";
    if (!to) {
      result.email = { ok: false, error: "OPS_DAILY_REPORT_EMAIL non configuré" };
    } else {
      const html = report.markdown
        .replace(/^# /gm, "<h1>")
        .replace(/^## /gm, "<h2>")
        .replace(/^### /gm, "<h3>")
        .replace(/\n/g, "<br>\n")
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.*?)\*/g, "<em>$1</em>");
      const r = await sendEmail({
        to,
        subject: `[LCIF Ops] Rapport quotidien — ${report.metrics.periodLabel}`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:720px;line-height:1.5">${html}</div>`,
      });
      if (r.ok) result.email = { ok: true };
      else result.email = { ok: false, error: "error" in r ? r.error : "Échec envoi" };
      if (!isEmailConfigured() && r.ok) {
        console.log("[OpsDailyReport] Email simulé (SMTP non configuré)");
      }
    }
  }

  if (wantTelegram && isTelegramEnabled() && envFlag("OPS_DAILY_REPORT_TELEGRAM", "true")) {
    const chats = getAllowedChatIdsForNotify();
    let sent = 0;
    for (const chatId of chats) {
      const msg = await sendTelegramRaw(chatId, report.telegramHtml);
      if (msg) sent += 1;
      const extra = report.incidents
        .filter((i) => i.severity === "critical")
        .slice(0, 8)
        .map(
          (i) =>
            `🔴 <b>${escapeHtml(i.dossierId)}</b>\n${escapeHtml(i.title)}\n<i>${escapeHtml(i.suggestedAction)}</i>`,
        )
        .join("\n\n");
      if (extra) await sendTelegramRaw(chatId, extra);
    }
    result.telegram = { sent };
  }

  return result;
}

export async function runOpsDailyReport(params?: {
  reportYmd?: string;
  deliver?: boolean;
  sendEmail?: boolean;
  sendTelegram?: boolean;
}): Promise<DailyOpsReport & { delivery?: Awaited<ReturnType<typeof deliverOpsDailyReport>> }> {
  const { readDB } = await import("./db");
  const db = await readDB();
  const reportYmd = params?.reportYmd || parisYesterdayYmd();
  let report = buildOpsDailyReport(db.dossiers, reportYmd);
  const { enrichOpsDailyReportWithAi } = await import("./opsDailyReportAi");
  report = await enrichOpsDailyReportWithAi(report, db.dossiers);
  persistOpsReport(report);

  let delivery: Awaited<ReturnType<typeof deliverOpsDailyReport>> | undefined;
  if (params?.deliver) {
    delivery = await deliverOpsDailyReport(report, {
      sendEmail: params.sendEmail,
      sendTelegram: params.sendTelegram,
    });
  }
  return { ...report, delivery };
}

let opsSchedulerStarted = false;

export function startOpsDailyReportScheduler() {
  if (opsSchedulerStarted || process.env.VERCEL) return;
  if (!envFlag("OPS_DAILY_REPORT_ENABLED", "true")) return;
  opsSchedulerStarted = true;

  const hourParis = envInt("OPS_DAILY_REPORT_HOUR", 8);
  const checkMs = envInt("OPS_DAILY_REPORT_CHECK_MS", 60_000);

  setInterval(() => {
    try {
      const { hour, minute } = getParisHourMinute();
      if (hour !== hourParis || minute > 10) return;

      const targetYmd = parisYesterdayYmd();
      const state = readSchedulerState();
      if (state.lastDeliveredYmd === targetYmd) return;

      runOpsDailyReport({ reportYmd: targetYmd, deliver: true })
        .then(() => {
          writeSchedulerState({
            lastDeliveredYmd: targetYmd,
            lastAttemptAt: new Date().toISOString(),
          });
          console.log(`[OpsDailyReport] Livré pour ${targetYmd}`);
        })
        .catch((err) => {
          writeSchedulerState({
            ...state,
            lastAttemptAt: new Date().toISOString(),
            lastError: err?.message || String(err),
          });
          console.error("[OpsDailyReport]", err);
        });
    } catch (e) {
      console.error("[OpsDailyReport] tick", e);
    }
  }, checkMs);

  console.log(`[OpsDailyReport] Planifié ~${hourParis}h Paris (jour précédent)`);
}
