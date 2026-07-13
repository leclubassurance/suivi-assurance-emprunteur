/**
 * Usage: npx tsx scripts/verify-club-revenue-segments.ts
 */
import { resolveClubRevenueDossierSegment } from "../shared/clubRevenueDossierSegment";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

assert(
  resolveClubRevenueDossierSegment({
    status: "MAIL_ENVOYÉ",
    studySent: true,
    hasEconomics: true,
  }) === "pipeline",
  "MAIL_ENVOYÉ + étude → théorique",
);

assert(
  resolveClubRevenueDossierSegment({
    status: "ADHESION_EN_COURS",
    studySent: true,
    hasEconomics: true,
  }) === "signed",
  "ADHESION_EN_COURS → signé quasi assuré",
);

assert(
  resolveClubRevenueDossierSegment({
    status: "MAIL_ENVOYÉ",
    studySent: true,
    clientAccepted: true,
    hasEconomics: true,
  }) === "signed",
  "accord client → signé même si MAIL_ENVOYÉ",
);

assert(
  resolveClubRevenueDossierSegment({
    status: "TRAITÉ",
    studySent: true,
    clientAccepted: true,
    subscriptionPhase: "completed",
    hasEconomics: true,
  }) === "settled",
  "TRAITÉ + completed → traité",
);

assert(
  resolveClubRevenueDossierSegment({
    status: "REFUSÉ",
    studySent: true,
  }) === null,
  "REFUSÉ exclu",
);

assert(
  resolveClubRevenueDossierSegment({
    status: "DECISION_EN_ATTENTE",
    studySent: true,
    hasEconomics: true,
  }) === "pipeline",
  "DECISION_EN_ATTENTE sans accord → théorique",
);

console.log("\nSegments OK.");
