import type { Referral } from "../shared/apporteurTypes";
import type { Dossier } from "./dossierModel";
import {
  buildClientPortalSteps,
  resolveClientPortalStatusView,
  ensureClientPortalToken,
  getClientPortalAbsoluteUrl,
} from "./clientPortal";

export type ApporteurReferralTracking = {
  dossierId: string;
  clientPortalUrl: string;
  statusLabel: string;
  statusDetail?: string;
  steps: { key: string; label: string; done: boolean; active: boolean }[];
};

export async function enrichReferralsForApporteurPortal(
  referrals: Referral[],
  publicBaseUrl: string,
): Promise<
  Array<{
    id: string;
    status: Referral["status"];
    contact: Referral["contact"];
    createdAt: string;
    updatedAt: string;
    events: Referral["events"];
    tracking: ApporteurReferralTracking | null;
  }>
> {
  const { readDB, writeDB } = await import("./db");
  const db = await readDB();
  const dossierById = new Map<string, Dossier>();
  for (const d of db.dossiers) dossierById.set(d.id, d);

  const results: Array<{
    id: string;
    status: Referral["status"];
    contact: Referral["contact"];
    createdAt: string;
    updatedAt: string;
    events: Referral["events"];
    tracking: ApporteurReferralTracking | null;
  }> = [];

  for (const r of referrals) {
    const base = {
      id: r.id,
      status: r.status,
      contact: r.contact,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      events: (r.events || []).slice(-5),
      tracking: null as ApporteurReferralTracking | null,
    };

    if (!r.dossierId) {
      results.push(base);
      continue;
    }

    const dossier = dossierById.get(r.dossierId);
    if (!dossier) {
      results.push(base);
      continue;
    }

    let token = String(dossier.clientPortal?.token || "");
    if (!token || token.length < 24) {
      token = ensureClientPortalToken(dossier);
      try {
        await writeDB(db, dossier);
      } catch {
        /* non bloquant */
      }
    }
    const steps = buildClientPortalSteps(dossier);
    const statusView = resolveClientPortalStatusView(dossier);
    const firstPending = steps.find((s) => !s.done);
    const mappedSteps = steps.map((s) => ({
      key: s.key,
      label: s.label,
      done: Boolean(s.done),
      active: !s.done && s.key === firstPending?.key,
    }));

    base.tracking = {
      dossierId: dossier.id,
      clientPortalUrl: getClientPortalAbsoluteUrl(token, publicBaseUrl),
      statusLabel: statusView.label,
      statusDetail: statusView.description,
      steps: mappedSteps,
    };
    results.push(base);
  }

  return results;
}
