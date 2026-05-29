import type { Dossier } from "./dossierModel";
import { generateContentWithRetry } from "./geminiClient";
import { buildCamilleAdminContext } from "./camilleAdminContext";
import type { DailyOpsReport } from "./opsDailyReport";

export type OpsDossierAiAudit = {
  dossierId: string;
  clientName: string;
  score: number;
  audit: string;
};

export type OpsReportAiEnrichment = {
  executiveSummary: string;
  dossierAudits: OpsDossierAiAudit[];
  generatedAt: string;
  model: string;
};

function aiEnabled(): boolean {
  const flag = String(process.env.OPS_DAILY_REPORT_AI_ENABLED ?? "true").toLowerCase();
  if (flag === "false" || flag === "0") return false;
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && !key.includes("MY_GEMINI"));
}

function modelName() {
  return process.env.OPS_DAILY_REPORT_AI_MODEL || "gemini-2.5-flash";
}

function extractText(response: any): string {
  return String(response?.text || response?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
}

function buildFactsPayload(report: DailyOpsReport) {
  return {
    period: report.periodLabel,
    reportYmd: report.reportYmd,
    metrics: report.metrics,
    priorityQueue: report.priorityQueue.slice(0, 12),
    productNotes: report.productNotes,
    incidents: report.incidents.slice(0, 35).map((i) => ({
      severity: i.severity,
      category: i.category,
      dossierId: i.dossierId,
      clientName: i.clientName,
      title: i.title,
      detail: i.detail.slice(0, 200),
      suggestedAction: i.suggestedAction,
      scope: i.scope,
    })),
    dayActivitySample: report.dayActivity.slice(0, 20).map((a) => ({
      dossierId: a.dossierId,
      clientName: a.clientName,
      highlights: a.highlights,
    })),
  };
}

async function generateExecutiveSummary(report: DailyOpsReport): Promise<string> {
  const facts = buildFactsPayload(report);
  const response = await generateContentWithRetry({
    model: modelName(),
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Tu es l'auditeur ops du Club Immobilier Français (assurance emprunteur).
On te fournit un rapport déterministe (métriques + incidents déjà détectés par règles).
Rédige une SYNTHÈSE EXÉCUTIVE en français pour Rémi (8 à 14 lignes, ton direct).

Règles :
- Ne répète pas tout le tableau : priorités du jour, risques business, 2–3 actions concrètes.
- Ne invente aucun dossier ni chiffre : base-toi UNIQUEMENT sur le JSON.
- Mentionne les LCIF-XXXXXX les plus urgents.
- Si la journée est calme, dis-le clairement.
- Pas de markdown, pas de HTML, texte brut avec tirets • pour les puces.

JSON :
${JSON.stringify(facts, null, 0).slice(0, 12000)}`,
          },
        ],
      },
    ],
  });
  return extractText(response) || "Synthèse IA indisponible (réponse vide).";
}

async function generateDossierAudit(params: {
  dossier: Dossier;
  report: DailyOpsReport;
  score: number;
}): Promise<string> {
  const { dossier, report, score } = params;
  const ctx = buildCamilleAdminContext(dossier);
  const dossierIncidents = report.incidents.filter((i) => i.dossierId === dossier.id);

  const response = await generateContentWithRetry({
    model: modelName(),
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Audit ciblé dossier LCIF (5–8 lignes, français, pour Rémi).
Score priorité rapport : ${score}.

Contexte admin :
${ctx.summary}

Étape suggérée système : ${ctx.suggestedNextStep}

Incidents détectés aujourd'hui / état :
${dossierIncidents.map((i) => `- [${i.severity}] ${i.title}: ${i.detail}`).join("\n") || "- aucun incident listé"}

Dernier message client :
${ctx.lastClientMessage ? `${ctx.lastClientMessage.subject} — ${ctx.lastClientMessage.preview}` : "—"}

Consigne : que faire en priorité ce matin (1 action claire). Ne pas inventer de pièces manquantes si le contexte dit OK.`,
          },
        ],
      },
    ],
  });
  return extractText(response) || "Audit indisponible.";
}

export async function enrichOpsDailyReportWithAi(
  report: DailyOpsReport,
  dossiers: Dossier[],
): Promise<DailyOpsReport & { ai?: OpsReportAiEnrichment }> {
  if (!aiEnabled()) {
    return report;
  }

  const byId = new Map(dossiers.map((d) => [d.id, d]));
  const topN = Math.min(5, Math.max(0, Number(process.env.OPS_DAILY_REPORT_AI_TOP_DOSSIERS || 3) || 3));

  try {
    const executiveSummary = await generateExecutiveSummary(report);

    const dossierAudits: OpsDossierAiAudit[] = [];
    const candidates = report.priorityQueue
      .filter((p) => p.score >= 5)
      .slice(0, topN);

    for (const p of candidates) {
      const dossier = byId.get(p.dossierId);
      if (!dossier) continue;
      const audit = await generateDossierAudit({ dossier, report, score: p.score });
      dossierAudits.push({
        dossierId: p.dossierId,
        clientName: p.clientName,
        score: p.score,
        audit,
      });
    }

    const ai: OpsReportAiEnrichment = {
      executiveSummary,
      dossierAudits,
      generatedAt: new Date().toISOString(),
      model: modelName(),
    };

    return appendAiToReport(report, ai);
  } catch (err: any) {
    console.error("[OpsDailyReport AI]", err?.message || err);
    return {
      ...report,
      ai: {
        executiveSummary: `Synthèse IA non générée : ${err?.message || String(err)}`,
        dossierAudits: [],
        generatedAt: new Date().toISOString(),
        model: modelName(),
      },
    };
  }
}

export function appendAiToReport(
  report: DailyOpsReport,
  ai: OpsReportAiEnrichment,
): DailyOpsReport & { ai: OpsReportAiEnrichment } {
  const aiMarkdown = [
    "",
    "## Synthèse IA (Camille ops)",
    "",
    ai.executiveSummary,
    "",
  ];
  if (ai.dossierAudits.length) {
    aiMarkdown.push("### Audits dossiers prioritaires", "");
    for (const row of ai.dossierAudits) {
      aiMarkdown.push(`#### ${row.dossierId} — ${row.clientName} (score ${row.score})`, "", row.audit, "");
    }
  }
  aiMarkdown.push(`_Modèle : ${ai.model} · ${ai.generatedAt.slice(0, 16)}_`);

  const aiTelegram = [
    "<b>🤖 Synthèse IA</b>",
    "",
    escapeTelegram(ai.executiveSummary.slice(0, 1200)),
  ];
  if (ai.dossierAudits.length) {
    aiTelegram.push("", "<b>Dossiers à traiter</b>");
    for (const row of ai.dossierAudits.slice(0, 3)) {
      aiTelegram.push(
        `• <b>${escapeTelegram(row.dossierId)}</b> (${row.score})\n${escapeTelegram(row.audit.slice(0, 400))}`,
      );
    }
  }

  return {
    ...report,
    ai,
    markdown: `${report.markdown}\n${aiMarkdown.join("\n")}`,
    telegramHtml: `${aiTelegram.join("\n")}\n\n${report.telegramHtml}`,
  };
}

function escapeTelegram(s: string) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
