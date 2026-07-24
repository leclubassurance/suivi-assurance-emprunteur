import React, { useState } from "react";
import { CheckCircle2, Circle, CreditCard, ExternalLink, Loader2 } from "lucide-react";
import { CONSEILLER_ANNUAL_PLATFORM_FEE_EUR_TTC } from "../../../shared/conseillerImmoClub";
import type { ConseillerMembershipPaymentStatus, ConseillerPortalGate } from "../../../shared/conseillerMembership";
import { Button } from "../ui/Button";

export type PortalMembershipInfo = {
  required: boolean;
  paymentStatus: ConseillerMembershipPaymentStatus;
  gate: ConseillerPortalGate;
  stripeCheckoutUrl: string | null;
  validUntil: string | null;
  feeEur: number;
  validatedAt: string | null;
  paymentDeclaredAt: string | null;
};

function formatDateFr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export default function PartnerConseillerMembership({
  membership,
  portalToken,
  sessionAuth,
  previewToken,
  onUpdated,
}: {
  membership: PortalMembershipInfo;
  portalToken: string;
  sessionAuth?: boolean;
  previewToken?: string;
  onUpdated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const fee = membership.feeEur || CONSEILLER_ANNUAL_PLATFORM_FEE_EUR_TTC;
  const pending = membership.gate === "pending_validation";
  const expired = membership.gate === "expired";
  const canDeclare = membership.gate === "payment" || membership.gate === "expired";

  const declarePaid = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (previewToken) headers["x-lcif-preview"] = previewToken;
      const res = await fetch(
        `/api/apporteur-portal/${encodeURIComponent(portalToken)}/membership/declare-payment`,
        {
          method: "POST",
          headers,
          credentials: sessionAuth ? "include" : "same-origin",
          body: "{}",
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setErr(data.error || "Impossible d'enregistrer votre déclaration de paiement.");
        return;
      }
      setMsg("Paiement signalé — en attente de validation par Le Club Immobilier Français.");
      onUpdated();
    } catch {
      setErr("Erreur réseau");
    } finally {
      setBusy(false);
    }
  };

  const steps = [
    { id: "contract", label: "Contrat signé", done: true },
    {
      id: "pay",
      label: expired ? "Renouvellement cotisation" : "Cotisation annuelle",
      done: pending || membership.paymentStatus === "validated",
      active: canDeclare,
    },
    {
      id: "wait",
      label: "Validation du paiement",
      done: false,
      active: pending,
    },
    { id: "open", label: "Accès espace assurance", done: false, active: false },
  ];

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
      <div>
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 mb-1">
          Adhésion espace assurance
        </h2>
        <p className="text-xs text-slate-500">
          {expired
            ? `Votre accès d'un an est terminé. Renouvelez votre cotisation (${fee} € TTC) pour continuer.`
            : `Après signature du contrat, réglez la cotisation annuelle (${fee} € TTC) via Stripe. L'accès est ensuite validé manuellement pour 12 mois jour pour jour.`}
        </p>
      </div>

      <ol className="space-y-2">
        {steps.map((step) => (
          <li
            key={step.id}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 border ${
              step.done
                ? "bg-emerald-50 border-emerald-100"
                : step.active
                  ? "bg-indigo-50 border-indigo-200"
                  : "bg-slate-50 border-slate-100"
            }`}
          >
            {step.done ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : step.active ? (
              <CreditCard className="w-5 h-5 text-indigo-600 shrink-0" />
            ) : (
              <Circle className="w-5 h-5 text-slate-300 shrink-0" />
            )}
            <span
              className={`text-sm font-bold ${
                step.done ? "text-emerald-800" : step.active ? "text-indigo-900" : "text-slate-400"
              }`}
            >
              {step.label}
            </span>
          </li>
        ))}
      </ol>

      {pending ? (
        <p className="text-sm text-amber-900 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
          Paiement déclaré{membership.paymentDeclaredAt ? ` le ${formatDateFr(membership.paymentDeclaredAt)}` : ""}.
          L&apos;équipe valide manuellement votre cotisation — vous recevrez l&apos;accès dès confirmation.
        </p>
      ) : null}

      {membership.stripeCheckoutUrl ? (
        <a
          href={membership.stripeCheckoutUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700"
        >
          <ExternalLink className="w-4 h-4" />
          {expired ? "Renouveler sur Stripe" : "Payer la cotisation sur Stripe"} ({fee} €)
        </a>
      ) : (
        <p className="text-sm text-rose-800 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2.5">
          Aucun lien de paiement n&apos;est encore configuré. Contactez{" "}
          <a className="font-bold underline" href="mailto:assurance@leclubimmobilier.fr">
            assurance@leclubimmobilier.fr
          </a>
          .
        </p>
      )}

      {canDeclare && membership.stripeCheckoutUrl ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">
            Après le paiement Stripe, cliquez ci-dessous pour signaler votre règlement. L&apos;accès s&apos;ouvrira
            une fois le paiement validé en administration.
          </p>
          <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={declarePaid}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            J&apos;ai payé — demander la validation
          </Button>
        </div>
      ) : null}

      {err ? <p className="text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{err}</p> : null}
      {msg ? (
        <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">{msg}</p>
      ) : null}
    </section>
  );
}
