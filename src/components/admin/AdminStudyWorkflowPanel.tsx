import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  ChevronRight,
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type { KereisDraft, KereisField } from "../../../shared/kereisDraftTypes";

type Feasibility = {
  score?: number;
  max?: number;
  pass?: boolean;
  mode?: string;
  modeLabel?: string;
  blockers?: string[];
  checks?: Array<{ ok: boolean; label: string; detail?: string; earned: number; points: number }>;
  summary?: {
    hasDevis?: boolean;
    currentTotalEur?: number | null;
    proposedTotalEur?: number | null;
  };
};

type Proposition = {
  codeProduit: string;
  marque?: string;
  baseTarif?: "crd" | "capital_initial" | "autre";
  type?: string;
  tarifTotalAssurance?: number;
  cotisationMensuelleMoyenne?: number;
  prets?: Array<{ taea?: number; tauxMoyen?: number }>;
};

type AssureCol = {
  referenceAssure: string;
  label: string;
  propositions: Proposition[];
};

const STEPS = [
  { n: 1, label: "Remplir Kereis" },
  { n: 2, label: "Contrôler" },
  { n: 3, label: "Simuler" },
  { n: 4, label: "Choisir" },
  { n: 5, label: "Générer l'étude" },
];

function marqueFromCode(code: string): string {
  const c = code.toUpperCase();
  if (c.startsWith("GEN_") || c.startsWith("GENERALI")) return "Generali";
  if (c.startsWith("CAR_") || c.startsWith("CARDIF")) return "Cardif";
  if (c.startsWith("CNP_") || c.startsWith("CNPA_")) return "CNP";
  if (c.startsWith("AXA")) return "AXA";
  if (c.startsWith("MCP_")) return "MCP";
  if (c.startsWith("MLF_") || c.startsWith("METLIFE")) return "MetLife";
  if (c.startsWith("SL_") || c.startsWith("SWISSLIFE")) return "SwissLife";
  if (c.startsWith("ALL_") || c.startsWith("ALLIANZ")) return "Allianz";
  return code.split(/[_-]/)[0] || code;
}

function baseTarifFromCode(code: string): Proposition["baseTarif"] {
  const c = code.toUpperCase();
  if (/_CI_|CAPITAL.?INITIAL|CI$/.test(c) || /_CI_/.test(c)) return "capital_initial";
  if (/_CRD_|CRD/.test(c)) return "crd";
  return "autre";
}

function mapProp(t: any): Proposition | null {
  if (!t?.codeProduit) return null;
  return {
    ...t,
    codeProduit: String(t.codeProduit),
    marque: marqueFromCode(String(t.codeProduit)),
    baseTarif: baseTarifFromCode(String(t.codeProduit)),
  };
}

function extractByAssure(data: unknown, draft: KereisDraft | null): AssureCol[] {
  if (!Array.isArray(data)) return [];
  const prenom = draft?.steps?.coordonnees?.find((f) => /prenom/i.test(f.label))?.value;
  const nom = draft?.steps?.coordonnees?.find((f) => /^nom$/i.test(f.label) || /nom$/i.test(f.label))?.value;
  const who = [prenom, nom].filter(Boolean).join(" ").trim();

  const looksLikeBlocks = data.some(
    (b: any) => b && (Array.isArray(b.tarifs) || b.referenceAssure),
  );
  if (looksLikeBlocks) {
    return data.map((block: any, i: number) => {
      const ref = String(block?.referenceAssure || `ASSURE${String(i + 1).padStart(3, "0")}`);
      const tarifs = Array.isArray(block?.tarifs) ? block.tarifs : [];
      const propositions = tarifs
        .map(mapProp)
        .filter((p: Proposition | null): p is Proposition => Boolean(p))
        .sort(
          (a, b) => (a.tarifTotalAssurance ?? Infinity) - (b.tarifTotalAssurance ?? Infinity),
        );
      return {
        referenceAssure: ref,
        label: who && i === 0 ? `Assuré ${i + 1} — ${who}` : `Assuré ${i + 1}`,
        propositions,
      };
    });
  }
  const propositions = data
    .map(mapProp)
    .filter((p: Proposition | null): p is Proposition => Boolean(p))
    .sort((a, b) => (a.tarifTotalAssurance ?? Infinity) - (b.tarifTotalAssurance ?? Infinity));
  return [
    {
      referenceAssure: "ASSURE001",
      label: who ? `Assuré 1 — ${who}` : "Assuré 1",
      propositions,
    },
  ];
}

function isTarifable(p: Proposition) {
  return !p.type || p.type === "TARIFABLE";
}

function defaultSelections(cols: AssureCol[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cols.length) return out;
  if (cols.length === 1) {
    const best = cols[0].propositions.find(isTarifable);
    if (best) out[cols[0].referenceAssure] = best.codeProduit;
    return out;
  }
  let bestCode: string | null = null;
  let bestTotal = Infinity;
  for (const p0 of cols[0].propositions.filter(isTarifable)) {
    const matches = cols.slice(1).map((a) =>
      a.propositions.find((p) => p.codeProduit === p0.codeProduit && isTarifable(p)),
    );
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
    for (const a of cols) out[a.referenceAssure] = bestCode;
    return out;
  }
  for (const a of cols) {
    const best = a.propositions.find(isTarifable);
    if (best) out[a.referenceAssure] = best.codeProduit;
  }
  return out;
}

function fmtEur(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`;
}

function fieldKey(section: string, idx: number, label: string) {
  return `${section}:${idx}:${label}`;
}

function FeasibilityBadge({ f }: { f: Feasibility | null }) {
  if (!f || f.score == null) {
    return (
      <span className="text-xs text-slate-500 border border-slate-200 bg-white px-2.5 py-1.5 rounded-lg">
        Score non calculé
      </span>
    );
  }
  const score = f.score;
  const tone =
    score >= 10
      ? "bg-emerald-50 text-emerald-900 border-emerald-200"
      : score >= 8
        ? "bg-amber-50 text-amber-950 border-amber-200"
        : "bg-orange-50 text-orange-950 border-orange-200";
  const hint =
    score >= 10
      ? "tableaux très fiables"
      : score >= 8
        ? "OK pour générer (vérifier coût actuel)"
        : "risque sur le coût actuel — contrôlez avant de forcer";
  return (
    <span className={`text-xs font-bold px-2.5 py-1.5 rounded-lg border ${tone}`}>
      Faisabilité {score}/{f.max ?? 10} · {hint}
    </span>
  );
}

function renderKereisField(
  f: KereisField,
  value: string,
  onChange: (v: string) => void,
) {
  const missing = f.confidence === "missing" || value === "";
  const display = value == null ? "" : String(value);
  return (
    <label className="block text-xs">
      <span className="font-semibold text-slate-700 flex items-center gap-1.5">
        {f.label}
        {missing ? (
          <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1 rounded">
            à vérifier
          </span>
        ) : null}
      </span>
      <input
        className={`mt-1 w-full rounded-lg border px-2.5 py-1.5 text-sm ${
          missing ? "border-amber-300 bg-amber-50/40" : "border-slate-200 bg-white"
        }`}
        value={display}
        onChange={(e) => onChange(e.target.value)}
      />
      {f.note ? <span className="text-[10px] text-slate-500 mt-0.5 block">{f.note}</span> : null}
    </label>
  );
}

export default function AdminStudyWorkflowPanel({
  dossierId,
  initialDraft,
  initialFeasibility,
  adminFetch,
  onDossierUpdated,
  onStudyGenerated,
}: {
  dossierId: string;
  initialDraft?: KereisDraft | null;
  initialFeasibility?: Feasibility | null;
  adminFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onDossierUpdated?: () => void;
  onStudyGenerated?: (data: {
    subject?: string;
    html?: string;
    fileName?: string;
    grossSavingsEur?: number | null;
  }) => void;
}) {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<KereisDraft | null>(initialDraft || null);
  const [feasibility, setFeasibility] = useState<Feasibility | null>(initialFeasibility || null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [cols, setCols] = useState<AssureCol[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"tous" | "crd" | "capital_initial">("crd");
  const [forceGenerate, setForceGenerate] = useState(false);
  const [sesameOk, setSesameOk] = useState<boolean | null>(null);

  useEffect(() => {
    setDraft(initialDraft || null);
  }, [initialDraft, dossierId]);

  useEffect(() => {
    setFeasibility(initialFeasibility || null);
  }, [initialFeasibility, dossierId]);

  const patchesFromEdits = useCallback(() => {
    const patches: Record<string, string> = {};
    for (const [key, val] of Object.entries(edits)) {
      const label = key.split(":").slice(2).join(":");
      if (label) patches[label] = String(val ?? "");
    }
    return patches;
  }, [edits]);

  const syncEditsFromDraft = useCallback((d: KereisDraft) => {
    const next: Record<string, string> = {};
    const put = (section: string, fields: KereisField[]) => {
      fields.forEach((f, i) => {
        next[fieldKey(section, i, f.label)] = f.value == null ? "" : String(f.value);
      });
    };
    put("coordonnees", d.steps.coordonnees || []);
    put("infosPerso", d.steps.infosPerso || []);
    (d.steps.prets || []).forEach((loan, li) => put(`pret${li}`, loan.fields || []));
    put("preteur", d.steps.preteur || []);
    put("simulations", d.steps.simulations || []);
    setEdits(next);
  }, []);

  useEffect(() => {
    if (draft) syncEditsFromDraft(draft);
  }, [draft?.computedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const prepare = async (force = false) => {
    setBusy("prepare");
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/dossiers/${dossierId}/study-workflow/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Préparation impossible");
        return;
      }
      setDraft(data.kereisDraft || null);
      if (data.kereisDraft) syncEditsFromDraft(data.kereisDraft);
      setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      setFeasibility(data.feasibility || null);
      setSesameOk(data.sesameStatus?.labAllowed !== false && data.sesameStatus?.basicAuthConfigured);
      setStep(2);
      onDossierUpdated?.();
    } catch {
      setError("Erreur réseau (préparation)");
    } finally {
      setBusy(null);
    }
  };

  const saveControl = async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setBusy("save");
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/dossiers/${dossierId}/kereis-draft`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patches: patchesFromEdits() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Sauvegarde impossible");
        return false;
      }
      setDraft(data.kereisDraft || null);
      setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      onDossierUpdated?.();
      return true;
    } catch {
      setError("Erreur réseau (sauvegarde)");
      return false;
    } finally {
      if (!opts?.quiet) setBusy(null);
    }
  };

  const simulate = async () => {
    setBusy("simulate");
    setError(null);
    setHint(null);
    try {
      const saved = await saveControl({ quiet: true });
      if (!saved && !draft) return;
      const res = await adminFetch(`/api/admin/dossiers/${dossierId}/study-workflow/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patches: patchesFromEdits() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || "Simulation Sésame impossible");
        setStep(3);
        return;
      }
      if (data.kereisDraft) setDraft(data.kereisDraft);
      const extracted = extractByAssure(data.data, data.kereisDraft || draft);
      setCols(extracted);
      setSelected(defaultSelections(extracted));
      setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      setStep(4);
      onDossierUpdated?.();
    } catch {
      setError("Erreur réseau (simulation)");
    } finally {
      setBusy(null);
    }
  };

  const generate = async () => {
    setBusy("generate");
    setError(null);
    setHint(null);
    try {
      const res = await adminFetch(`/api/admin/dossiers/${dossierId}/study-workflow/generate-study`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedByAssure: selected, forceGenerate }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Génération impossible");
        setHint(data.hint || null);
        if (data.feasibility) setFeasibility(data.feasibility);
        if (data.code === "low_feasibility" && !forceGenerate) {
          setForceGenerate(true);
        }
        onDossierUpdated?.();
        return;
      }
      if (data.feasibility) setFeasibility(data.feasibility);
      setStep(5);
      onStudyGenerated?.({
        subject: data.studyDraft?.subject,
        html: data.studyDraft?.html,
        fileName: data.studyPdf?.fileName,
        grossSavingsEur: data.computation?.grossSavingsEur ?? data.parsed?.grossSavingsEur ?? null,
      });
      onDossierUpdated?.();
    } catch {
      setError("Erreur réseau (génération)");
    } finally {
      setBusy(null);
    }
  };

  const filteredCols = useMemo(() => {
    return cols.map((c) => ({
      ...c,
      propositions:
        filter === "tous"
          ? c.propositions
          : c.propositions.filter((p) => p.baseTarif === filter || !isTarifable(p)),
    }));
  }, [cols, filter]);

  const allSelected = cols.length > 0 && cols.every((c) => selected[c.referenceAssure]);

  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50/40 px-4 py-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-900">Parcours étude (étapes Sésame)</p>
          <p className="text-xs text-slate-600 mt-1 max-w-2xl leading-relaxed">
            Remplir la fiche → contrôle visuel → Simuler → choisir l&apos;assurance → Générer
            l&apos;étude. Le score guide la fiabilité du <em>coût actuel</em> (tableaux) ; le devis
            vient de Sésame.
          </p>
        </div>
        <FeasibilityBadge f={feasibility} />
      </div>

      <ol className="flex flex-wrap gap-1.5">
        {STEPS.map((s) => {
          const active = step === s.n;
          const done = step > s.n;
          return (
            <li
              key={s.n}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold border ${
                active
                  ? "bg-teal-700 text-white border-teal-800"
                  : done
                    ? "bg-white text-teal-900 border-teal-300"
                    : "bg-white/70 text-slate-500 border-slate-200"
              }`}
            >
              {done ? <CheckCircle className="w-3 h-3" /> : <span>{s.n}</span>}
              {s.label}
              {s.n < 5 ? <ChevronRight className="w-3 h-3 opacity-50" /> : null}
            </li>
          );
        })}
      </ol>

      {sesameOk === false ? (
        <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Sésame non prêt (credentials / SESAME_ENV=test requis). Utilisez le Lab Sésame pour
          vérifier la config.
        </p>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-950">
          <p className="font-bold inline-flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" />
            {error}
          </p>
          {hint ? <p className="text-xs mt-1">{hint}</p> : null}
        </div>
      ) : null}

      {warnings.length ? (
        <p className="text-xs text-amber-900">{warnings.slice(0, 3).join(" · ")}</p>
      ) : null}

      {/* Actions principales */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void prepare(!draft)}
          className="bg-slate-800 hover:bg-slate-900 disabled:opacity-60 text-white px-3 py-2 rounded-xl font-bold text-sm inline-flex items-center gap-2"
        >
          {busy === "prepare" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {draft ? "1. Rafraîchir fiche Kereis" : "1. Remplir fiche Kereis"}
        </button>
        {draft ? (
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void prepare(true)}
            className="border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-60 text-slate-800 px-3 py-2 rounded-xl font-bold text-sm inline-flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Régénérer
          </button>
        ) : null}
        <button
          type="button"
          disabled={Boolean(busy) || !draft}
          onClick={() => void simulate()}
          className="bg-indigo-700 hover:bg-indigo-800 disabled:opacity-60 text-white px-3 py-2 rounded-xl font-bold text-sm inline-flex items-center gap-2"
        >
          {busy === "simulate" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          3. Simuler
        </button>
        <button
          type="button"
          disabled={Boolean(busy) || !allSelected}
          onClick={() => void generate()}
          className="bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white px-3 py-2 rounded-xl font-bold text-sm inline-flex items-center gap-2"
        >
          {busy === "generate" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
          5. Générer l&apos;étude
        </button>
        {(feasibility?.score ?? 10) < 8 ? (
          <label className="text-xs text-orange-950 inline-flex items-center gap-1.5 border border-orange-200 bg-orange-50 px-2.5 py-1.5 rounded-lg">
            <input
              type="checkbox"
              checked={forceGenerate}
              onChange={(e) => setForceGenerate(e.target.checked)}
            />
            Forcer si score &lt; 8 (après contrôle manuel)
          </label>
        ) : null}
      </div>

      {/* Formulaire contrôle */}
      {draft ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-slate-900">2. Contrôle manuel de la fiche</p>
            <p className="text-[11px] text-slate-500">
              Effet {draft.effectDateLabel}
              {draft.missing?.length ? ` · ${draft.missing.length} champ(s) manquant(s)` : " · champs OK"}
              {` · ${draft.provider}`}
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {(
              [
                ["Coordonnées", "coordonnees", draft.steps.coordonnees],
                ["Infos perso", "infosPerso", draft.steps.infosPerso],
                ["Prêteur", "preteur", draft.steps.preteur],
                ["Simulation", "simulations", draft.steps.simulations],
              ] as const
            ).map(([title, section, fields]) => (
              <div key={section} className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</p>
                {(fields || []).map((f: KereisField, i: number) => {
                  const k = fieldKey(section, i, f.label);
                  return (
                    <div key={k}>
                      {renderKereisField(f, String(edits[k] ?? ""), (v) => {
                        setEdits((prev) => ({ ...prev, [k]: v }));
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
            {(draft.steps.prets || []).map((loan, li) => (
              <div key={li} className="space-y-2 md:col-span-2">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  {loan.label || `Prêt ${li + 1}`}
                </p>
                <div className="grid md:grid-cols-2 gap-2">
                  {(loan.fields || []).map((f: KereisField, i: number) => {
                    const k = fieldKey(`pret${li}`, i, f.label);
                    return (
                      <div key={k}>
                        {renderKereisField(f, String(edits[k] ?? ""), (v) => {
                          setEdits((prev) => ({ ...prev, [k]: v }));
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void saveControl()}
            className="border border-slate-300 bg-slate-50 hover:bg-slate-100 disabled:opacity-60 text-slate-800 px-3 py-1.5 rounded-lg font-bold text-xs"
          >
            {busy === "save" ? "Enregistrement…" : "Enregistrer les corrections"}
          </button>
        </div>
      ) : (
        <p className="text-xs text-slate-600 italic">
          Cliquez sur « Remplir fiche Kereis » pour extraire les champs depuis les documents.
        </p>
      )}

      {/* Propositions */}
      {cols.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-slate-900">4. Choisir l&apos;assurance</p>
            <div className="flex gap-1">
              {(
                [
                  ["crd", "CRD"],
                  ["capital_initial", "CI"],
                  ["tous", "Tous"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFilter(k)}
                  className={`text-[11px] font-bold px-2 py-1 rounded-lg border ${
                    filter === k
                      ? "bg-indigo-700 text-white border-indigo-800"
                      : "bg-white text-slate-700 border-slate-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className={`grid gap-3 ${filteredCols.length > 1 ? "md:grid-cols-2" : ""}`}>
            {filteredCols.map((col) => (
              <div key={col.referenceAssure} className="space-y-2">
                <p className="text-xs font-bold text-slate-700">{col.label}</p>
                <div className="max-h-64 overflow-auto space-y-1.5">
                  {col.propositions.filter(isTarifable).length === 0 ? (
                    <p className="text-xs text-slate-500">Aucune proposition pour ce filtre.</p>
                  ) : (
                    col.propositions.filter(isTarifable).map((p) => {
                      const active = selected[col.referenceAssure] === p.codeProduit;
                      return (
                        <button
                          key={p.codeProduit}
                          type="button"
                          onClick={() =>
                            setSelected((prev) => ({
                              ...prev,
                              [col.referenceAssure]: p.codeProduit,
                            }))
                          }
                          className={`w-full text-left rounded-lg border px-2.5 py-2 text-xs ${
                            active
                              ? "border-teal-500 bg-teal-50 ring-1 ring-teal-400"
                              : "border-slate-200 bg-white hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex justify-between gap-2">
                            <span className="font-bold text-slate-900">
                              {p.marque || marqueFromCode(p.codeProduit)}
                            </span>
                            <span className="font-bold text-teal-800">
                              {fmtEur(p.tarifTotalAssurance)}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5 flex justify-between gap-2">
                            <span className="font-mono truncate">{p.codeProduit}</span>
                            <span>
                              {p.cotisationMensuelleMoyenne != null
                                ? `${fmtEur(p.cotisationMensuelleMoyenne)}/mois`
                                : p.baseTarif || ""}
                            </span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {feasibility?.checks?.length ? (
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer font-semibold">Détail du score</summary>
          <ul className="mt-1 list-disc pl-4 space-y-0.5">
            {feasibility.checks.map((c) => (
              <li key={c.label}>
                {c.ok ? "✓" : "✗"} {c.label}
                {c.detail ? ` — ${c.detail}` : ""} (+{c.earned}/{c.points})
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
