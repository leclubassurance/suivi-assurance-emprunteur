import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FileSignature, Loader2, UserPen } from "lucide-react";
import { getApiUrl, apiFetch } from "../../lib/utils";
import ApporteurProfileFormFields, {
  apporteurToProfileForm,
  type ApporteurProfileFormState,
} from "./ApporteurProfileFormFields";

type ContractSection = { heading: string; body: string };

type ContractDocument = {
  version: string;
  title: string;
  preamble: string;
  sections: ContractSection[];
  acceptanceLabel: string;
};

type ContractPayload = {
  signed: boolean;
  signedAt: string | null;
  document: ContractDocument;
  signerHint: string;
  profileComplete: boolean;
  profile: ApporteurProfileFormState;
};

export default function PartnerContractSigning({
  portalToken,
  onSigned,
  sessionAuth = false,
  previewToken,
}: {
  portalToken: string;
  onSigned: () => void;
  sessionAuth?: boolean;
  previewToken?: string;
}) {
  const withPreview = (path: string) => {
    if (!previewToken) return path;
    const sep = path.includes("?") ? "&" : "?";
    return `${path}${sep}lcif_preview=${encodeURIComponent(previewToken)}`;
  };
  const portalFetch = (path: string, init?: RequestInit) => {
    const full = withPreview(path);
    if (previewToken) return fetch(getApiUrl(full), init);
    if (sessionAuth) return apiFetch(full, init);
    return fetch(getApiUrl(full), init);
  };
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [signedSuccess, setSignedSuccess] = useState<{ pdfUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ContractPayload | null>(null);
  const [step, setStep] = useState<"profile" | "contract">("profile");
  const [profileForm, setProfileForm] = useState<ApporteurProfileFormState | null>(null);
  const [signerName, setSignerName] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [emailOtp, setEmailOtp] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [otpSentHint, setOtpSentHint] = useState<string | null>(null);

  const loadContract = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await portalFetch(`/api/apporteur-portal/${encodeURIComponent(portalToken)}/contract`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Impossible de charger le contrat.");
      }
      if (json.signed) {
        onSigned();
        return;
      }
      const profile = apporteurToProfileForm(json.profile || {});
      setProfileForm(profile);
      setPayload({
        signed: json.signed,
        signedAt: json.signedAt,
        document: json.document,
        signerHint: json.signerHint,
        profileComplete: Boolean(json.profileComplete),
        profile,
      });
      setStep(json.profileComplete ? "contract" : "profile");
      const hint = [profile.contactPrenom, profile.contactNom].filter(Boolean).join(" ") || json.signerHint || "";
      setSignerName(hint);
    } catch (err: any) {
      setError(err?.message || "Erreur");
    } finally {
      setLoading(false);
    }
  }, [portalToken, onSigned]);

  useEffect(() => {
    loadContract();
  }, [loadContract]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
      setScrolledToEnd(true);
    }
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileForm) return;
    setSavingProfile(true);
    setError(null);
    try {
      const res = await portalFetch(
        `/api/apporteur-portal/${encodeURIComponent(portalToken)}/profile`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(profileForm),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Enregistrement impossible.");
      }
      const profile = apporteurToProfileForm(json.profile || profileForm);
      setProfileForm(profile);
      setPayload((prev) =>
        prev
          ? {
              ...prev,
              profile,
              profileComplete: Boolean(json.profileComplete),
              document: prev.document,
            }
          : prev,
      );
      setSignerName([profile.contactPrenom, profile.contactNom].filter(Boolean).join(" "));
      if (json.profileComplete) {
        const contractRes = await portalFetch(
          `/api/apporteur-portal/${encodeURIComponent(portalToken)}/contract`,
        );
        const contractJson = await contractRes.json().catch(() => ({}));
        if (contractRes.ok && contractJson.ok) {
          setPayload((prev) =>
            prev
              ? {
                  ...prev,
                  document: contractJson.document,
                  signerHint: contractJson.signerHint,
                  profileComplete: true,
                  profile,
                }
              : prev,
          );
        }
        setStep("contract");
      }
    } catch (err: any) {
      setError(err?.message || "Erreur");
    } finally {
      setSavingProfile(false);
    }
  };

  const requestOtp = async () => {
    setOtpSending(true);
    setError(null);
    try {
      const res = await portalFetch(
        `/api/apporteur-portal/${encodeURIComponent(portalToken)}/contract/otp`,
        { method: "POST" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Envoi du code impossible.");
      }
      setOtpSentHint(json.maskedEmail ? `Code envoyé à ${json.maskedEmail}` : "Code envoyé par email.");
    } catch (err: any) {
      setError(err?.message || "Erreur");
    } finally {
      setOtpSending(false);
    }
  };

  const handleSign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acceptTerms) {
      setError("Vous devez accepter le contrat.");
      return;
    }
    if (!emailOtp.trim()) {
      setError("Saisissez le code reçu par email.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await portalFetch(
        `/api/apporteur-portal/${encodeURIComponent(portalToken)}/contract/sign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signerName, acceptTerms: true, emailOtp: emailOtp.trim() }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Signature impossible.");
      }
      if (json.alreadySigned) {
        onSigned();
        return;
      }
      const pdfPath = json.pdfUrl || `/api/apporteur-portal/${encodeURIComponent(portalToken)}/contract/pdf`;
      setSignedSuccess({ pdfUrl: getApiUrl(pdfPath) });
      setTimeout(() => onSigned(), 2500);
    } catch (err: any) {
      setError(err?.message || "Erreur");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!payload || !profileForm) {
    return (
      <div className="bg-white rounded-2xl border border-red-100 p-6 text-center text-red-700 text-sm">
        {error || "Contrat indisponible."}
      </div>
    );
  }

  if (signedSuccess) {
    return (
      <section className="bg-white rounded-2xl border border-emerald-200 p-6 text-center shadow-sm">
        <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
        <h2 className="text-lg font-black text-emerald-800 mb-2">Contrat signé</h2>
        <p className="text-sm text-slate-600 mb-4">
          Une copie PDF vous a été envoyée par email. Votre espace partenaire se débloque…
        </p>
        <a
          href={signedSuccess.pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700"
        >
          Télécharger le PDF
        </a>
      </section>
    );
  }

  if (step === "profile") {
    return (
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-[#1E3A8A] text-white px-5 py-4">
          <div className="flex items-center gap-2 mb-1">
            <UserPen className="w-5 h-5 text-amber-300" />
            <h2 className="text-sm font-black uppercase tracking-wide">Vos informations contractuelles</h2>
          </div>
          <p className="text-xs text-indigo-100">
            Renseignez chaque champ distinctement — ces données figureront telles quelles dans le contrat.
          </p>
        </div>

        <form onSubmit={saveProfile} className="px-5 py-4 space-y-3">
          <ApporteurProfileFormFields value={profileForm} onChange={setProfileForm} emailEditable={false} />

          {error ? <p className="text-xs text-red-600 font-medium">{error}</p> : null}

          <button
            type="submit"
            disabled={savingProfile}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-sm disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {savingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSignature className="w-4 h-4" />}
            {savingProfile ? "Enregistrement…" : "Continuer vers le contrat"}
          </button>
        </form>
      </section>
    );
  }

  const doc = payload.document;

  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="bg-[#1E3A8A] text-white px-5 py-4">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2">
            <FileSignature className="w-5 h-5 text-amber-300" />
            <h2 className="text-sm font-black uppercase tracking-wide">Signature du contrat partenaire</h2>
          </div>
          <button
            type="button"
            onClick={() => setStep("profile")}
            className="text-[10px] font-bold uppercase tracking-wide text-indigo-100 hover:text-white underline"
          >
            Modifier mes infos
          </button>
        </div>
        <p className="text-xs text-indigo-100">
          Dernière étape avant d&apos;accéder à votre lien client et au suivi de vos dossiers clients.
        </p>
      </div>

      <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
        <h3 className="font-black text-slate-900 text-base">{doc.title}</h3>
        <p className="text-xs text-slate-500 mt-1">{doc.preamble}</p>
      </div>

      <div
        className="max-h-[420px] overflow-y-auto px-5 py-4 space-y-4 text-sm text-slate-700 leading-relaxed"
        onScroll={handleScroll}
      >
        {doc.sections.map((section) => (
          <article key={section.heading}>
            <h4 className="font-bold text-slate-900 mb-1.5">{section.heading}</h4>
            <div className="whitespace-pre-wrap text-[13px]">{section.body}</div>
          </article>
        ))}
      </div>

      {!scrolledToEnd ? (
        <p className="text-[11px] text-amber-700 bg-amber-50 border-t border-amber-100 px-5 py-2">
          Faites défiler le contrat jusqu&apos;en bas pour activer la signature.
        </p>
      ) : null}

      <form onSubmit={handleSign} className="px-5 py-4 border-t border-slate-100 space-y-3 bg-slate-50/80">
        <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={acceptTerms}
            onChange={(e) => setAcceptTerms(e.target.checked)}
            disabled={!scrolledToEnd}
            className="mt-0.5 rounded border-slate-300"
          />
          <span>{doc.acceptanceLabel}</span>
        </label>

        <label className="block text-xs font-bold text-slate-600">
          Nom complet (signature électronique)
          <input
            type="text"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            disabled={!scrolledToEnd}
            placeholder={payload.signerHint}
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-normal disabled:opacity-50"
          />
        </label>

        <label className="block text-xs font-bold text-slate-600">
          Code de validation (envoyé à votre email)
          <div className="mt-1 flex flex-wrap gap-2">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={emailOtp}
              onChange={(e) => setEmailOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              disabled={!scrolledToEnd}
              placeholder="6 chiffres"
              className="flex-1 min-w-[120px] border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-normal tracking-widest disabled:opacity-50"
            />
            <button
              type="button"
              onClick={requestOtp}
              disabled={!scrolledToEnd || otpSending}
              className="px-3 py-2.5 rounded-lg border border-indigo-200 text-indigo-700 text-xs font-bold hover:bg-indigo-50 disabled:opacity-50"
            >
              {otpSending ? "Envoi…" : "Recevoir un code"}
            </button>
          </div>
          {otpSentHint ? <span className="block mt-1 text-[10px] font-normal text-slate-500">{otpSentHint}</span> : null}
        </label>

        {error ? <p className="text-xs text-red-600 font-medium">{error}</p> : null}

        <button
          type="submit"
          disabled={submitting || !scrolledToEnd || !acceptTerms || !signerName.trim() || emailOtp.trim().length < 6}
          className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {submitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <CheckCircle2 className="w-4 h-4" />
          )}
          {submitting ? "Signature en cours…" : "Signer et débloquer mon espace"}
        </button>

        <p className="text-[10px] text-slate-400 text-center">
          Horodatage, code email et identité enregistrés par Le Club Immobilier Français · version {doc.version}
        </p>
      </form>
    </section>
  );
}
