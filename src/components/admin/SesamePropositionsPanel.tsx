/**
 * Présentation des propositions Sésame — même UI que le Lab (colonnes, cartes, totaux).
 * Source unique pour Lab + parcours étude dossier.
 */
import React, { useMemo } from "react";

export type SesameProposition = {
  type?: string;
  codeProduit: string;
  messages?: Array<{ texte?: string }>;
  tarifTotalAssurance?: number;
  tarifTotalCotisations?: number;
  tarifCotisationsXPremieresAnnees?: number;
  xPremieresAnnees?: number;
  reductionCouple?: boolean;
  prets?: Array<{ taea?: number; tauxMoyen?: number }>;
  marque: string;
  taea?: number;
  tauxMoyen?: number;
  baseTarif: "crd" | "capital_initial" | "inconnu";
  message?: string;
};

export type SesameAssureColumn = {
  referenceAssure: string;
  label: string;
  propositions: SesameProposition[];
};

export function euro(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(n);
}

export function pct(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Number(n).toFixed(3).replace(".", ",")} %`;
}

export function baseTarifFromCodeProduit(code: string): SesameProposition["baseTarif"] {
  const c = code.toUpperCase();
  if (/CRD|CLEUICD|UICD|_CD($|[^A-Z])/.test(c)) return "crd";
  if (/CLEUICI|INEOCI(?!RD)|UICI|_CI($|[^A-Z])/.test(c)) return "capital_initial";
  if (/\bCI\b|_CI_|CI$/.test(c) && !/CRD/.test(c)) return "capital_initial";
  return "inconnu";
}

/** Préfixes codes Sésame → marques affichées comme dans Kérys / Lab. */
export function marqueFromCodeProduit(code: string): string {
  const c = code.toUpperCase();
  if (c.startsWith("AXA_") || c.startsWith("AXA")) return "AXA";
  if (c.startsWith("CDI_") || c.includes("CARDIF") || c.includes("CLEU")) return "CARDIF";
  if (c.startsWith("GLI_") || c.startsWith("GENERALI")) return "GENERALI VIE";
  if (c.startsWith("HAMU_") || c.startsWith("HAM_")) return "Harmonie Mutuelle";
  if (c.startsWith("MCP_")) return "MCP";
  if (c.startsWith("MLF_") || c.startsWith("METLIFE")) return "MetLife";
  if (c.startsWith("MUL_")) return "SwissLife / Multirisque";
  if (c.startsWith("QTM_") || c.startsWith("QUATREM")) return "Quatrem / CNP";
  if (c.startsWith("SL_") || c.startsWith("SWISSLIFE")) return "SwissLife";
  if (c.startsWith("CNP_") || c.startsWith("CNPA_")) return "CNP";
  if (c.startsWith("ALL_") || c.startsWith("ALLIANZ")) return "Allianz";
  const head = code.split(/[_-]/)[0];
  return head || code;
}

function pickCodeProduit(t: any): string {
  return String(
    t?.codeProduit || t?.produit?.codeProduit || t?.code || t?.produit?.code || "",
  ).trim();
}

export function mapTarifToProposition(t: any): SesameProposition | null {
  const codeProduit = pickCodeProduit(t);
  if (!codeProduit) return null;
  const pret0 = Array.isArray(t?.prets) ? t.prets[0] : undefined;
  return {
    ...t,
    codeProduit,
    marque: marqueFromCodeProduit(codeProduit),
    baseTarif: baseTarifFromCodeProduit(codeProduit),
    taea: pret0?.taea ?? t?.taea,
    tauxMoyen: pret0?.tauxMoyen ?? t?.tauxMoyen,
    message:
      String(t?.message || t?.motif || t?.libelleErreur || t?.erreur || "").trim() || undefined,
  };
}

function normalizeTarifPayload(data: unknown): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const o = data as any;
    if (Array.isArray(o.assures)) return o.assures;
    if (Array.isArray(o.liste)) return o.liste;
    if (Array.isArray(o.tarifs)) return [{ referenceAssure: "ASSURE001", tarifs: o.tarifs }];
    if (Array.isArray(o.data)) return normalizeTarifPayload(o.data);
  }
  return [];
}

/** Réponse Sésame = 1 bloc par assuré (`referenceAssure` + `tarifs[]`). */
export function extractPropositionsByAssure(
  data: unknown,
  assureForms: Array<{ civilite?: string; prenom?: string; nom?: string }>,
): SesameAssureColumn[] {
  const list = normalizeTarifPayload(data);
  if (!list.length) return [];

  const looksLikeAssureBlocks = list.some(
    (block: any) => block && (Array.isArray(block.tarifs) || block.referenceAssure),
  );

  if (looksLikeAssureBlocks) {
    return list.map((block: any, i: number) => {
      const ref = String(block?.referenceAssure || `ASSURE${String(i + 1).padStart(3, "0")}`);
      const form = assureForms[i];
      const name = [form?.prenom, form?.nom].filter(Boolean).join(" ").trim();
      const civilite = form?.civilite || "";
      const who = [civilite, name].filter(Boolean).join(" ").trim();
      const tarifs = Array.isArray(block?.tarifs) ? block.tarifs : [];
      const propositions = tarifs
        .map(mapTarifToProposition)
        .filter((p: SesameProposition | null): p is SesameProposition => Boolean(p))
        .sort(
          (a, b) => (a.tarifTotalAssurance ?? Infinity) - (b.tarifTotalAssurance ?? Infinity),
        );
      return {
        referenceAssure: ref,
        label: who ? `Assuré ${i + 1} — ${who}` : `Assuré ${i + 1}`,
        propositions,
      };
    });
  }

  const propositions = list
    .map(mapTarifToProposition)
    .filter((p: SesameProposition | null): p is SesameProposition => Boolean(p))
    .sort((a, b) => (a.tarifTotalAssurance ?? Infinity) - (b.tarifTotalAssurance ?? Infinity));
  const form = assureForms[0];
  const name = [form?.prenom, form?.nom].filter(Boolean).join(" ").trim();
  const civilite = form?.civilite || "";
  const who = [civilite, name].filter(Boolean).join(" ").trim();
  return [
    {
      referenceAssure: "ASSURE001",
      label: who ? `Assuré 1 — ${who}` : "Assuré 1",
      propositions,
    },
  ];
}

export function isTarifable(p: SesameProposition) {
  return !p.type || p.type === "TARIFABLE";
}

export function filterProps(
  list: SesameProposition[],
  propFilter: "tous" | "crd" | "capital_initial",
) {
  if (propFilter === "tous") return list;
  return list.filter((p) => p.baseTarif === propFilter);
}

export function defaultSelections(byAssure: SesameAssureColumn[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!byAssure.length) return out;
  if (byAssure.length === 1) {
    const best = byAssure[0].propositions.find(isTarifable);
    if (best) out[byAssure[0].referenceAssure] = best.codeProduit;
    return out;
  }
  let bestCode: string | null = null;
  let bestTotal = Infinity;
  for (const p0 of byAssure[0].propositions.filter(isTarifable)) {
    const matches = byAssure
      .slice(1)
      .map((a) => a.propositions.find((p) => p.codeProduit === p0.codeProduit && isTarifable(p)));
    if (matches.some((m) => !m)) continue;
    const total =
      (p0.tarifTotalAssurance ?? 0) +
      matches.reduce((s, m) => s + (m!.tarifTotalAssurance ?? 0), 0);
    if (total < bestTotal) {
      bestTotal = total;
      bestCode = p0.codeProduit;
    }
  }
  if (bestCode) {
    for (const a of byAssure) out[a.referenceAssure] = bestCode;
    return out;
  }
  for (const a of byAssure) {
    const best = a.propositions.find(isTarifable);
    if (best) out[a.referenceAssure] = best.codeProduit;
  }
  return out;
}

export function findProp(
  byAssure: SesameAssureColumn[],
  ref: string,
  code: string | undefined,
): SesameProposition | null {
  if (!code) return null;
  const col = byAssure.find((a) => a.referenceAssure === ref);
  return col?.propositions.find((p) => p.codeProduit === code) || null;
}

export function PropositionCard({
  p,
  selected,
  showCoupleBadge,
  onSelect,
}: {
  p: SesameProposition;
  selected: boolean;
  showCoupleBadge?: boolean;
  onSelect: () => void;
}) {
  const nonAssurable = !isTarifable(p);
  const baseLabel =
    p.baseTarif === "crd" ? "CRD" : p.baseTarif === "capital_initial" ? "Capital initial" : null;
  return (
    <button
      type="button"
      disabled={Boolean(nonAssurable)}
      onClick={onSelect}
      className={`w-full text-left rounded-xl border px-3 py-2.5 transition ${
        selected
          ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200"
          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
      } ${nonAssurable ? "opacity-60 cursor-not-allowed" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-bold text-slate-900">{p.marque}</span>
            {baseLabel ? (
              <span
                className={`rounded-full text-[10px] font-bold px-1.5 py-0.5 border ${
                  p.baseTarif === "crd"
                    ? "bg-teal-50 text-teal-800 border-teal-200"
                    : "bg-violet-50 text-violet-800 border-violet-200"
                }`}
              >
                {baseLabel}
              </span>
            ) : null}
            {selected ? (
              <span className="rounded-full bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5">
                OK
              </span>
            ) : null}
            {showCoupleBadge && p.reductionCouple ? (
              <span className="rounded-full bg-blue-50 text-blue-700 text-[10px] font-semibold px-1.5 py-0.5 border border-blue-100">
                Couple
              </span>
            ) : null}
            {nonAssurable ? (
              <span className="rounded-full bg-amber-50 text-amber-800 text-[10px] font-semibold px-1.5 py-0.5 border border-amber-100">
                {p.type}
              </span>
            ) : null}
          </div>
          <p className="text-[10px] font-mono text-slate-400 mt-0.5 truncate">{p.codeProduit}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-base font-bold text-slate-900">{euro(p.tarifTotalAssurance)}</p>
          <p className="text-[10px] text-slate-500">assurance</p>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5 text-[10px]">
        <div className="rounded bg-slate-50 px-1.5 py-1">
          <p className="text-slate-500">8 ans</p>
          <p className="font-semibold text-slate-800">{euro(p.tarifCotisationsXPremieresAnnees)}</p>
        </div>
        <div className="rounded bg-slate-50 px-1.5 py-1">
          <p className="text-slate-500">TAEA</p>
          <p className="font-semibold text-slate-800">{pct(p.taea)}</p>
        </div>
        <div className="rounded bg-slate-50 px-1.5 py-1">
          <p className="text-slate-500">Taux moy.</p>
          <p className="font-semibold text-slate-800">{pct(p.tauxMoyen)}</p>
        </div>
      </div>
      {nonAssurable && p.message ? (
        <p className="mt-1.5 text-[10px] text-amber-800">{p.message}</p>
      ) : null}
    </button>
  );
}

export function SesamePropositionsBoard({
  byAssure,
  selectedByAssure,
  onSelect,
  propFilter,
  onPropFilterChange,
  coupleApplies = false,
  coupleBanner = null,
  footerHint = null,
}: {
  byAssure: SesameAssureColumn[];
  selectedByAssure: Record<string, string>;
  onSelect: (referenceAssure: string, codeProduit: string) => void;
  propFilter: "tous" | "crd" | "capital_initial";
  onPropFilterChange: (f: "tous" | "crd" | "capital_initial") => void;
  coupleApplies?: boolean;
  coupleBanner?: React.ReactNode;
  footerHint?: React.ReactNode;
}) {
  const selectedProps = useMemo(
    () => byAssure.map((col) => findProp(byAssure, col.referenceAssure, selectedByAssure[col.referenceAssure])),
    [byAssure, selectedByAssure],
  );
  const allSelected = byAssure.length > 0 && selectedProps.every(Boolean);
  const totalAssurance = selectedProps.reduce(
    (s, p) => s + (p?.tarifTotalAssurance != null && Number.isFinite(p.tarifTotalAssurance) ? p.tarifTotalAssurance : 0),
    0,
  );
  const totalCotisations = selectedProps.reduce(
    (s, p) =>
      s + (p?.tarifTotalCotisations != null && Number.isFinite(p.tarifTotalCotisations) ? p.tarifTotalCotisations : 0),
    0,
  );
  const total8Ans = selectedProps.reduce(
    (s, p) =>
      s +
      (p?.tarifCotisationsXPremieresAnnees != null && Number.isFinite(p.tarifCotisationsXPremieresAnnees)
        ? p.tarifCotisationsXPremieresAnnees
        : 0),
    0,
  );

  if (!byAssure.length) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5 justify-end">
        {(
          [
            { id: "tous" as const, label: "Tous" },
            { id: "crd" as const, label: "CRD" },
            { id: "capital_initial" as const, label: "Capital initial" },
          ] as const
        ).map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onPropFilterChange(f.id)}
            className={`rounded-full px-3 py-1 text-[11px] font-semibold border ${
              propFilter === f.id
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {coupleBanner}

      <div
        className={`grid gap-4 items-start ${
          byAssure.length >= 2 ? "md:grid-cols-2" : "grid-cols-1"
        }`}
      >
        {byAssure.map((col, colIndex) => {
          const filtered = filterProps(col.propositions, propFilter);
          const selectedCode = selectedByAssure[col.referenceAssure];
          const accent =
            colIndex === 0
              ? {
                  wrap: "border-sky-300 bg-sky-50/70",
                  title: "text-sky-950",
                  chip: "bg-sky-700 text-white",
                }
              : {
                  wrap: "border-rose-300 bg-rose-50/70",
                  title: "text-rose-950",
                  chip: "bg-rose-700 text-white",
                };
          return (
            <div
              key={col.referenceAssure}
              className={`rounded-xl border-2 p-3 space-y-2 min-w-0 ${accent.wrap}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${accent.chip}`}
                  >
                    Colonne {colIndex + 1}
                  </span>
                  <h3 className={`text-base font-bold mt-1 ${accent.title}`}>{col.label}</h3>
                  <p className="text-[11px] text-slate-600">
                    Choisis l’assurance pour cette personne uniquement
                  </p>
                </div>
                <span className="text-[10px] font-mono text-slate-400 shrink-0">
                  {col.referenceAssure}
                </span>
              </div>
              {selectedCode ? (
                <p className={`text-xs font-medium ${accent.title}`}>
                  Sélection :{" "}
                  <strong>{findProp(byAssure, col.referenceAssure, selectedCode)?.marque || "—"}</strong>{" "}
                  <span className="font-mono opacity-70">{selectedCode}</span>
                  {" · "}
                  {euro(findProp(byAssure, col.referenceAssure, selectedCode)?.tarifTotalAssurance)}
                </p>
              ) : (
                <p className="text-xs text-amber-800 font-medium">Sélectionne une proposition ci-dessous</p>
              )}
              <ul className="space-y-2 max-h-[32rem] overflow-auto pr-1">
                {filtered.map((p) => (
                  <li key={`${col.referenceAssure}-${p.codeProduit}`}>
                    <PropositionCard
                      p={p}
                      selected={p.codeProduit === selectedCode}
                      showCoupleBadge={coupleApplies}
                      onSelect={() => onSelect(col.referenceAssure, p.codeProduit)}
                    />
                  </li>
                ))}
              </ul>
              {filtered.length === 0 ? (
                <p className="text-sm text-slate-500">Aucune proposition pour ce filtre.</p>
              ) : null}
            </div>
          );
        })}
      </div>

      {allSelected ? (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                Coût total sélection
              </p>
              <p className="text-2xl font-bold text-emerald-950">{euro(totalAssurance)}</p>
              <p className="text-xs text-emerald-800/80 mt-0.5">
                Cotisations {euro(totalCotisations)}
                {" · "}8 premières années {euro(total8Ans)}
                {coupleApplies ? " · réduction couple incluse" : ""}
              </p>
            </div>
            <div className="text-xs text-emerald-900 space-y-0.5">
              {selectedProps.map((p, i) =>
                p ? (
                  <p key={byAssure[i]?.referenceAssure || i}>
                    Assuré {i + 1} : <strong>{p.marque}</strong> {euro(p.tarifTotalAssurance)}
                  </p>
                ) : null,
              )}
            </div>
          </div>
          {footerHint}
        </div>
      ) : null}
    </div>
  );
}
