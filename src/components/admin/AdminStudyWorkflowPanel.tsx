import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  Download,
  ExternalLink,
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
import {
  type SesameAssureColumn,
  SesamePropositionsBoard,
  defaultSelections,
  extractPropositionsByAssure,
  findProp,
  isTarifable,
} from "./SesamePropositionsPanel";

type Feasibility = {
  score?: number;
  max?: number;
  pass?: boolean;
  mode?: string;
  modeLabel?: string;
  blockers?: string[];
  checks?: Array<{ ok: boolean; label: string; detail?: string; earned: number; points: number }>;
};

/** 3 phases UX : Données → Offres → Étude */
const PHASES = [
  { id: "data" as const, label: "Données" },
  { id: "offers" as const, label: "Offres" },
  { id: "study" as const, label: "Étude" },
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
      {score >= 8 ? " · OK" : " · forcer si besoin"}
    </span>
  );
}

type StudyWorkflowProps = {
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
  /** Ouvre l’ancien assistant ADE (upload devis). */
  onOpenLegacyAde?: () => void;
};

const AdminStudyWorkflowPanel: React.FC<StudyWorkflowProps> = ({
  dossierId,
  initialDraft,
  initialFeasibility,
  initialDossier,
  adminFetch,
  onDossierUpdated,
  onStudyGenerated,
  onOpenLegacyAde,
}) => {
  const [feasibility, setFeasibility] = useState<Feasibility | null>(initialFeasibility || null);
  const [scoreBusy, setScoreBusy] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [cols, setCols] = useState<SesameAssureColumn[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"tous" | "crd" | "capital_initial">("tous");
  const [forceGenerate, setForceGenerate] = useState(false);
  const [sesameOk, setSesameOk] = useState<boolean | null>(null);
  const [simMeta, setSimMeta] = useState<{
    tarifCount?: number;
    tarifableCount?: number;
    requestId?: string;
    durationMs?: number;
  } | null>(null);
  const [studyDone, setStudyDone] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [parcoursLink, setParcoursLink] = useState<string | null>(null);

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
    if (!parseFrNumber(seededState.prets[0]?.taux, 0)) setManualOpen(true);
  }, []);

  useEffect(() => {
    setFeasibility(initialFeasibility || null);
    setCols([]);
    setSelected({});
    setSimMeta(null);
    setError(null);
    setHint(null);
    setForceGenerate(false);
    setStudyDone(false);
    setParcoursLink(null);
    setManualOpen(false);
    if (initialDossier || initialDraft) {
      applySeed({
        ...(initialDossier || {}),
        kereisDraft: initialDraft || initialDossier?.kereisDraft,
      });
    } else {
      setSeeded(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossierId]);

  useEffect(() => {
    if (initialFeasibility) setFeasibility(initialFeasibility);
  }, [initialFeasibility]);

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

  const prepare = async (force = true) => {
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
        formData: data.formData || initialDossier?.formData,
        kereisDraft: data.kereisDraft,
      });
      setWarnings([
        ...(Array.isArray(data.warnings) ? data.warnings : []),
        ...seedLabFormFromDossier({
          formData: data.formData || initialDossier?.formData,
          kereisDraft: data.kereisDraft,
        }).warnings,
      ]);
      setCols([]);
      setSelected({});
      setStudyDone(false);
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
        setManualOpen(true);
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
        return;
      }
      const extracted = extractPropositionsByAssure(data.data, assures);
      const tarifable = extracted.reduce((n, c) => n + c.propositions.filter(isTarifable).length, 0);
      setCols(extracted);
      setSelected(defaultSelections(extracted));
      setSimMeta({
        tarifCount: data.tarifCount,
        tarifableCount: data.tarifableCount,
        requestId: data.requestId,
        durationMs: data.durationMs,
      });
      setFilter("tous");
      const nextWarnings = Array.isArray(data.warnings) ? data.warnings : [];
      const tauxOk = parseFrNumber(prets[0]?.taux, 0) > 0;
      setWarnings(
        nextWarnings.filter((w) => !(tauxOk && /taux fiche ignoré|taux nominal manquant/i.test(w))),
      );
      if (tarifable === 0) {
        setError(
          `Sésame : ${data.tarifCount ?? 0} tarif(s), 0 tarifable. Corrigez le formulaire (manuel) ou le profil.`,
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
        setManualOpen(true);
      } else {
        setError(null);
        setHint(null);
      }
    } catch {
      setError("Erreur réseau (simulation)");
    } finally {
      setBusy(null);
    }
  };

  const buildOverridesWithSelection = () => {
    const base = formToOverrides(form, assures, prets);
    const assuresWithProduit = (Array.isArray(base.assures) ? base.assures : []).map(
      (a: any, i: number) => {
        const ref = String(a.referenceAssure || `ASSURE${String(i + 1).padStart(3, "0")}`);
        return {
          ...a,
          codeProduit: selected[ref] || Object.values(selected)[i],
        };
      },
    );
    return { ...base, assures: assuresWithProduit };
  };

  const exportDevis = async () => {
    if (!cols.length || !cols.every((c) => selected[c.referenceAssure])) return;
    setBusy("devis");
    setError(null);
    try {
      const res = await adminFetch("/api/admin/sesame-lab/devis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides: buildOverridesWithSelection() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok || !data?.pdfBase64) {
        setError(data.error || "Export devis impossible");
        return;
      }
      const a = document.createElement("a");
      a.href = `data:application/pdf;base64,${data.pdfBase64}`;
      const codes = Object.values(selected).join("-") || "devis";
      a.download = data.fileName || `devis-${codes}-${Date.now()}.pdf`;
      a.click();
    } catch {
      setError("Erreur réseau (export devis)");
    } finally {
      setBusy(null);
    }
  };

  const openSesame = async () => {
    if (!cols.length || !cols.every((c) => selected[c.referenceAssure])) return;
    setBusy("parcours");
    setError(null);
    setParcoursLink(null);
    try {
      const referenceDossier = `DOS-${dossierId.slice(0, 8)}-${Date.now()}`.slice(0, 40);
      const res = await adminFetch("/api/admin/sesame-lab/dossier/creation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referenceDossier,
          overrides: buildOverridesWithSelection(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      const raw = (data?.data || {}) as Record<string, unknown>;
      const lien =
        (typeof data.lienSesame === "string" && data.lienSesame) ||
        (typeof raw.lienSesame === "string" ? raw.lienSesame : "");
      if (data?.ok && lien) {
        setParcoursLink(lien);
        window.open(lien, "_blank", "noopener,noreferrer");
      } else {
        setError(data.error || "Dossier Sésame créé mais sans lien OTP.");
      }
    } catch {
      setError("Erreur réseau (parcours Sésame)");
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
      setStudyDone(true);
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

  const allSelected = cols.length > 0 && cols.every((c) => selected[c.referenceAssure]);
  const pret0 = prets[0] || EMPTY_PRET();
  const assure0 = assures[0] || EMPTY_ASSURE();
  const formValid = !validateLabFormForTarif(form, assures, prets);
  const phase: "data" | "offers" | "study" = studyDone
    ? "study"
    : cols.length > 0
      ? "offers"
      : "data";

  const visibleWarnings = useMemo(() => {
    const tauxOk = parseFrNumber(pret0.taux, 0) > 0;
    return warnings.filter((w) => !(tauxOk && /taux fiche ignoré|taux nominal manquant/i.test(w)));
  }, [warnings, pret0.taux]);

  const selectedSummary = useMemo(() => {
    if (!allSelected) return null;
    return cols.map((c) => findProp(cols, c.referenceAssure, selected[c.referenceAssure]));
  }, [allSelected, cols, selected]);

  return (
    <div className="rounded-xl border border-teal-200 bg-white px-4 py-4 space-y-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-900">Étude Sésame</p>
          <p className="text-xs text-slate-600 mt-0.5 max-w-xl">
            Flux auto (préparer → simuler → générer). Actions manuelles dans le tiroir si besoin.
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

      <ol className="flex flex-wrap gap-2">
        {PHASES.map((p, i) => {
          const active = phase === p.id;
          const done =
            (p.id === "data" && (cols.length > 0 || studyDone)) ||
            (p.id === "offers" && studyDone) ||
            (p.id === "study" && studyDone);
          return (
            <li
              key={p.id}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold border ${
                active
                  ? "bg-teal-700 text-white border-teal-800"
                  : done
                    ? "bg-teal-50 text-teal-900 border-teal-200"
                    : "bg-slate-50 text-slate-500 border-slate-200"
              }`}
            >
              {done && !active ? <CheckCircle className="w-3 h-3" /> : <span>{i + 1}</span>}
              {p.label}
            </li>
          );
        })}
      </ol>

      {sesameOk === false ? (
        <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Sésame non prêt (credentials / SESAME_ENV=test).
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

      {visibleWarnings.length ? (
        <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {visibleWarnings.slice(0, 3).join(" · ")}
        </p>
      ) : null}

      {/* CTA principal selon l’état */}
      <div className="flex flex-wrap items-center gap-2">
        {!seeded || !formValid ? (
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void prepare(true)}
            className="bg-slate-900 hover:bg-slate-950 disabled:opacity-60 text-white px-4 py-2.5 rounded-xl font-bold text-sm inline-flex items-center gap-2"
          >
            {busy === "prepare" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {seeded ? "Recharger depuis docs" : "Préparer depuis docs"}
          </button>
        ) : null}

        {seeded && formValid && cols.length === 0 ? (
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void simulate()}
            className="bg-indigo-700 hover:bg-indigo-800 disabled:opacity-60 text-white px-4 py-2.5 rounded-xl font-bold text-sm inline-flex items-center gap-2"
          >
            {busy === "simulate" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Simuler les offres
          </button>
        ) : null}

        {cols.length > 0 && !studyDone ? (
          <button
            type="button"
            disabled={Boolean(busy) || !allSelected}
            onClick={() => void generate()}
            className="bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white px-4 py-2.5 rounded-xl font-bold text-sm inline-flex items-center gap-2"
          >
            {busy === "generate" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            Générer l&apos;étude
          </button>
        ) : null}

        {studyDone ? (
          <span className="text-sm font-bold text-emerald-800 inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-xl">
            <CheckCircle className="w-4 h-4" /> Étude prête — composez / envoyez le mail
          </span>
        ) : null}

        {seeded && !formValid ? (
          <button
            type="button"
            className="text-sm font-semibold text-orange-900 underline"
            onClick={() => setManualOpen(true)}
          >
            Compléter CRD / taux
          </button>
        ) : null}
      </div>

      {/* Résumé données compact */}
      {seeded ? (
        <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-700 flex flex-wrap gap-x-4 gap-y-1">
          <span>
            <strong>{[assure0.prenom, assure0.nom].filter(Boolean).join(" ") || "Assuré"}</strong>
          </span>
          <span>
            CRD {parseFrNumber(pret0.capitalRestant, 0).toLocaleString("fr-FR")} € · taux{" "}
            {parseFrNumber(pret0.taux, 0)} % · {parseFrNumber(pret0.dureeRestante, 0)} mois
          </span>
          {!formValid ? (
            <span className="text-orange-800 font-semibold">Données prêt incomplètes</span>
          ) : null}
        </div>
      ) : null}

      {/* Offres Lab */}
      {cols.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Propositions</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Même UI que le Lab
                {simMeta?.tarifableCount != null
                  ? ` — ${simMeta.tarifableCount} tarifable(s) / ${simMeta.tarifCount ?? "?"}`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={Boolean(busy) || !allSelected}
                onClick={() => void exportDevis()}
                className="border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-800 px-3 py-1.5 rounded-lg font-bold text-xs inline-flex items-center gap-1.5"
              >
                {busy === "devis" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                Exporter le devis
              </button>
              <button
                type="button"
                disabled={Boolean(busy) || !allSelected}
                onClick={() => void openSesame()}
                className="border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-800 px-3 py-1.5 rounded-lg font-bold text-xs inline-flex items-center gap-1.5"
                title="Crée un dossier parcours Sésame et ouvre le lien OTP"
              >
                {busy === "parcours" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ExternalLink className="w-3.5 h-3.5" />
                )}
                Ouvrir dans Sésame
              </button>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void simulate()}
                className="border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 text-indigo-950 px-3 py-1.5 rounded-lg font-bold text-xs"
              >
                Re-simuler
              </button>
            </div>
          </div>

          {parcoursLink ? (
            <a
              href={parcoursLink}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-sky-800 underline break-all"
            >
              Lien Sésame ouvert — recliquer ici si besoin
            </a>
          ) : null}

          <SesamePropositionsBoard
            byAssure={cols}
            selectedByAssure={selected}
            onSelect={(ref, code) => setSelected((prev) => ({ ...prev, [ref]: code }))}
            propFilter={filter}
            onPropFilterChange={setFilter}
            footerHint={
              allSelected && selectedSummary ? (
                <p className="text-xs text-emerald-900 mt-2">
                  Prêt pour <strong>Générer l&apos;étude</strong>
                  {(feasibility?.score ?? 10) < 8
                    ? " — cochez « Forcer » dans Manuel si le score reste bas."
                    : "."}
                </p>
              ) : null
            }
          />
        </div>
      ) : null}

      {/* Tiroir manuel */}
      <details
        className="rounded-xl border border-slate-200 bg-slate-50/80"
        open={manualOpen}
        onToggle={(e) => setManualOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer px-3 py-2.5 text-sm font-bold text-slate-800 select-none">
          Manuel / avancé
          <span className="ml-2 text-[11px] font-normal text-slate-500">
            formulaire Lab, re-extraction, forcer score, autre méthode
          </span>
        </summary>
        <div className="px-3 pb-3 space-y-4 border-t border-slate-200 pt-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void prepare(true)}
              className="border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-60 text-slate-800 px-3 py-1.5 rounded-lg font-bold text-xs inline-flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Régénérer extraction
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
            {onOpenLegacyAde ? (
              <button
                type="button"
                onClick={onOpenLegacyAde}
                className="border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-lg font-bold text-xs"
              >
                Autre méthode (upload devis)
              </button>
            ) : null}
          </div>

          {seeded ? (
            <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-5">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Formulaire Lab Sésame
              </p>

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
                  <Field label="Profession (libellé libre)">
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
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Prêt</p>
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
                  <Field label="Capital restant dû — CRD (€)">
                    <input
                      className={inputCls}
                      value={pret0.capitalRestant}
                      onChange={(e) => setPret(0, "capitalRestant", e.target.value)}
                      inputMode="decimal"
                    />
                  </Field>
                  <Field label="Taux nominal (%)">
                    <input
                      className={`${inputCls} ${!pret0.taux.trim() ? "border-orange-400 ring-1 ring-orange-200 bg-orange-50/40" : ""}`}
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

              <button
                type="button"
                disabled={Boolean(busy) || !formValid}
                onClick={() => void simulate()}
                className="bg-indigo-700 hover:bg-indigo-800 disabled:opacity-60 text-white px-3 py-2 rounded-xl font-bold text-sm"
              >
                Appliquer et simuler
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-600 italic">Préparez d’abord le dossier depuis les docs.</p>
          )}

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
      </details>
    </div>
  );
};

export default AdminStudyWorkflowPanel;
