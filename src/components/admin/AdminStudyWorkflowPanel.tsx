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
import type { KereisDraft } from "../../../shared/kereisDraftTypes";
import {
  type AssureForm,
  type LabForm,
  type PretForm,
  EMPTY_ASSURE,
  EMPTY_LAB_FORM,
  EMPTY_PRET,
  FORMULE_OPTIONS,
  FRANCHISE_OPTIONS,
  NATURE_PRET_OPTIONS,
  OBJET_OPTIONS,
  OPTION_PRESETS,
  PERIODICITE_OPTIONS,
  PROFESSION_RISQUE_OPTIONS,
  QUALITE_OPTIONS,
  REMUNERATION_OPTIONS,
  STATUT_PRO_OPTIONS,
  TYPE_ECHEANCES_OPTIONS,
  TYPE_TAUX_OPTIONS,
  DEPLACEMENTS_PRO_OPTIONS,
  formToOverrides,
  seedLabFormFromDossier,
  validateLabFormForTarif,
  parseFrNumber,
} from "../../../shared/sesameLabForm";

type Feasibility = {
  score?: number;
  max?: number;
  pass?: boolean;
  mode?: string;
  modeLabel?: string;
  blockers?: string[];
  checks?: Array<{ ok: boolean; label: string; detail?: string; earned: number; points: number }>;
};

type Proposition = {
  codeProduit: string;
  marque?: string;
  baseTarif?: "crd" | "capital_initial" | "autre";
  type?: string;
  message?: string;
  tarifTotalAssurance?: number;
  cotisationMensuelleMoyenne?: number;
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

const inputCls = "w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm bg-white";

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block text-xs text-slate-700">
      <span className="font-semibold">{label}</span>
      <div className="mt-1">{children}</div>
      {hint ? <span className="text-[10px] text-slate-500 mt-0.5 block">{hint}</span> : null}
    </label>
  );
}

function marqueFromCode(code: string): string {
  const c = code.toUpperCase();
  if (c.startsWith("GEN_") || c.startsWith("GENERALI")) return "Generali";
  if (c.startsWith("CAR_") || c.startsWith("CARDIF") || c.startsWith("CLE")) return "Cardif";
  if (c.startsWith("CNP_") || c.startsWith("CNPA_")) return "CNP";
  if (c.startsWith("AXA")) return "AXA";
  if (c.startsWith("MCP_")) return "MCP";
  if (c.startsWith("MLF_") || c.startsWith("METLIFE")) return "MetLife";
  if (c.startsWith("SL_") || c.startsWith("SWISSLIFE") || c.startsWith("MUL_")) return "SwissLife";
  if (c.startsWith("ALL_") || c.startsWith("ALLIANZ")) return "Allianz";
  return code.split(/[_-]/)[0] || code;
}

function baseTarifFromCode(code: string): Proposition["baseTarif"] {
  const c = code.toUpperCase();
  if (/CRD|CLEUICD|UICD|_CD($|[^A-Z])/.test(c)) return "crd";
  if (/CLEUICI|INEOCI(?!RD)|UICI|_CI($|[^A-Z])/.test(c)) return "capital_initial";
  if (/\bCI\b|_CI_|CI$/.test(c) && !/CRD/.test(c)) return "capital_initial";
  return "autre";
}

function pickCodeProduit(t: any): string {
  return String(
    t?.codeProduit || t?.produit?.codeProduit || t?.code || t?.produit?.code || "",
  ).trim();
}

function mapProp(t: any): Proposition | null {
  const codeProduit = pickCodeProduit(t);
  if (!codeProduit) return null;
  return {
    ...t,
    codeProduit,
    marque: marqueFromCode(codeProduit),
    baseTarif: baseTarifFromCode(codeProduit),
    type: t?.type || t?.statut || t?.etat || undefined,
    message: String(t?.message || t?.motif || t?.libelleErreur || t?.erreur || "").trim() || undefined,
    tarifTotalAssurance: t?.tarifTotalAssurance,
    cotisationMensuelleMoyenne: t?.cotisationMensuelleMoyenne,
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

function extractByAssure(data: unknown, assures: AssureForm[]): AssureCol[] {
  const list = normalizeTarifPayload(data);
  if (!list.length) return [];
  const looksLikeBlocks = list.some(
    (b: any) => b && (Array.isArray(b.tarifs) || b.referenceAssure),
  );
  if (looksLikeBlocks) {
    return list.map((block: any, i: number) => {
      const ref = String(block?.referenceAssure || `ASSURE${String(i + 1).padStart(3, "0")}`);
      const a = assures[i];
      const who = [a?.prenom, a?.nom].filter(Boolean).join(" ").trim();
      const propositions = (Array.isArray(block?.tarifs) ? block.tarifs : [])
        .map(mapProp)
        .filter((p: Proposition | null): p is Proposition => Boolean(p))
        .sort(
          (x, y) => (x.tarifTotalAssurance ?? Infinity) - (y.tarifTotalAssurance ?? Infinity),
        );
      return {
        referenceAssure: ref,
        label: who ? `Assuré ${i + 1} — ${who}` : `Assuré ${i + 1}`,
        propositions,
      };
    });
  }
  const propositions = list
    .map(mapProp)
    .filter((p: Proposition | null): p is Proposition => Boolean(p))
    .sort((a, b) => (a.tarifTotalAssurance ?? Infinity) - (b.tarifTotalAssurance ?? Infinity));
  const a = assures[0];
  const who = [a?.prenom, a?.nom].filter(Boolean).join(" ").trim();
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
  for (const col of cols) {
    const best = col.propositions.find(isTarifable);
    if (best) out[col.referenceAssure] = best.codeProduit;
  }
  return out;
}

function fmtEur(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`;
}

function FeasibilityBadge({ f, busy }: { f: Feasibility | null; busy?: boolean }) {
  if (busy) {
    return (
      <span className="text-xs text-slate-500 border border-slate-200 bg-white px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1.5">
        <Loader2 className="w-3 h-3 animate-spin" /> Score…
      </span>
    );
  }
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
  return (
    <span className={`text-xs font-bold px-2.5 py-1.5 rounded-lg border ${tone}`}>
      Faisabilité {score}/{f.max ?? 10}
      {score >= 8 ? " · OK pour générer" : " · forcer si besoin"}
    </span>
  );
}

export default function AdminStudyWorkflowPanel({
  dossierId,
  initialDraft,
  initialFeasibility,
  initialDossier,
  adminFetch,
  onDossierUpdated,
  onStudyGenerated,
}: {
  dossierId: string;
  initialDraft?: KereisDraft | null;
  initialFeasibility?: Feasibility | null;
  initialDossier?: any;
  adminFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onDossierUpdated?: () => void;
  onStudyGenerated?: (data: {
    subject?: string;
    html?: string;
    fileName?: string;
    grossSavingsEur?: number | null;
  }) => void;
}): React.ReactElement {
  const [step, setStep] = useState(1);
  const [feasibility, setFeasibility] = useState<Feasibility | null>(initialFeasibility || null);
  const [scoreBusy, setScoreBusy] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [cols, setCols] = useState<AssureCol[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"tous" | "crd" | "capital_initial">("tous");
  const [forceGenerate, setForceGenerate] = useState(false);
  const [sesameOk, setSesameOk] = useState<boolean | null>(null);
  const [simMeta, setSimMeta] = useState<{ tarifCount?: number; requestId?: string } | null>(null);

  const [form, setForm] = useState<LabForm>(EMPTY_LAB_FORM);
  const [assures, setAssures] = useState<AssureForm[]>([EMPTY_ASSURE()]);
  const [prets, setPrets] = useState<PretForm[]>([EMPTY_PRET()]);
  const [seeded, setSeeded] = useState(false);

  const applySeed = useCallback((dossier: any) => {
    const seededState = seedLabFormFromDossier(dossier || {});
    setForm(seededState.form);
    setAssures(seededState.assures);
    setPrets(seededState.prets);
    setWarnings(seededState.warnings);
    setSeeded(true);
    setStep(2);
  }, []);

  useEffect(() => {
    setFeasibility(initialFeasibility || null);
    setCols([]);
    setSelected({});
    setSimMeta(null);
    if (initialDossier || initialDraft) {
      applySeed({ ...(initialDossier || {}), kereisDraft: initialDraft || initialDossier?.kereisDraft });
    } else {
      setSeeded(false);
      setStep(1);
    }
  }, [dossierId, initialDraft, initialDossier, initialFeasibility, applySeed]);

  const refreshScore = useCallback(async () => {
    setScoreBusy(true);
    try {
      const res = await adminFetch(`/api/admin/dossiers/${dossierId}/ade-feasibility`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.feasibility) setFeasibility(data.feasibility);
    } catch {
      /* ignore */
    } finally {
      setScoreBusy(false);
    }
  }, [adminFetch, dossierId]);

  useEffect(() => {
    if (feasibility?.score != null) return;
    void refreshScore();
  }, [dossierId]); // eslint-disable-line react-hooks/exhaustive-deps

  const setAssure = <K extends keyof AssureForm>(index: number, key: K, value: AssureForm[K]) => {
    setAssures((prev) => prev.map((a, i) => (i === index ? { ...a, [key]: value } : a)));
  };
  const setPret = <K extends keyof PretForm>(index: number, key: K, value: PretForm[K]) => {
    setPrets((prev) => prev.map((p, i) => (i === index ? { ...p, [key]: value } : p)));
  };
  const setLab = <K extends keyof LabForm>(key: K, value: LabForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

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
      setFeasibility(data.feasibility || null);
      setSesameOk(data.sesameStatus?.labAllowed !== false && data.sesameStatus?.basicAuthConfigured);
      applySeed({
        formData: initialDossier?.formData,
        kereisDraft: data.kereisDraft,
      });
      setWarnings([
        ...(Array.isArray(data.warnings) ? data.warnings : []),
        ...seedLabFormFromDossier({
          formData: initialDossier?.formData,
          kereisDraft: data.kereisDraft,
        }).warnings,
      ]);
      setCols([]);
      setSelected({});
      onDossierUpdated?.();
    } catch {
      setError("Erreur réseau (préparation)");
    } finally {
      setBusy(null);
    }
  };

  const simulate = async () => {
    setBusy("simulate");
    setError(null);
    setHint(null);
    setSimMeta(null);
    try {
      const invalid = validateLabFormForTarif(form, assures, prets);
      if (invalid) {
        setError(invalid);
        setStep(2);
        return;
      }
      const overrides = formToOverrides(form, assures, prets);
      const res = await adminFetch(`/api/admin/dossiers/${dossierId}/study-workflow/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.feasibility) setFeasibility(data.feasibility);
      if (!res.ok || !data.ok) {
        setError(data.error || "Simulation Sésame impossible");
        setHint(
          data.requestPayloadPreview
            ? `Payload : taux=${data.requestPayloadPreview?.prets?.[0]?.taux ?? "?"} · CRD=${data.requestPayloadPreview?.prets?.[0]?.montant ?? "?"}`
            : null,
        );
        setCols([]);
        setStep(3);
        return;
      }
      const extracted = extractByAssure(data.data, assures);
      const tarifable = extracted.reduce((n, c) => n + c.propositions.filter(isTarifable).length, 0);
      setCols(extracted);
      setSelected(defaultSelections(extracted));
      setSimMeta({ tarifCount: data.tarifCount, requestId: data.requestId });
      setFilter("tous");
      if (Array.isArray(data.warnings)) setWarnings(data.warnings);
      if (tarifable === 0) {
        setError(
          `Sésame : ${data.tarifCount ?? 0} tarif(s), 0 tarifable. Voir les motifs ci-dessous ou corrigez le formulaire Lab.`,
        );
        setHint(
          Array.isArray(data.tarifSamples)
            ? data.tarifSamples
                .map((s: any) => [s.type, s.message].filter(Boolean).join(" — "))
                .filter(Boolean)
                .slice(0, 2)
                .join(" · ")
            : null,
        );
      } else {
        setError(null);
        setHint(null);
      }
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
      const overrides = formToOverrides(form, assures, prets);
      const res = await adminFetch(`/api/admin/dossiers/${dossierId}/study-workflow/generate-study`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedByAssure: selected, forceGenerate, overrides }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Génération impossible");
        setHint(data.hint || null);
        if (data.feasibility) setFeasibility(data.feasibility);
        if (data.code === "low_feasibility") setForceGenerate(true);
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
        filter === "tous" ? c.propositions : c.propositions.filter((p) => p.baseTarif === filter),
    }));
  }, [cols, filter]);

  const allSelected = cols.length > 0 && cols.every((c) => selected[c.referenceAssure]);
  const pret0 = prets[0] || EMPTY_PRET();
  const assure0 = assures[0] || EMPTY_ASSURE();

  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50/40 px-4 py-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-900">Parcours étude (étapes Sésame)</p>
          <p className="text-xs text-slate-600 mt-1 max-w-2xl leading-relaxed">
            Même formulaire que le <strong>Lab Sésame</strong> (listes déroulantes, dates, cases). La
            fiche Kereis ne sert qu&apos;à préremplir — la tarification part de ces champs typés.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <FeasibilityBadge f={feasibility} busy={scoreBusy} />
          <button
            type="button"
            className="text-[10px] font-bold text-slate-600 underline"
            disabled={scoreBusy || Boolean(busy)}
            onClick={() => void refreshScore()}
          >
            Recalculer le score
          </button>
        </div>
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
          Sésame non prêt (credentials / SESAME_ENV=test). Vérifiez le Lab Sésame.
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
        <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {warnings.slice(0, 4).join(" · ")}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void prepare(!seeded)}
          className="bg-slate-800 hover:bg-slate-900 disabled:opacity-60 text-white px-3 py-2 rounded-xl font-bold text-sm inline-flex items-center gap-2"
        >
          {busy === "prepare" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {seeded ? "1. Recharger depuis docs" : "1. Préremplir depuis docs"}
        </button>
        {seeded ? (
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void prepare(true)}
            className="border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-60 text-slate-800 px-3 py-2 rounded-xl font-bold text-sm inline-flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Régénérer extraction
          </button>
        ) : null}
        <button
          type="button"
          disabled={Boolean(busy) || !seeded}
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
            Forcer si score &lt; 8
          </label>
        ) : null}
      </div>

      {seeded ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-5">
          <div>
            <p className="text-sm font-bold text-slate-900">2. Contrôle (formulaire Lab Sésame)</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Listes déroulantes = même mapping que le Lab. Corrigez CRD / taux ici avant Simuler.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <Field label="Date d'effet des garanties">
              <input
                type="date"
                className={inputCls}
                value={form.dateEffetGaranties}
                onChange={(e) => setLab("dateEffetGaranties", e.target.value)}
              />
            </Field>
            <Field label="Objet du financement">
              <select
                className={inputCls}
                value={form.objetFinancement}
                onChange={(e) => setLab("objetFinancement", e.target.value)}
              >
                {OBJET_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Assuré</p>
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Civilité">
                <select
                  className={inputCls}
                  value={assure0.civilite}
                  onChange={(e) => setAssure(0, "civilite", e.target.value)}
                >
                  <option value="Monsieur">Monsieur</option>
                  <option value="Madame">Madame</option>
                </select>
              </Field>
              <Field label="Qualité">
                <select
                  className={inputCls}
                  value={assure0.qualite}
                  onChange={(e) => setAssure(0, "qualite", e.target.value)}
                >
                  {QUALITE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Nom">
                <input
                  className={inputCls}
                  value={assure0.nom}
                  onChange={(e) => setAssure(0, "nom", e.target.value)}
                />
              </Field>
              <Field label="Prénom">
                <input
                  className={inputCls}
                  value={assure0.prenom}
                  onChange={(e) => setAssure(0, "prenom", e.target.value)}
                />
              </Field>
              <Field label="Date de naissance">
                <input
                  type="date"
                  className={inputCls}
                  value={assure0.dateNaissance}
                  onChange={(e) => setAssure(0, "dateNaissance", e.target.value)}
                />
              </Field>
              <Field label="Code postal">
                <input
                  className={inputCls}
                  value={assure0.codePostal}
                  onChange={(e) => setAssure(0, "codePostal", e.target.value)}
                  inputMode="numeric"
                />
              </Field>
              <Field label="Statut professionnel">
                <select
                  className={inputCls}
                  value={assure0.statutPro}
                  onChange={(e) => setAssure(0, "statutPro", e.target.value)}
                >
                  {STATUT_PRO_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Profession (libellé libre)" hint="Optionnel — sinon = libellé du statut">
                <input
                  className={inputCls}
                  value={assure0.profession}
                  onChange={(e) => setAssure(0, "profession", e.target.value)}
                />
              </Field>
              <Field label="Profession à risque">
                <select
                  className={inputCls}
                  value={assure0.professionRisque}
                  onChange={(e) => setAssure(0, "professionRisque", e.target.value)}
                >
                  {PROFESSION_RISQUE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Déplacements pro / an">
                <select
                  className={inputCls}
                  value={assure0.deplacementsPro}
                  onChange={(e) => setAssure(0, "deplacementsPro", e.target.value)}
                >
                  {DEPLACEMENTS_PRO_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Quotité (%)">
                <input
                  className={inputCls}
                  value={assure0.quotite}
                  onChange={(e) => setAssure(0, "quotite", e.target.value)}
                  inputMode="decimal"
                />
              </Field>
              <div className="flex flex-wrap gap-4 items-center text-sm pt-5">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={assure0.professionManuelle}
                    onChange={(e) => setAssure(0, "professionManuelle", e.target.checked)}
                  />
                  Profession manuelle
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={assure0.travauxHauteur}
                    onChange={(e) => setAssure(0, "travauxHauteur", e.target.checked)}
                  />
                  Travaux en hauteur
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={assure0.fumeur}
                    onChange={(e) => setAssure(0, "fumeur", e.target.checked)}
                  />
                  Fumeur
                </label>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Prêt (CRD)</p>
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Nature du prêt">
                <select
                  className={inputCls}
                  value={pret0.nature}
                  onChange={(e) => setPret(0, "nature", e.target.value)}
                >
                  {NATURE_PRET_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Type d'échéances">
                <select
                  className={inputCls}
                  value={pret0.typeEcheances}
                  onChange={(e) => setPret(0, "typeEcheances", e.target.value)}
                >
                  {TYPE_ECHEANCES_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Capital restant dû — CRD (€)"
                hint="Obligatoire ≥ 1 000 € — jamais une date"
              >
                <input
                  className={inputCls}
                  value={pret0.capitalRestant}
                  onChange={(e) => setPret(0, "capitalRestant", e.target.value)}
                  inputMode="decimal"
                  placeholder="ex. 185000"
                />
              </Field>
              <Field label="Taux nominal (%)" hint="Obligatoire — ex. 3,45">
                <input
                  className={inputCls}
                  value={pret0.taux}
                  onChange={(e) => setPret(0, "taux", e.target.value)}
                  inputMode="decimal"
                  placeholder="ex. 3,45"
                />
              </Field>
              <Field label="Type de taux">
                <select
                  className={inputCls}
                  value={pret0.typeTaux}
                  onChange={(e) => setPret(0, "typeTaux", e.target.value)}
                >
                  {TYPE_TAUX_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Périodicité">
                <select
                  className={inputCls}
                  value={pret0.periodicite}
                  onChange={(e) => setPret(0, "periodicite", e.target.value)}
                >
                  {PERIODICITE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Durée restante (mois)">
                <input
                  className={inputCls}
                  value={pret0.dureeRestante}
                  onChange={(e) => setPret(0, "dureeRestante", e.target.value)}
                  inputMode="numeric"
                />
              </Field>
              <Field label="Durée différé (mois)">
                <input
                  className={inputCls}
                  value={pret0.dureeDiffere}
                  onChange={(e) => setPret(0, "dureeDiffere", e.target.value)}
                  inputMode="numeric"
                />
              </Field>
            </div>
            <p className="text-[11px] text-slate-500">
              Aperçu payload : CRD{" "}
              <strong>{parseFrNumber(pret0.capitalRestant, 0).toLocaleString("fr-FR")} €</strong> ·
              taux <strong>{parseFrNumber(pret0.taux, 0)} %</strong> · durée{" "}
              <strong>{parseFrNumber(pret0.dureeRestante, 0)} mois</strong>
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Couverture</p>
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Formule">
                <select
                  className={inputCls}
                  value={form.formule}
                  onChange={(e) => setLab("formule", e.target.value)}
                >
                  {FORMULE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Franchise ITT">
                <select
                  className={inputCls}
                  value={form.franchise}
                  onChange={(e) => setLab("franchise", e.target.value)}
                >
                  {FRANCHISE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Rémunération (L %)">
                <select
                  className={inputCls}
                  value={form.remunerationLineairePct}
                  onChange={(e) => setLab("remunerationLineairePct", e.target.value)}
                >
                  {REMUNERATION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="space-y-1.5 pt-1">
                {OPTION_PRESETS.map((opt) => (
                  <label key={opt.key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.optionKeys.includes(opt.key)}
                      onChange={(e) => {
                        setLab(
                          "optionKeys",
                          e.target.checked
                            ? [...form.optionKeys, opt.key]
                            : form.optionKeys.filter((k) => k !== opt.key),
                        );
                      }}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-600 italic">
          Cliquez sur « Préremplir depuis docs » pour initialiser le formulaire Lab.
        </p>
      )}

      {cols.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-slate-900">4. Choisir l&apos;assurance</p>
              <p className="text-[11px] text-slate-500">
                {simMeta?.tarifCount != null ? `${simMeta.tarifCount} tarif(s) Sésame` : ""}
              </p>
            </div>
            <div className="flex gap-1">
              {(
                [
                  ["tous", "Tous"],
                  ["crd", "CRD"],
                  ["capital_initial", "CI"],
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
          {filteredCols.map((col) => {
            const visible = col.propositions.filter(isTarifable);
            const rejected = col.propositions.filter((p) => !isTarifable(p));
            return (
              <div key={col.referenceAssure} className="space-y-2">
                <p className="text-xs font-bold text-slate-700">{col.label}</p>
                <div className="max-h-72 overflow-auto space-y-1.5">
                  {visible.length === 0 ? (
                    <p className="text-xs text-slate-500">Aucune offre tarifable.</p>
                  ) : (
                    visible.map((p) => {
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
                              {p.baseTarif === "crd" || p.baseTarif === "capital_initial" ? (
                                <span className="ml-1.5 text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-1 rounded">
                                  {p.baseTarif === "crd" ? "CRD" : "CI"}
                                </span>
                              ) : null}
                            </span>
                            <span className="font-bold text-teal-800">
                              {fmtEur(p.tarifTotalAssurance)}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5 font-mono truncate">
                            {p.codeProduit}
                          </div>
                        </button>
                      );
                    })
                  )}
                  {rejected.length > 0 ? (
                    <details className="mt-2">
                      <summary className="text-[11px] font-bold text-amber-800 cursor-pointer">
                        {rejected.length} non tarifable(s)
                      </summary>
                      <ul className="mt-1 space-y-1">
                        {rejected.slice(0, 12).map((p) => (
                          <li
                            key={`rej-${p.codeProduit}`}
                            className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-950"
                          >
                            <span className="font-bold">{p.marque || p.codeProduit}</span>
                            {p.type ? ` · ${p.type}` : ""}
                            {p.message ? (
                              <span className="block text-amber-800 mt-0.5">{p.message}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              </div>
            );
          })}
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
