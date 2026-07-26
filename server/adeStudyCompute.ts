import { generateContentWithRetry } from "./geminiClient";

export type AdeYearRow = {
  year: number;
  currentEur: number;
  proposedEur: number;
  netSavingEur: number;
  cumulNetEur: number;
};

export type AdeStudyComputation = {
  effectDateIso: string;
  currentTotalEur: number;
  proposedTotalEur: number;
  feesAssureurEur: number;
  grossSavingsEur: number;
  netSavingsEur: number;
  savingsPercent: number;
  year1ProposedEur: number;
  years: AdeYearRow[];
  monthsCompared: number;
  guarantees: { label: string; current: string; proposed: string }[];
  assumptions: string[];
  warnings: string[];
  confidence: "high" | "partial" | "low";
  clientName: string;
  provider: "gemini" | "heuristic" | "mixed";
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function parseEuroLoose(raw: string): number | null {
  const m = String(raw || "")
    .replace(/\u00a0/g, " ")
    .match(/(\d{1,3}(?:[\s.]\d{3})*|\d+)(?:[,.](\d{2}))?/);
  if (!m) return null;
  const n = Number(`${m[1].replace(/[\s.]/g, "")}.${m[2] ?? "00"}`);
  return Number.isFinite(n) ? round2(n) : null;
}

/** Extrait des cotisations assurance mensuelles depuis un texte d'échéancier. */
export function extractMonthlyInsuranceFromScheduleText(text: string): number[] {
  const lines = String(text || "").split(/\r?\n/);
  const amounts: number[] = [];
  // Lignes type : N  capital  intérêts  assurance  …  ou colonnes avec €
  const rowRe =
    /^\s*(\d{1,3})\s+[\d\s]+[,.]\d{2}\s+[\d\s]+[,.]\d{2}\s+([\d\s]+[,.]\d{2})/;
  for (const line of lines) {
    const m = line.match(rowRe);
    if (m) {
      const ass = parseEuroLoose(m[2]);
      if (ass != null && ass >= 0 && ass < 50_000) amounts.push(ass);
      continue;
    }
  }
  // Fallback : lignes « assurance » isolées peu fiables — ignorer si trop peu
  return amounts;
}

function sliceFromEffectMonth(monthly: number[], effectDateIso: string, firstDueDayHint?: number): {
  remaining: number[];
  assumption: string;
} {
  if (!monthly.length) return { remaining: [], assumption: "Aucune cotisation mensuelle lue." };
  // Heuristique : on garde tout sauf les 0–5 premières échéances déjà passées si beaucoup de lignes.
  // Si > 24 mois, on suppose que les premières lignes sont déjà échues jusqu'à ~effet.
  const today = new Date();
  const effect = new Date(effectDateIso + "T12:00:00");
  const monthsAhead = Math.max(
    0,
    (effect.getFullYear() - today.getFullYear()) * 12 + (effect.getMonth() - today.getMonth()),
  );
  // Si l'échéancier couvre tout le prêt depuis l'origine, skip ~ (total - restant estimé).
  // MVP : skip min(monthsAhead, 12) premières lignes si monthly.length > 60.
  let skip = 0;
  if (monthly.length > 60) {
    skip = Math.min(Math.max(monthsAhead, 0), Math.floor(monthly.length * 0.15));
  }
  const remaining = monthly.slice(skip);
  return {
    remaining,
    assumption: `Échéancier : ${monthly.length} mois lus, ${skip} écartés avant date d'effet (alignement approximatif${firstDueDayHint ? `, échéance ~j${firstDueDayHint}` : ""}).`,
  };
}

type DevisAi = {
  effectDateIso?: string;
  feesAssureurEur?: number;
  yearPremiumsEur?: number[];
  totalProposedEur?: number;
  monthlyProposedHintEur?: number;
  guarantees?: { label: string; current?: string; proposed?: string }[];
  warnings?: string[];
};

async function extractDevisWithGemini(devisText: string, effectFallbackIso: string): Promise<DevisAi | null> {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.includes("MY_GEMINI")) return null;
  const slice = devisText.slice(0, 40_000);
  if (slice.length < 80) return null;
  const prompt = `Extrais du devis d'assurance emprunteur (substitution) les montants pour une étude comparative.
Date d'effet de repli : ${effectFallbackIso}.

JSON uniquement :
{
  "effectDateIso": "YYYY-MM-DD",
  "feesAssureurEur": number,
  "yearPremiumsEur": [cotisation annuelle année 1, année 2, ... autant que possible],
  "totalProposedEur": number | null,
  "monthlyProposedHintEur": number | null,
  "guarantees": [{"label":"DC","current":"?","proposed":"Oui"}],
  "warnings": []
}

Règles :
- feesAssureurEur = frais de dossier / adhésion retenus par l'assureur (PAS frais de distribution courtier si exclus).
- yearPremiumsEur = cotisations de la NOUVELLE assurance par année contractuelle (annuel), pas mensuel.
- Ne pas inventer de montants absents.

DEVIS:
"""
${slice}
"""`;

  try {
    const response = await generateContentWithRetry({
      model: process.env.ADE_STUDY_MODEL || "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json", temperature: 0.1 },
    });
    return JSON.parse(String(response?.text || "{}")) as DevisAi;
  } catch (e: any) {
    console.warn("[ade-study] devis Gemini:", e?.message || e);
    return null;
  }
}

function expandYearsToMonths(yearPremiums: number[], monthCount: number): number[] {
  const out: number[] = [];
  let yi = 0;
  while (out.length < monthCount) {
    const annual = yearPremiums[Math.min(yi, yearPremiums.length - 1)] ?? yearPremiums[yearPremiums.length - 1] ?? 0;
    const monthsInYear = Math.min(12, monthCount - out.length);
    const monthly = annual / 12;
    for (let i = 0; i < monthsInYear; i++) out.push(monthly);
    yi += 1;
    if (yi > 80) break;
  }
  return out.slice(0, monthCount).map(round2);
}

function groupByContractYear(
  current: number[],
  proposed: number[],
  feesYear0: number,
): AdeYearRow[] {
  const n = Math.min(current.length, proposed.length);
  const years: AdeYearRow[] = [];
  let cumul = 0;
  for (let y = 0; y * 12 < n; y++) {
    const start = y * 12;
    const end = Math.min(n, start + 12);
    const cur = round2(current.slice(start, end).reduce((a, b) => a + b, 0));
    const prop = round2(proposed.slice(start, end).reduce((a, b) => a + b, 0));
    const fee = y === 0 ? feesYear0 : 0;
    const net = round2(cur - prop - fee);
    cumul = round2(cumul + net);
    years.push({
      year: y + 1,
      currentEur: cur,
      proposedEur: prop,
      netSavingEur: net,
      cumulNetEur: cumul,
    });
  }
  return years;
}

export async function computeAdeStudyEconomics(params: {
  clientName: string;
  effectDateIso: string;
  scheduleText: string;
  devisText: string;
}): Promise<AdeStudyComputation> {
  const warnings: string[] = [];
  const assumptions: string[] = [];
  const monthlyAll = extractMonthlyInsuranceFromScheduleText(params.scheduleText);
  const sliced = sliceFromEffectMonth(monthlyAll, params.effectDateIso);
  assumptions.push(sliced.assumption);
  const currentMonths = sliced.remaining;

  const devisAi = await extractDevisWithGemini(params.devisText, params.effectDateIso);
  const effectDateIso =
    (devisAi?.effectDateIso && /^\d{4}-\d{2}-\d{2}$/.test(devisAi.effectDateIso)
      ? devisAi.effectDateIso
      : params.effectDateIso) || params.effectDateIso;
  const fees = round2(Number(devisAi?.feesAssureurEur) || 0);
  const yearPremiums = (devisAi?.yearPremiumsEur || [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n >= 0);

  if (!currentMonths.length) {
    warnings.push("Impossible de lire les cotisations assurance de l'échéancier.");
  }
  if (!yearPremiums.length && devisAi?.totalProposedEur == null) {
    warnings.push("Devis : cotisations proposées non extraites — PDF incomplet.");
  }
  if (devisAi?.warnings?.length) warnings.push(...devisAi.warnings.map(String));

  let proposedMonths: number[] = [];
  if (yearPremiums.length && currentMonths.length) {
    proposedMonths = expandYearsToMonths(yearPremiums, currentMonths.length);
  } else if (devisAi?.totalProposedEur != null && currentMonths.length) {
    const per = Number(devisAi.totalProposedEur) / currentMonths.length;
    proposedMonths = currentMonths.map(() => round2(per));
    assumptions.push("Cotisations proposées lissées à partir du total devis (détail annuel absent).");
  } else if (devisAi?.monthlyProposedHintEur != null && currentMonths.length) {
    const m = Number(devisAi.monthlyProposedHintEur);
    proposedMonths = currentMonths.map(() => round2(m));
  }

  const currentTotalEur = round2(currentMonths.reduce((a, b) => a + b, 0));
  let proposedTotalEur = round2(proposedMonths.reduce((a, b) => a + b, 0));
  if (devisAi?.totalProposedEur != null && Number(devisAi.totalProposedEur) > 0) {
    // Prefer contract total when close
    const t = round2(Number(devisAi.totalProposedEur));
    if (proposedTotalEur <= 0 || Math.abs(proposedTotalEur - t) / t > 0.15) {
      proposedTotalEur = t;
      assumptions.push("Total proposé aligné sur le montant contractuel du devis.");
    }
  }

  const grossSavingsEur = round2(currentTotalEur - proposedTotalEur);
  const netSavingsEur = round2(grossSavingsEur - fees);
  const savingsPercent =
    currentTotalEur > 0 ? round2((grossSavingsEur / currentTotalEur) * 1000) / 10 : 0;

  const years = groupByContractYear(
    currentMonths,
    proposedMonths.length ? proposedMonths : currentMonths.map(() => 0),
    fees,
  );

  const year1ProposedEur = years[0]?.proposedEur ?? yearPremiums[0] ?? 0;

  // Recalcule net year0 with fees already in groupByContractYear
  if (years.length && Math.abs(years[years.length - 1].cumulNetEur - netSavingsEur) > 1) {
    assumptions.push(
      `Écart cumul annuel (${years[years.length - 1]?.cumulNetEur}) vs nette (${netSavingsEur}) — vérifier alignement mois.`,
    );
  }

  const guarantees =
    devisAi?.guarantees?.length ?
      devisAi.guarantees.map((g) => ({
        label: String(g.label || "Garantie"),
        current: String(g.current || "Selon contrat groupe"),
        proposed: String(g.proposed || "Oui"),
      }))
    : [
        { label: "Décès", current: "Oui", proposed: "Oui" },
        { label: "PTIA", current: "Oui", proposed: "Oui" },
        { label: "ITT / IPT / IPP", current: "Oui", proposed: "Oui" },
      ];

  let confidence: AdeStudyComputation["confidence"] = "low";
  if (currentTotalEur > 0 && proposedTotalEur > 0 && yearPremiums.length >= 1) confidence = "high";
  else if (currentTotalEur > 0 && proposedTotalEur > 0) confidence = "partial";

  return {
    effectDateIso,
    currentTotalEur,
    proposedTotalEur,
    feesAssureurEur: fees,
    grossSavingsEur,
    netSavingsEur,
    savingsPercent,
    year1ProposedEur,
    years,
    monthsCompared: Math.min(currentMonths.length, proposedMonths.length || currentMonths.length),
    guarantees,
    assumptions,
    warnings,
    confidence,
    clientName: params.clientName,
    provider: devisAi ? (currentMonths.length ? "mixed" : "gemini") : "heuristic",
  };
}
