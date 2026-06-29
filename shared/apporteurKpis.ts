import type { Referral, ReferralStatus } from "./apporteurTypes";

const CLOSED: ReferralStatus[] = ["SIGNE", "REFUSE", "PERDU"];
const OPEN_EXCLUDE: ReferralStatus[] = ["SIGNE", "REFUSE", "PERDU"];

export type ReferralKpis = {
  total: number;
  open: number;
  signed: number;
  refused: number;
  lost: number;
  nouveau: number;
  contacte: number;
  dossierOuvert: number;
  etudeEnvoyee: number;
  thisMonth: number;
  /** Part des dossiers clos qui ont abouti (signé / signé+refusé+perdu). */
  conversionRate: number | null;
  /** Part signée sur l'ensemble des recommandations. */
  signatureRate: number | null;
};

function countStatus(referrals: Pick<Referral, "status">[], status: ReferralStatus): number {
  return referrals.filter((r) => r.status === status).length;
}

function isThisMonth(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

export function computeReferralKpis(
  referrals: Pick<Referral, "status" | "createdAt">[],
): ReferralKpis {
  const total = referrals.length;
  const signed = countStatus(referrals, "SIGNE");
  const refused = countStatus(referrals, "REFUSE");
  const lost = countStatus(referrals, "PERDU");
  const closed = signed + refused + lost;
  const open = referrals.filter((r) => !OPEN_EXCLUDE.includes(r.status)).length;

  return {
    total,
    open,
    signed,
    refused,
    lost,
    nouveau: countStatus(referrals, "NOUVEAU"),
    contacte: countStatus(referrals, "CONTACTE"),
    dossierOuvert: countStatus(referrals, "DOSSIER_OUVERT"),
    etudeEnvoyee: countStatus(referrals, "ETUDE_ENVOYEE"),
    thisMonth: referrals.filter((r) => isThisMonth(r.createdAt)).length,
    conversionRate: closed > 0 ? signed / closed : null,
    signatureRate: total > 0 ? signed / total : null,
  };
}

export type AdminApporteurKpis = ReferralKpis & {
  apporteurs: number;
  activeApporteurs: number;
  apporteursWithOpenReferrals: number;
};

export type ApporteurTeamKpis = ReferralKpis & {
  downlineCount: number;
  teamReferrals: number;
  teamSigned: number;
  teamOpen: number;
};

export function computeApporteurTeamKpis(
  personalReferrals: Pick<Referral, "status" | "createdAt">[],
  teamReferrals: Pick<Referral, "status" | "createdAt">[],
  downlineCount: number,
): ApporteurTeamKpis {
  const personal = computeReferralKpis(personalReferrals);
  const team = computeReferralKpis(teamReferrals);
  return {
    ...personal,
    downlineCount,
    teamReferrals: team.total,
    teamSigned: team.signed,
    teamOpen: team.open,
  };
}

export function computeAdminApporteurKpis(
  apporteurs: { id: string; active: boolean }[],
  referrals: Referral[],
): AdminApporteurKpis {
  const base = computeReferralKpis(referrals);
  const openByApporteur = new Set(
    referrals.filter((r) => !CLOSED.includes(r.status)).map((r) => r.apporteurId),
  );
  return {
    ...base,
    apporteurs: apporteurs.length,
    activeApporteurs: apporteurs.filter((a) => a.active).length,
    apporteursWithOpenReferrals: openByApporteur.size,
  };
}
