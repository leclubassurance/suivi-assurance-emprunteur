import React, { useState } from "react";
import { CheckCircle2, Loader2, Search } from "lucide-react";
import { getApiUrl } from "../../lib/utils";
import type { GouvEntrepriseMatch } from "../../../shared/gouvEntrepriseSearch";
import { resolveCompanyNamesFromRegistryLookup } from "../../../shared/companyRegistryName";
import { formatSirenDisplay, formatSiretDisplay, normalizeSiretInput } from "../../../shared/siret";

export type SiretLookupResult = GouvEntrepriseMatch;

type Props = {
  siret: string;
  onSiretChange: (value: string) => void;
  companyName: string;
  onCompanyNameChange: (value: string) => void;
  onVerified?: (match: SiretLookupResult) => void;
  required?: boolean;
};

async function lookupViaBackendProxy(raw: string): Promise<SiretLookupResult | null> {
  const res = await fetch(getApiUrl(`/api/public/entreprise-lookup?q=${encodeURIComponent(raw)}`));
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    throw new Error(json.error || "Vérification impossible.");
  }
  return (json.match as SiretLookupResult | null) || null;
}

export default function SiretLookupField({
  siret,
  onSiretChange,
  companyName,
  onCompanyNameChange,
  onVerified,
  required,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [match, setMatch] = useState<SiretLookupResult | null>(null);

  const verify = async () => {
    setLoading(true);
    setError(null);
    setMatch(null);
    try {
      const normalized = normalizeSiretInput(siret);
      if (!/^\d{9}$/.test(normalized) && !/^\d{14}$/.test(normalized)) {
        throw new Error("Saisissez un SIREN (9 chiffres) ou un SIRET (14 chiffres).");
      }

      const found = await lookupViaBackendProxy(siret);
      if (!found) {
        throw new Error("Aucune entreprise trouvée pour ce SIREN/SIRET au registre national.");
      }
      if (!found.isActive) {
        throw new Error("Cet établissement est radié ou inactif au registre.");
      }
      setMatch(found);
      const resolved = resolveCompanyNamesFromRegistryLookup(found);
      if (!companyName.trim() && resolved.suggestedCompanyName) {
        onCompanyNameChange(resolved.suggestedCompanyName);
      }
      onVerified?.(found);
    } catch (err: any) {
      setError(err?.message || "Erreur");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <label className="text-xs font-bold text-slate-600 block">
        SIRET / SIREN de la société
        {required ? <span className="text-red-500"> *</span> : null}
        <div className="mt-1 flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm font-normal"
            value={siret}
            placeholder="SIRET 14 chiffres ou SIREN 9 chiffres"
            onChange={(e) => {
              setMatch(null);
              setError(null);
              onSiretChange(e.target.value);
            }}
          />
          <button
            type="button"
            onClick={verify}
            disabled={loading || !siret.trim()}
            className="shrink-0 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            Vérifier
          </button>
        </div>
      </label>
      {match ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">{match.name}</p>
              {match.siret ? <p>SIRET : {formatSiretDisplay(match.siret)}</p> : null}
              <p>SIREN : {formatSirenDisplay(match.siren)}</p>
              {match.addressLine ? (
                <p className="text-emerald-700/80">
                  {match.addressLine}
                  {match.postalCode || match.city
                    ? ` — ${[match.postalCode, match.city].filter(Boolean).join(" ")}`
                    : ""}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
