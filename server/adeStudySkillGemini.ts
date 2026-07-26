/**
 * Étude ADE via Gemini guidé par le skill lcif-ade-presentation-pdf.
 * Gemini calcule / structure les données ; le rendu premium reste pdfkit (+ assets).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { generateContentWithRetry } from "./geminiClient";
import type { AdeStudyComputation, AdeYearRow } from "./adeStudyCompute";

const FALLBACK_GUARANTEES = [
  { label: "Décès / PTIA", current: "Prévue", proposed: "Prévue" },
  {
    label: "Incapacité temporaire de travail",
    current: "Prévue",
    proposed: "Prévue - franchise 90 jours",
  },
  { label: "Invalidité permanente totale", current: "Prévue", proposed: "Prévue" },
  {
    label: "Invalidité permanente partielle",
    current: "Non mentionnée",
    proposed: "Prévue à partir de 33 %",
  },
  {
    label: "Affections dorsales / psychiques",
    current: "Conditions à vérifier",
    proposed: "Prévue sans condition d'hospitalisation",
  },
  {
    label: "Indemnisation forfaitaire",
    current: "Option facultative choisie",
    proposed: "Prévue",
  },
  { label: "Quotité", current: "100 % par assuré", proposed: "100 % par assuré" },
];

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function resolveSkillDir(): string {
  const candidates = [
    path.join(process.cwd(), "assets/ade-study/skill"),
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../assets/ade-study/skill"),
    path.join(process.cwd(), "dist/assets/ade-study/skill"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "calculs.md"))) return c;
  }
  return candidates[0];
}

function readSkillBundle(): string {
  const dir = resolveSkillDir();
  const parts: string[] = [];
  for (const name of ["SKILL.md", "calculs.md", "contenu-et-design.md", "loi-lemoine.md"]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) {
      parts.push(`===== ${name} =====\n${fs.readFileSync(p, "utf8")}`);
    }
  }
  return parts.join("\n\n");
}

function geminiReady(): boolean {
  const k = String(process.env.GEMINI_API_KEY || "");
  return Boolean(k) && !k.includes("MY_GEMINI");
}

type SkillGeminiRaw = {
  effectDateIso?: string;
  studyDateLabel?: string;
  comparisonStartLabel?: string;
  comparisonEndLabel?: string;
  clientName?: string;
  currentTotalEur?: number;
  proposedTotalEur?: number;
  feesAssureurEur?: number;
  monthsCompared?: number;
  loanCapitalEur?: number;
  years?: Array<{
    year?: number;
    currentEur?: number;
    proposedEur?: number;
    netSavingEur?: number;
    cumulNetEur?: number;
  }>;
  insuredBreakdown?: Array<{
    name?: string;
    currentEur?: number;
    proposedEur?: number;
    feesEur?: number;
    netEur?: number;
  }>;
  guarantees?: Array<{ label?: string; current?: string; proposed?: string }>;
  lemoineProfiles?: Array<{ name?: string; tone?: string; text?: string }>;
  first8CurrentEur?: number;
  first8ProposedEur?: number;
  assumptions?: string[];
  warnings?: string[];
};

function rebuildYears(
  yearsIn: SkillGeminiRaw["years"],
  fees: number,
): AdeYearRow[] {
  const rows = (yearsIn || [])
    .map((y, i) => ({
      year: Number(y?.year) || i + 1,
      currentEur: round2(Number(y?.currentEur) || 0),
      proposedEur: round2(Number(y?.proposedEur) || 0),
      netSavingEur: 0,
      cumulNetEur: 0,
    }))
    .filter((y) => y.year >= 1)
    .sort((a, b) => a.year - b.year);

  let cumul = 0;
  return rows.map((r, idx) => {
    const fee = idx === 0 ? fees : 0;
    const net = round2(r.currentEur - r.proposedEur - fee);
    cumul = round2(cumul + net);
    return { ...r, netSavingEur: net, cumulNetEur: cumul };
  });
}

function normalizeComputation(
  raw: SkillGeminiRaw,
  fallbacks: { clientName: string; effectDateIso: string },
): AdeStudyComputation | null {
  const currentTotalEur = round2(Number(raw.currentTotalEur) || 0);
  const proposedTotalEur = round2(Number(raw.proposedTotalEur) || 0);
  const feesAssureurEur = round2(Math.max(0, Number(raw.feesAssureurEur) || 0));
  if (!(currentTotalEur > 0 && proposedTotalEur > 0)) return null;

  let years = rebuildYears(raw.years, feesAssureurEur);
  if (years.length < 1) {
    // Synthèse 1 ligne si Gemini n'a pas produit le détail annuel
    const net = round2(currentTotalEur - proposedTotalEur - feesAssureurEur);
    years = [
      {
        year: 1,
        currentEur: currentTotalEur,
        proposedEur: proposedTotalEur,
        netSavingEur: net,
        cumulNetEur: net,
      },
    ];
  }

  // Recaler les totaux annuels sur les totaux contractuels si écart important
  const sumCur = round2(years.reduce((a, r) => a + r.currentEur, 0));
  const sumProp = round2(years.reduce((a, r) => a + r.proposedEur, 0));
  if (sumCur > 0 && Math.abs(sumCur - currentTotalEur) / currentTotalEur > 0.03) {
    const ratio = currentTotalEur / sumCur;
    years = years.map((r) => ({ ...r, currentEur: round2(r.currentEur * ratio) }));
  }
  if (sumProp > 0 && Math.abs(sumProp - proposedTotalEur) / proposedTotalEur > 0.03) {
    const ratio = proposedTotalEur / sumProp;
    years = years.map((r) => ({ ...r, proposedEur: round2(r.proposedEur * ratio) }));
  }
  years = rebuildYears(years, feesAssureurEur);

  const grossSavingsEur = round2(currentTotalEur - proposedTotalEur);
  const netSavingsEur = round2(grossSavingsEur - feesAssureurEur);
  // Forcer le cumul final = nette
  if (years.length) {
    const drift = round2(netSavingsEur - years[years.length - 1].cumulNetEur);
    if (Math.abs(drift) >= 0.01) {
      years[years.length - 1].netSavingEur = round2(years[years.length - 1].netSavingEur + drift);
      years[years.length - 1].cumulNetEur = netSavingsEur;
    }
  }

  const savingsPercent =
    currentTotalEur > 0 ? round2((netSavingsEur / currentTotalEur) * 1000) / 10 : 0;

  const insuredBreakdown = (raw.insuredBreakdown || [])
    .map((r) => ({
      name: String(r?.name || "").trim(),
      currentEur: round2(Number(r?.currentEur) || 0),
      proposedEur: round2(Number(r?.proposedEur) || 0),
      feesEur: round2(Number(r?.feesEur) || 0),
      netEur: round2(Number(r?.netEur) || 0),
    }))
    .filter((r) => r.name);

  const lemoineProfiles = (raw.lemoineProfiles || [])
    .map((r) => ({
      name: String(r?.name || "").trim(),
      tone: (String(r?.tone || "").toLowerCase() === "orange" ? "orange" : "green") as
        | "green"
        | "orange",
      text: String(r?.text || "").trim(),
    }))
    .filter((r) => r.name && r.text);

  const guarantees =
    (raw.guarantees || [])
      .map((g) => ({
        label: String(g?.label || "").trim(),
        current: String(g?.current || "").trim() || "Conditions à vérifier",
        proposed: String(g?.proposed || "").trim() || "Prévue",
      }))
      .filter((g) => g.label) || [];

  const first8 = years.slice(0, 8);
  const first8CurrentEur =
    raw.first8CurrentEur != null
      ? round2(Number(raw.first8CurrentEur))
      : round2(first8.reduce((a, r) => a + r.currentEur, 0));
  const first8ProposedEur =
    raw.first8ProposedEur != null
      ? round2(Number(raw.first8ProposedEur))
      : round2(first8.reduce((a, r) => a + r.proposedEur, 0));

  return {
    effectDateIso: String(raw.effectDateIso || fallbacks.effectDateIso).slice(0, 10),
    studyDateLabel: raw.studyDateLabel || undefined,
    comparisonStartLabel: raw.comparisonStartLabel || undefined,
    comparisonEndLabel: raw.comparisonEndLabel || undefined,
    currentTotalEur,
    proposedTotalEur,
    feesAssureurEur,
    grossSavingsEur,
    netSavingsEur,
    savingsPercent,
    year1ProposedEur: years[0]?.proposedEur || proposedTotalEur,
    years,
    monthsCompared: Math.max(1, Number(raw.monthsCompared) || years.length * 12),
    guarantees: guarantees.length ? guarantees : FALLBACK_GUARANTEES,
    assumptions: [
      "Calcul Gemini guidé par le skill présentation ADE LCIF.",
      ...(Array.isArray(raw.assumptions) ? raw.assumptions.map(String).slice(0, 8) : []),
    ],
    warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String).slice(0, 8) : [],
    confidence: years.length >= 5 ? "high" : "partial",
    clientName: String(raw.clientName || fallbacks.clientName).trim() || fallbacks.clientName,
    provider: "gemini",
    insuredBreakdown: insuredBreakdown.length ? insuredBreakdown : undefined,
    lemoineProfiles: lemoineProfiles.length ? lemoineProfiles : undefined,
    first8CurrentEur,
    first8ProposedEur,
    loanCapitalEur:
      raw.loanCapitalEur != null && Number(raw.loanCapitalEur) > 0
        ? round2(Number(raw.loanCapitalEur))
        : undefined,
  };
}

export async function computeAdeStudyWithSkillGemini(params: {
  clientName: string;
  effectDateIso: string;
  assuresSummary?: string;
  scheduleText: string;
  devisText: string;
  offerText?: string;
}): Promise<{ ok: true; computation: AdeStudyComputation } | { ok: false; error: string }> {
  if (!geminiReady()) {
    return { ok: false, error: "GEMINI_API_KEY manquante — génération skill indisponible." };
  }
  const schedule = (params.scheduleText || "").slice(0, 55_000);
  const devis = (params.devisText || "").slice(0, 55_000);
  const offer = (params.offerText || "").slice(0, 25_000);
  if (schedule.trim().length < 40 || devis.trim().length < 40) {
    return {
      ok: false,
      error: "Textes tableau/devis insuffisants pour Gemini (réuploadez les PDF).",
    };
  }

  const skill = readSkillBundle();
  const prompt = `Tu es l'agent du skill « présentation PDF économies ADE » du Club Immobilier Français.
Applique STRICTEMENT les règles du skill ci-dessous pour analyser les documents et produire les données d'une étude client 7 pages.

SKILL (obligatoire) :
"""
${skill.slice(0, 28_000)}
"""

CONTEXTE DOSSIER
- Client : ${params.clientName}
- Assurés connus : ${params.assuresSummary || params.clientName}
- Date d'effet de repli (si absente du devis) : ${params.effectDateIso}

DOCUMENTS (textes extraits des PDF)
--- TABLEAU D'AMORTISSEMENT ---
"""
${schedule}
"""

--- DEVIS SUBSTITUTION ---
"""
${devis}
"""

--- OFFRE DE PRÊT (optionnel) ---
"""
${offer || "(non fournie)"}
"""

TÂCHE
1. Reconstitue les coûts restants actuels vs proposés après la date d'effet.
2. Si plusieurs assurés / plusieurs prêts dans le devis, cumule correctement SANS double compter (attention aux totaux « pour l'ensemble des prêts » déjà consolidés).
3. Frais retenus = adhésion + constitution de dossier par assuré. EXCLURE frais de distribution / courtage.
4. Produis une ligne par année contractuelle restante (pas 295 lignes mensuelles).
5. Année 1 : déduire les frais une seule fois dans l'économie nette.
6. Garanties : ne rien inventer ; « Conditions à vérifier » si absent.
7. Lemoine : un profil par assuré (tone green|orange).

JSON UNIQUEMENT (pas de markdown) :
{
  "effectDateIso": "YYYY-MM-DD",
  "studyDateLabel": "JJ mois AAAA",
  "comparisonStartLabel": "JJ mois AAAA",
  "comparisonEndLabel": "JJ mois AAAA",
  "clientName": "Prénom Nom (& Prénom Nom)",
  "currentTotalEur": 0,
  "proposedTotalEur": 0,
  "feesAssureurEur": 0,
  "monthsCompared": 0,
  "loanCapitalEur": 0,
  "first8CurrentEur": 0,
  "first8ProposedEur": 0,
  "years": [{"year":1,"currentEur":0,"proposedEur":0,"netSavingEur":0,"cumulNetEur":0}],
  "insuredBreakdown": [{"name":"","currentEur":0,"proposedEur":0,"feesEur":0,"netEur":0}],
  "guarantees": [{"label":"","current":"","proposed":""}],
  "lemoineProfiles": [{"name":"","tone":"green","text":""}],
  "assumptions": [],
  "warnings": []
}

Contrôles avant réponse :
- gross = currentTotalEur - proposedTotalEur
- net = gross - feesAssureurEur
- cumul de la dernière année ≈ net (±0,05 €)
- somme des currentEur des années ≈ currentTotalEur
- somme des proposedEur des années ≈ proposedTotalEur
Ne jamais inventer un montant absent des documents.`;

  try {
    const response = await generateContentWithRetry({
      model: process.env.ADE_STUDY_MODEL || "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json", temperature: 0.1 },
    });
    const text = String(response?.text || "").trim();
    if (!text) return { ok: false, error: "Gemini n'a renvoyé aucune donnée d'étude." };
    let raw: SkillGeminiRaw;
    try {
      raw = JSON.parse(text) as SkillGeminiRaw;
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return { ok: false, error: "Réponse Gemini non JSON." };
      raw = JSON.parse(m[0]) as SkillGeminiRaw;
    }
    const computation = normalizeComputation(raw, {
      clientName: params.clientName,
      effectDateIso: params.effectDateIso,
    });
    if (!computation) {
      return {
        ok: false,
        error: "Gemini n'a pas pu extraire des totaux actuelle/proposée exploitables.",
      };
    }
    return { ok: true, computation };
  } catch (e: any) {
    console.error("[ade-skill-gemini]", e?.message || e);
    return { ok: false, error: e?.message || "Erreur Gemini lors du calcul d'étude." };
  }
}
