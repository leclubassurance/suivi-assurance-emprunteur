import type { Dossier } from "./dossierModel";
import { isLeadDossier } from "./leadDossierMerge";
import { findDossierByLcifReference } from "./gmailAttachments";
import { isDossierActiveForClient } from "./clientMultipleDossiers";

export function normalizeForSearch(s: string): string {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractLcifId(text: string): string | null {
  return text.match(/LCIF-\d{6}/i)?.[0]?.toUpperCase() || null;
}

export type DossierTextMatchResult =
  | { kind: "found"; dossier: Dossier; matchKind: "lcif" | "borrower" }
  | { kind: "ambiguous"; labels: string[] }
  | { kind: "none" };

function extractHonorificSurnames(normalizedText: string): string[] {
  const out: string[] = [];
  const re = /\b(?:monsieur|madame|mme|mr|mle|m)\s+([a-z]{3,})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalizedText))) {
    out.push(m[1]);
  }
  return out;
}

function scoreBorrowerInText(
  normalizedText: string,
  dossier: Dossier,
): { score: number; label: string } {
  const assures = Array.isArray(dossier.formData?.assures) ? dossier.formData.assures : [];
  let bestScore = 0;
  let bestLabel = dossier.id;

  for (const a of assures) {
    const prenom = normalizeForSearch(String(a?.prenom || ""));
    const nom = normalizeForSearch(String(a?.nom || ""));
    const full = [prenom, nom].filter(Boolean).join(" ");
    const display = [a?.prenom, a?.nom].filter(Boolean).join(" ") || dossier.id;
    if (!full && !nom) continue;

    let score = 0;
    if (full.length >= 4 && normalizedText.includes(full)) score = 100;
    else if (nom.length >= 3 && normalizedText.includes(nom)) score = 75;
    else if (prenom.length >= 3 && normalizedText.includes(prenom)) score = 55;

    if (score === 0 && full) {
      const tokens = normalizedText.split(" ").filter(Boolean);
      for (let i = 0; i < tokens.length - 1; i++) {
        if (`${tokens[i]} ${tokens[i + 1]}` === full) {
          score = 100;
          break;
        }
      }
    }

    if (nom.length >= 3) {
      for (const hinted of extractHonorificSurnames(normalizedText)) {
        if (hinted === nom || nom.startsWith(hinted) || hinted.startsWith(nom)) {
          score = Math.max(score, 95);
          break;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestLabel = `${display} — ${dossier.id}`;
    }
  }

  return { score: bestScore, label: bestLabel };
}

function insurerDossierBoost(dossier: Dossier): number {
  let boost = 0;
  if (isDossierActiveForClient(dossier)) boost += 10;
  if (dossier.studyKpi?.grossSavingsEur != null || dossier.studyDraft?.computedAt) boost += 20;
  if (dossier.subscriptionProgress?.phase) boost += 30;
  const updated = new Date(dossier.updatedAt || dossier.createdAt || 0).getTime();
  if (Number.isFinite(updated)) boost += updated / 1e15;
  return boost;
}

function pickBestInsurerCandidate(matches: Array<{ dossier: Dossier; score: number; label: string }>) {
  return [...matches].sort((a, b) => {
    const boostDiff = insurerDossierBoost(b.dossier) - insurerDossierBoost(a.dossier);
    if (boostDiff !== 0) return boostDiff;
    return b.score - a.score || String(b.dossier.id).localeCompare(String(a.dossier.id));
  })[0];
}

/** Cible un dossier via LCIF ou nom/prénom emprunteur dans un texte (sujet mail, corps, PJ). */
export function resolveDossierFromBorrowerText(
  db: { dossiers: Dossier[] },
  text: string,
  options?: { minScore?: number; excludeLeads?: boolean },
): DossierTextMatchResult {
  const minScore = options?.minScore ?? 75;
  const excludeLeads = options?.excludeLeads !== false;

  const lcif = extractLcifId(text);
  if (lcif) {
    const byLcif = findDossierByLcifReference(db, lcif);
    if (byLcif && (!excludeLeads || !isLeadDossier(byLcif))) {
      return { kind: "found", dossier: byLcif, matchKind: "lcif" };
    }
  }

  const normalizedText = normalizeForSearch(text);
  if (normalizedText.length < 2) return { kind: "none" };

  const scored: Array<{ dossier: Dossier; score: number; label: string }> = [];
  for (const d of db.dossiers || []) {
    if (excludeLeads && isLeadDossier(d)) continue;
    const { score, label } = scoreBorrowerInText(normalizedText, d);
    if (score >= minScore) scored.push({ dossier: d, score, label });
  }

  if (scored.length === 0) {
    const weak = (db.dossiers || [])
      .filter((d) => !excludeLeads || !isLeadDossier(d))
      .map((d) => ({ dossier: d, ...scoreBorrowerInText(normalizedText, d) }))
      .filter((s) => s.score === 55);
    if (weak.length === 1) {
      return { kind: "found", dossier: weak[0].dossier, matchKind: "borrower" };
    }
    if (weak.length > 1) {
      return { kind: "ambiguous", labels: weak.slice(0, 6).map((s) => s.label) };
    }
    return { kind: "none" };
  }

  scored.sort((a, b) => b.score - a.score || insurerDossierBoost(b.dossier) - insurerDossierBoost(a.dossier));
  const bestScore = scored[0].score;
  const strong = scored.filter((s) => s.score >= bestScore - 5 && s.score >= minScore);

  if (strong.length > 1) {
    const top = pickBestInsurerCandidate(strong);
    const rivals = strong.filter((s) => s.dossier.id !== top.dossier.id);
    const closeRivals = rivals.filter((s) => s.score >= top.score - 5);
    if (closeRivals.length > 0 && insurerDossierBoost(top.dossier) - insurerDossierBoost(closeRivals[0].dossier) < 15) {
      return {
        kind: "ambiguous",
        labels: strong.slice(0, 6).map((s) => s.label),
      };
    }
    return { kind: "found", dossier: top.dossier, matchKind: "borrower" };
  }

  return { kind: "found", dossier: scored[0].dossier, matchKind: "borrower" };
}

/** Rattache un mail assureur au dossier via nom emprunteur (pas de LCIF côté assureur). */
export function findDossierForInsurerEmail(
  db: { dossiers: Dossier[] },
  params: { subject: string; body: string; attachmentNames?: string[] },
): DossierTextMatchResult {
  const combined = [params.subject, params.body, ...(params.attachmentNames || [])].filter(Boolean).join("\n");
  return resolveDossierFromBorrowerText(db, combined, { minScore: 75, excludeLeads: true });
}
