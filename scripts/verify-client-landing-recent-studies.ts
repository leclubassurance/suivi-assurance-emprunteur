/**
 * Usage: node --import tsx scripts/verify-client-landing-recent-studies.ts
 */
import assert from "assert";
import { listClientLandingRecentStudies } from "../server/clientLandingRecentStudies";
import type { Dossier } from "../server/dossierModel";

function dossier(partial: Partial<Dossier> & { id: string }): Dossier {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    status: "EN_COURS",
    formData: { assures: [{ prenom: "A", nom: "B", email: "a@b.fr" }] },
    eventLog: [],
    communications: [],
    emails: [],
    ...partial,
  } as Dossier;
}

const withSentStudy = (id: string, savings: number, date: string) =>
  dossier({
    id,
    communications: [
      {
        id: "c1",
        direction: "outbound",
        subject: "Votre étude personnalisée d'assurance emprunteur",
        date,
        text: "…",
      } as any,
    ],
    studyKpi: { grossSavingsEur: savings, extractedAt: date, confidence: "high" } as any,
  });

const withDraftOnly = (id: string, savings: number, date: string) =>
  dossier({
    id,
    studyKpi: {
      grossSavingsEur: savings,
      extractedAt: date,
      confidence: "high",
      source: "study_draft",
    } as any,
    studyDraft: {
      computedAt: date,
      economySummary: { grossSavingsEur: savings },
    } as any,
  });

const rows = listClientLandingRecentStudies([
  withSentStudy("LCIF-1", 8000, "2026-07-20T10:00:00.000Z"),
  withSentStudy("LCIF-2", 4000, "2026-07-21T10:00:00.000Z"), // below threshold
  withDraftOnly("LCIF-3", 12000, "2026-07-22T10:00:00.000Z"), // not sent yet, but realized
  dossier({
    id: "LCIF-4",
    status: "REFUSÉ",
    studyKpi: {
      grossSavingsEur: 20000,
      extractedAt: "2026-07-23T10:00:00.000Z",
      confidence: "high",
    } as any,
    communications: [
      {
        id: "c1",
        direction: "outbound",
        subject: "Votre étude personnalisée d'assurance emprunteur",
        date: "2026-07-23T10:00:00.000Z",
        text: "…",
      } as any,
    ],
  }),
]);

assert.equal(rows.length, 2, "draft+sent ≥5000, refuse excluded, below threshold excluded");
assert.equal(rows[0].dossierId, "LCIF-3", "newest realized first");
assert.equal(rows[1].dossierId, "LCIF-1");
assert.ok(rows[0].grossSavingsLabel.includes("12"));

const many = listClientLandingRecentStudies(
  Array.from({ length: 15 }, (_, i) =>
    withDraftOnly(`LCIF-${i}`, 6000 + i, `2026-07-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`),
  ),
);
assert.equal(many.length, 10, "max 10");

console.log("verify-client-landing-recent-studies: OK");
