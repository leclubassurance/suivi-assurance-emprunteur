/**
 * Usage: npx tsx scripts/verify-client-landing-recent-studies.ts
 */
import assert from "assert";
import { listClientLandingRecentStudies } from "../server/clientLandingRecentStudies";
import type { Dossier } from "../server/dossierModel";

function dossier(partial: Partial<Dossier> & { id: string }): Dossier {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    status: "MAIL_ENVOYÉ",
    formData: { assures: [{ prenom: "A", nom: "B", email: "a@b.fr" }] },
    eventLog: [],
    communications: [],
    emails: [],
    ...partial,
  } as Dossier;
}

const withStudy = (id: string, savings: number, date: string) =>
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
    studyKpi: { grossSavingsEur: savings, extractedAt: date } as any,
  });

const rows = listClientLandingRecentStudies([
  withStudy("LCIF-1", 8000, "2026-07-20T10:00:00.000Z"),
  withStudy("LCIF-2", 4000, "2026-07-21T10:00:00.000Z"), // below threshold
  withStudy("LCIF-3", 12000, "2026-07-22T10:00:00.000Z"),
  dossier({ id: "LCIF-4", status: "EN_COURS" }), // no study
]);

assert.equal(rows.length, 2, "only ≥ 5000 with study sent");
assert.equal(rows[0].dossierId, "LCIF-3", "newest first");
assert.equal(rows[1].dossierId, "LCIF-1");
assert.ok(rows[0].grossSavingsLabel.includes("12"));

const many = listClientLandingRecentStudies(
  Array.from({ length: 15 }, (_, i) =>
    withStudy(`LCIF-${i}`, 6000 + i, `2026-07-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`),
  ),
);
assert.equal(many.length, 10, "max 10");

console.log("verify-client-landing-recent-studies: OK");
