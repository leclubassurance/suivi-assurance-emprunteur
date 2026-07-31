import React, { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FlaskConical,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { adminFetch } from "../../lib/adminApi";
import {
  DEPLACEMENTS_PRO_OPTIONS,
  PROFESSION_RISQUE_OPTIONS,
  QUALITE_OPTIONS,
  SPORTS_RISQUE_CATEGORIES,
  STATUT_PRO_OPTIONS,
} from "../../constants";
import { Button } from "../ui/Button";

type LabStatus = {
  ok: boolean;
  env?: string;
  baseUrl?: string;
  basicAuthConfigured?: boolean;
  codeEntite?: string | null;
  labAllowed?: boolean;
  recentCalls?: Array<{
    at: string;
    method: string;
    path: string;
    status: number;
    durationMs: number;
    requestId?: string;
    ok: boolean;
    error?: string;
  }>;
  error?: string;
};

type TarifProduit = {
  type?: string;
  codeProduit: string;
  messages?: Array<{ texte?: string }>;
  tarifTotalAssurance?: number;
  tarifTotalCotisations?: number;
  tarifCotisationsXPremieresAnnees?: number;
  xPremieresAnnees?: number;
  reductionCouple?: boolean;
  prets?: Array<{ taea?: number; tauxMoyen?: number }>;
};

type Proposition = TarifProduit & {
  marque: string;
  taea?: number;
  tauxMoyen?: number;
  baseTarif: "crd" | "capital_initial" | "inconnu";
};

type AssurePropositions = {
  referenceAssure: string;
  label: string;
  propositions: Proposition[];
};

/** Déduit CRD vs capital initial depuis le code produit (ex. CLEUICD / CLEUICI, …CRD… / …CI…). */
function baseTarifFromCodeProduit(code: string): "crd" | "capital_initial" | "inconnu" {
  const c = code.toUpperCase();
  if (/CRD|CLEUICD|UICD|_CD($|[^A-Z])/.test(c)) return "crd";
  if (/CLEUICI|INEOCI(?!RD)|UICI|_CI($|[^A-Z])/.test(c)) return "capital_initial";
  // Heuristique : …CI… en fin de segment produit sans CRD
  if (/\bCI\b|_CI_|CI$/.test(c) && !/CRD/.test(c)) return "capital_initial";
  return "inconnu";
}

function euro(n?: number) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(n);
}

function pct(n?: number) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(3).replace(".", ",")} %`;
}

/** Préfixes codes Sésame → marques affichées comme dans Kérys. */
function marqueFromCodeProduit(code: string): string {
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
  if (c.startsWith("ALL_") || c.startsWith("ALLIANZ")) return "Allianz";
  const head = code.split(/[_-]/)[0];
  return head || code;
}

function mapTarifToProposition(t: any): Proposition | null {
  if (!t?.codeProduit) return null;
  const pret0 = Array.isArray(t.prets) ? t.prets[0] : undefined;
  return {
    ...t,
    codeProduit: String(t.codeProduit),
    marque: marqueFromCodeProduit(String(t.codeProduit)),
    baseTarif: baseTarifFromCodeProduit(String(t.codeProduit)),
    taea: pret0?.taea,
    tauxMoyen: pret0?.tauxMoyen,
  };
}

/** Réponse Sésame = 1 bloc par assuré (`referenceAssure` + `tarifs[]`). */
function extractPropositionsByAssure(
  data: unknown,
  assureForms: Array<{ civilite?: string; prenom?: string; nom?: string }>,
): AssurePropositions[] {
  if (!Array.isArray(data)) return [];

  // Si Sésame renvoie déjà des blocs { referenceAssure, tarifs }
  const looksLikeAssureBlocks = data.some(
    (block: any) => block && (Array.isArray(block.tarifs) || block.referenceAssure),
  );

  if (looksLikeAssureBlocks) {
    return data.map((block: any, i: number) => {
      const ref = String(block?.referenceAssure || `ASSURE${String(i + 1).padStart(3, "0")}`);
      const form = assureForms[i];
      const name = [form?.prenom, form?.nom].filter(Boolean).join(" ").trim();
      const civilite = form?.civilite || "";
      const who = [civilite, name].filter(Boolean).join(" ").trim();
      const tarifs = Array.isArray(block?.tarifs) ? block.tarifs : [];
      const propositions = tarifs
        .map(mapTarifToProposition)
        .filter((p: Proposition | null): p is Proposition => Boolean(p))
        .sort(
          (a: Proposition, b: Proposition) =>
            (a.tarifTotalAssurance ?? Infinity) - (b.tarifTotalAssurance ?? Infinity),
        );
      return {
        referenceAssure: ref,
        label: who ? `Assuré ${i + 1} — ${who}` : `Assuré ${i + 1}`,
        propositions,
      };
    });
  }

  // Fallback improbable : liste plate de tarifs → une seule colonne
  const propositions = data
    .map(mapTarifToProposition)
    .filter((p: Proposition | null): p is Proposition => Boolean(p))
    .sort(
      (a: Proposition, b: Proposition) =>
        (a.tarifTotalAssurance ?? Infinity) - (b.tarifTotalAssurance ?? Infinity),
    );
  const form = assureForms[0];
  const name = [form?.prenom, form?.nom].filter(Boolean).join(" ").trim();
  return [
    {
      referenceAssure: "ASSURE001",
      label: name ? `Assuré 1 — ${name}` : "Assuré 1",
      propositions,
    },
  ];
}

function isTarifable(p: Proposition) {
  return !p.type || p.type === "TARIFABLE";
}

function filterProps(list: Proposition[], propFilter: "tous" | "crd" | "capital_initial") {
  if (propFilter === "tous") return list;
  return list.filter((p) => p.baseTarif === propFilter);
}

/** Même produit pour tous les assurés si possible (réduction couple), sinon moins cher par colonne. */
function defaultSelections(byAssure: AssurePropositions[]): Record<string, string> {
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
    const matches = byAssure.slice(1).map((a) =>
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
    for (const a of byAssure) out[a.referenceAssure] = bestCode;
    return out;
  }
  for (const a of byAssure) {
    const best = a.propositions.find(isTarifable);
    if (best) out[a.referenceAssure] = best.codeProduit;
  }
  return out;
}

function findProp(byAssure: AssurePropositions[], ref: string, code: string | undefined): Proposition | null {
  if (!code) return null;
  const col = byAssure.find((a) => a.referenceAssure === ref);
  return col?.propositions.find((p) => p.codeProduit === code) || null;
}

type CallResult = {
  ok?: boolean;
  status?: number;
  durationMs?: number;
  requestId?: string;
  error?: string;
  data?: unknown;
  catalogAuto?: { resolved?: Record<string, string>; note?: string };
  requestPayloadPreview?: unknown;
  pdfBase64?: string;
  fileName?: string;
};

type PretForm = {
  nature: string;
  /** Montant saisi = capital restant dû (base substitution LCIF). */
  capitalRestant: string;
  taux: string;
  dureeRestante: string;
  dureeDiffere: string;
};

type AssureForm = {
  civilite: string;
  prenom: string;
  nom: string;
  dateNaissance: string;
  email: string;
  telephone: string;
  qualite: string;
  codePostal: string;
  statutPro: string;
  profession: string;
  professionRisque: string;
  professionManuelle: boolean;
  travauxHauteur: boolean;
  deplacementsPro: string;
  fumeur: boolean;
  sportsRisque: boolean;
  selectedSports: string[];
  quotite: string;
};

type LabForm = {
  dateEffetGaranties: string;
  objetFinancement: string;
  franchise: string;
  autresCreditsOui: boolean;
  encoursImmobilierAssure: string;
  banquePreteuse: string;
};

const EMPTY_PRET = (): PretForm => ({
  nature: "amortissable",
  capitalRestant: "",
  taux: "",
  dureeRestante: "",
  dureeDiffere: "0",
});

const EMPTY_ASSURE = (): AssureForm => ({
  civilite: "Monsieur",
  prenom: "",
  nom: "",
  dateNaissance: "",
  email: "",
  telephone: "",
  qualite: "EMPRUNTEUR",
  codePostal: "",
  statutPro: "employe_bureau",
  profession: "",
  professionRisque: "aucun",
  professionManuelle: false,
  travauxHauteur: false,
  deplacementsPro: "< 20000 Km",
  fumeur: false,
  sportsRisque: false,
  selectedSports: [],
  quotite: "100",
});

const EMPTY_FORM: LabForm = {
  dateEffetGaranties: "2026-11-01",
  objetFinancement: "residence_principale",
  franchise: "90",
  autresCreditsOui: false,
  encoursImmobilierAssure: "0",
  banquePreteuse: "",
};

const ALL_SPORTS = Object.values(SPORTS_RISQUE_CATEGORIES).flat();

const OBJET_OPTIONS = [
  { value: "residence_principale", label: "Résidence principale", id: 8 },
  { value: "residence_secondaire", label: "Résidence secondaire", id: 9 },
  { value: "investissement_locatif", label: "Investissement locatif", id: 10 },
  { value: "autre", label: "Autre", id: 11 },
];

const NATURE_PRET_OPTIONS = [
  { value: "amortissable", label: "Prêt Amortissable", idTypePret: 51 },
  { value: "ptz", label: "Prêt à Taux Zéro", idTypePret: 52 },
  { value: "modulable", label: "Prêt échéances modulables", idTypePret: 53 },
  { value: "in_fine", label: "Prêt In Fine", idTypePret: 54 },
];

const STATUT_PRO_TO_SESAME_ID: Record<string, number> = {
  salarie_cadre: 1,
  employe_bureau: 1,
  salarie_noncadre: 1,
  fonctionnaire_a: 2,
  fonctionnaire_autre: 2,
  retraite_cadre: 5,
  retraite_noncadre: 5,
  dirigeant: 3,
  profession_liberale: 4,
  profession_medicale: 4,
  profession_paramedical_salarie: 4,
  profession_paramedical_fonctionnaire: 4,
  profession_paramedical_liberal: 4,
  artisan_nonbtp: 6,
  commercant: 6,
  artisan_btp: 6,
  profession_agricole: 6,
  saisonnier: 7,
  sans_profession: 7,
  autre: 1,
};

const QUALITE_TO_SESAME_ID: Record<string, number> = {
  EMPRUNTEUR: 3,
  CAUTION_PP: 4,
  CAUTION_PM: 5,
};

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
        ok
          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
          : "bg-amber-50 text-amber-800 border border-amber-200"
      }`}
    >
      {ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
      {label}
    </span>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-slate-950 text-slate-100 text-[11px] leading-relaxed p-3 whitespace-pre-wrap break-words">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`text-xs text-slate-600 block ${className || ""}`}>
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputCls = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm";

function formToOverrides(
  form: LabForm,
  assures: AssureForm[],
  prets: PretForm[],
): Record<string, unknown> {
  const objet = OBJET_OPTIONS.find((o) => o.value === form.objetFinancement);
  return {
    dateEffetGaranties: form.dateEffetGaranties || undefined,
    idObjetFinancement: objet?.id ?? 8,
    franchise: Number(form.franchise || 90),
    fraisDistribution: 0,
    // Base montant = capital restant dû (substitution). Les propositions CI/CRD viennent de Sésame.
    baseMontantPret: "crd",
    encoursImmobilierAssure: form.autresCreditsOui
      ? Number(form.encoursImmobilierAssure || 0)
      : 0,
    reductionCouple: assures.length >= 2,
    assures: assures.map((a, i) => {
      const statutLabel =
        STATUT_PRO_OPTIONS.find((o) => o.value === a.statutPro)?.label || a.statutPro;
      return {
        civilite: a.civilite,
        prenom: a.prenom.trim() || undefined,
        nom: a.nom.trim() || undefined,
        dateNaissance: a.dateNaissance || undefined,
        codePostal: a.codePostal.trim() || undefined,
        fumeur: a.fumeur,
        professionLibelle: a.profession.trim() || statutLabel,
        idStatutProfessionnel: STATUT_PRO_TO_SESAME_ID[a.statutPro] ?? 1,
        idQualite: QUALITE_TO_SESAME_ID[a.qualite] ?? 3,
        professionManuelle: a.professionManuelle,
        travauxEnHauteur: a.travauxHauteur,
        deplacementsProfessionnels: a.deplacementsPro !== "< 20000 Km",
        // Métier / sports à risque : optionnels. Sans annexe d'ids Kereis on n'envoie pas d'id numérique.
        professionRisque: a.professionRisque,
        sportsRisque: a.sportsRisque,
        selectedSports: a.sportsRisque ? a.selectedSports : [],
        quotite: Number(a.quotite || 100),
        referenceAssure: `ASSURE${String(i + 1).padStart(3, "0")}`,
        encoursImmobilierAssure: form.autresCreditsOui
          ? Number(form.encoursImmobilierAssure || 0)
          : 0,
      };
    }),
    prets: prets
      .filter((p) => p.capitalRestant.trim())
      .map((p) => {
        const nature = NATURE_PRET_OPTIONS.find((n) => n.value === p.nature);
        const differe = Number(p.dureeDiffere || 0);
        return {
          capitalRestant: Number(p.capitalRestant),
          montant: Number(p.capitalRestant),
          taux: Number(p.taux || 0),
          duree: Number(p.dureeRestante || 240),
          differe,
          ...(differe > 0 ? { idNatureDiffere: 2 } : {}),
          idTypePret: nature?.idTypePret ?? 51,
          idPeriodiciteEcheancePret: 3,
          idTypeAmortissement: 100,
        };
      }),
  };
}

export default function AdminSesameLab({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<LabStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<CallResult | null>(null);
  /** Tarifs avec réduction couple (query true). */
  const [tarifsAvecCouple, setTarifsAvecCouple] = useState<AssurePropositions[]>([]);
  /** Tarifs sans réduction couple — utilisés si marques différentes. */
  const [tarifsSansCouple, setTarifsSansCouple] = useState<AssurePropositions[]>([]);
  /** Sélection par referenceAssure → codeProduit */
  const [selectedByAssure, setSelectedByAssure] = useState<Record<string, string>>({});
  const [propFilter, setPropFilter] = useState<"tous" | "crd" | "capital_initial">("tous");
  const [showRawJson, setShowRawJson] = useState(false);
  const [form, setForm] = useState<LabForm>(EMPTY_FORM);
  const [assures, setAssures] = useState<AssureForm[]>([EMPTY_ASSURE()]);
  const [prets, setPrets] = useState<PretForm[]>([EMPTY_PRET()]);

  const setField = <K extends keyof LabForm>(key: K, value: LabForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const setAssure = <K extends keyof AssureForm>(index: number, key: K, value: AssureForm[K]) => {
    setAssures((prev) => prev.map((a, i) => (i === index ? { ...a, [key]: value } : a)));
  };

  const setPret = (index: number, key: keyof PretForm, value: string) => {
    setPrets((prev) => prev.map((p, i) => (i === index ? { ...p, [key]: value } : p)));
  };

  const toggleSport = (assureIndex: number, sport: string) => {
    setAssures((prev) =>
      prev.map((a, i) => {
        if (i !== assureIndex) return a;
        const has = a.selectedSports.includes(sport);
        const selectedSports = has
          ? a.selectedSports.filter((s) => s !== sport)
          : a.selectedSports.length >= 10
            ? a.selectedSports
            : [...a.selectedSports, sport];
        return { ...a, selectedSports, sportsRisque: selectedSports.length > 0 || a.sportsRisque };
      }),
    );
  };

  const refreshStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const res = await adminFetch("/api/admin/sesame-lab/status");
      const data = await res.json().catch(() => ({}));
      setStatus(data);
    } catch (err: any) {
      setStatus({ ok: false, error: err?.message || "Erreur réseau" });
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const columnRefs: AssurePropositions[] =
    tarifsAvecCouple.length >= 2
      ? tarifsAvecCouple
      : tarifsSansCouple.length >= 2
        ? tarifsSansCouple
        : tarifsAvecCouple.length
          ? tarifsAvecCouple
          : tarifsSansCouple;

  const hasCoupleColumns = columnRefs.length >= 2;

  const selectedMarques = columnRefs
    .map((col) => {
      const code = selectedByAssure[col.referenceAssure];
      return (
        findProp(tarifsAvecCouple, col.referenceAssure, code)?.marque ||
        findProp(tarifsSansCouple, col.referenceAssure, code)?.marque
      );
    })
    .filter(Boolean) as string[];

  const coupleApplies =
    hasCoupleColumns &&
    selectedMarques.length >= 2 &&
    selectedMarques.every((m) => m === selectedMarques[0]);

  const activeByAssure: AssurePropositions[] = (() => {
    if (!hasCoupleColumns) return columnRefs;
    if (coupleApplies) return tarifsAvecCouple.length ? tarifsAvecCouple : tarifsSansCouple;
    return tarifsSansCouple.length ? tarifsSansCouple : tarifsAvecCouple;
  })();

  const selectedProps = activeByAssure.map((col) =>
    findProp(activeByAssure, col.referenceAssure, selectedByAssure[col.referenceAssure]),
  );

  const allSelected = activeByAssure.length > 0 && selectedProps.every(Boolean);

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

  /** Total hors réduction (même sélection) pour afficher l’économie couple. */
  const totalSansCouple = (() => {
    if (!coupleApplies || !tarifsSansCouple.length) return null;
    let sum = 0;
    for (const col of tarifsSansCouple) {
      const code = selectedByAssure[col.referenceAssure];
      const p = findProp(tarifsSansCouple, col.referenceAssure, code);
      if (!p?.tarifTotalAssurance) return null;
      sum += p.tarifTotalAssurance;
    }
    return sum;
  })();

  const economieCouple =
    coupleApplies && totalSansCouple != null && totalSansCouple > totalAssurance
      ? totalSansCouple - totalAssurance
      : null;

  async function runTarification() {
    setBusy("tarif");
    setLastResult(null);
    try {
      const baseOverrides = formToOverrides(form, assures, prets);
      const isCouple = assures.length >= 2;

      const fetchTarif = (reductionCouple: boolean | undefined) =>
        adminFetch("/api/admin/sesame-lab/tarification", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            overrides: {
              ...baseOverrides,
              ...(reductionCouple != null ? { reductionCouple } : {}),
            },
          }),
        }).then(async (res) => {
          const data = await res.json().catch(() => ({}));
          return data as CallResult;
        });

      if (isCouple) {
        const [avec, sans] = await Promise.all([fetchTarif(true), fetchTarif(false)]);
        setLastResult(avec?.ok ? avec : sans);
        if (!avec?.ok && !sans?.ok) {
          setTarifsAvecCouple([]);
          setTarifsSansCouple([]);
          setSelectedByAssure({});
          return;
        }
        const avecCols = avec?.ok ? extractPropositionsByAssure(avec.data, assures) : [];
        const sansCols = sans?.ok ? extractPropositionsByAssure(sans.data, assures) : [];
        setTarifsAvecCouple(avecCols);
        setTarifsSansCouple(sansCols);
        const seed = avecCols.length ? avecCols : sansCols;
        setSelectedByAssure((prev) => {
          const next = defaultSelections(seed);
          // conserve si encore valide
          for (const col of seed) {
            const prevCode = prev[col.referenceAssure];
            if (prevCode && col.propositions.some((p) => p.codeProduit === prevCode)) {
              next[col.referenceAssure] = prevCode;
            }
          }
          return next;
        });
      } else {
        const one = await fetchTarif(undefined);
        setLastResult(one);
        if (!one?.ok) {
          setTarifsAvecCouple([]);
          setTarifsSansCouple([]);
          setSelectedByAssure({});
          return;
        }
        const cols = extractPropositionsByAssure(one.data, assures);
        setTarifsAvecCouple(cols);
        setTarifsSansCouple([]);
        setSelectedByAssure((prev) => {
          const next = defaultSelections(cols);
          for (const col of cols) {
            const prevCode = prev[col.referenceAssure];
            if (prevCode && col.propositions.some((p) => p.codeProduit === prevCode)) {
              next[col.referenceAssure] = prevCode;
            }
          }
          return next;
        });
      }
      await refreshStatus();
    } catch (err: any) {
      setLastResult({ ok: false, error: err?.message || "Erreur réseau" });
      setTarifsAvecCouple([]);
      setTarifsSansCouple([]);
      setSelectedByAssure({});
    } finally {
      setBusy(null);
    }
  }

  async function runDevis() {
    if (!allSelected) return;
    setBusy("devis");
    try {
      const base = formToOverrides(form, assures, prets);
      const assuresWithProduit = (Array.isArray(base.assures) ? base.assures : []).map(
        (a: any, i: number) => {
          const ref = String(a.referenceAssure || `ASSURE${String(i + 1).padStart(3, "0")}`);
          return {
            ...a,
            codeProduit: selectedByAssure[ref] || selectedProps[i]?.codeProduit,
          };
        },
      );
      const res = await adminFetch("/api/admin/sesame-lab/devis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          overrides: {
            ...base,
            assures: assuresWithProduit,
            reductionCouple: coupleApplies,
          },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as CallResult;
      setLastResult(data);
      if (data?.ok && data?.pdfBase64) {
        const a = document.createElement("a");
        a.href = `data:application/pdf;base64,${data.pdfBase64}`;
        const codes = Object.values(selectedByAssure).join("-") || "lab";
        a.download = data.fileName || `devis-${codes}-${Date.now()}.pdf`;
        a.click();
      }
      await refreshStatus();
    } catch (err: any) {
      setLastResult({ ok: false, error: err?.message || "Erreur réseau" });
    } finally {
      setBusy(null);
    }
  }

  function downloadPdf(from?: CallResult | null) {
    const src = from || lastResult;
    if (!src?.pdfBase64) return;
    const a = document.createElement("a");
    a.href = `data:application/pdf;base64,${src.pdfBase64}`;
    a.download = src.fileName || `sesame-devis-lab.pdf`;
    a.click();
  }

  function resetLab() {
    setForm(EMPTY_FORM);
    setAssures([EMPTY_ASSURE()]);
    setPrets([EMPTY_PRET()]);
    setTarifsAvecCouple([]);
    setTarifsSansCouple([]);
    setSelectedByAssure({});
    setPropFilter("tous");
    setLastResult(null);
  }

  function PropositionCard({
    p,
    selected,
    showCoupleBadge,
    onSelect,
  }: {
    p: Proposition;
    selected: boolean;
    showCoupleBadge: boolean;
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
      </button>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-slate-900"
          >
            <ArrowLeft className="w-4 h-4" /> Retour admin
          </button>
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <FlaskConical className="w-4 h-4 text-amber-600" />
            Lab Sésame (comme Kérys)
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => void refreshStatus()} disabled={loadingStatus}>
            {loadingStatus ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Statut
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-950 px-4 py-3 text-sm space-y-1">
          <p className="font-semibold flex items-center gap-2">
            <FlaskConical className="w-4 h-4 shrink-0" />
            Même logique que Kérys : tu saisis le dossier, pas les codes techniques.
          </p>
          <p className="text-xs text-amber-900/80">
            Offre / produit / barème = ce que Kérys calcule en coulisses quand tu vois CARDIF, Generali, etc. Ici le lab
            les récupère automatiquement via l’API avant de tarifer. Commissionnement &amp; frais = 0.
          </p>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
          <div className="flex flex-wrap gap-2">
            <StatusPill ok={Boolean(status?.labAllowed)} label={status?.labAllowed ? "Lab OK" : "Lab bloqué"} />
            <StatusPill
              ok={Boolean(status?.basicAuthConfigured)}
              label={status?.basicAuthConfigured ? "Auth OK" : "Auth manquante"}
            />
            <StatusPill
              ok={Boolean(status?.codeEntite)}
              label={status?.codeEntite ? `Entité ${status.codeEntite}` : "Entité manquante"}
            />
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">1. Assurés</h2>
              <p className="text-xs text-slate-500 mt-1">
                Un ou plusieurs assurés (ex. couple). Métier / sports à risque = optionnels, comme sur Kérys.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={assures.length >= 2}
              onClick={() => setAssures((prev) => [...prev, EMPTY_ASSURE()])}
            >
              <Plus className="w-4 h-4" /> Ajouter un assuré
            </Button>
          </div>

          {assures.map((assure, index) => (
            <div key={index} className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-800">Assuré {index + 1}</h3>
                {assures.length > 1 ? (
                  <button
                    type="button"
                    className="text-slate-500 hover:text-red-600"
                    onClick={() => setAssures((prev) => prev.filter((_, i) => i !== index))}
                    aria-label="Supprimer cet assuré"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                ) : null}
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <Field label="Civilité">
                  <select
                    className={inputCls}
                    value={assure.civilite}
                    onChange={(e) => setAssure(index, "civilite", e.target.value)}
                  >
                    <option value="Monsieur">Monsieur</option>
                    <option value="Madame">Madame</option>
                  </select>
                </Field>
                <Field label="Nom">
                  <input
                    className={inputCls}
                    value={assure.nom}
                    onChange={(e) => setAssure(index, "nom", e.target.value)}
                  />
                </Field>
                <Field label="Prénom">
                  <input
                    className={inputCls}
                    value={assure.prenom}
                    onChange={(e) => setAssure(index, "prenom", e.target.value)}
                  />
                </Field>
                <Field label="Date de naissance">
                  <input
                    type="date"
                    className={inputCls}
                    value={assure.dateNaissance}
                    onChange={(e) => setAssure(index, "dateNaissance", e.target.value)}
                  />
                </Field>
                <Field label="Email">
                  <input
                    type="email"
                    className={inputCls}
                    value={assure.email}
                    onChange={(e) => setAssure(index, "email", e.target.value)}
                  />
                </Field>
                <Field label="Téléphone">
                  <input
                    className={inputCls}
                    value={assure.telephone}
                    onChange={(e) => setAssure(index, "telephone", e.target.value)}
                  />
                </Field>
                <Field label="Qualité">
                  <select
                    className={inputCls}
                    value={assure.qualite}
                    onChange={(e) => setAssure(index, "qualite", e.target.value)}
                  >
                    {QUALITE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Code postal résidence fiscale">
                  <input
                    className={inputCls}
                    value={assure.codePostal}
                    onChange={(e) => setAssure(index, "codePostal", e.target.value)}
                  />
                </Field>
                <Field label="Quotité (%)">
                  <input
                    className={inputCls}
                    inputMode="numeric"
                    value={assure.quotite}
                    onChange={(e) => setAssure(index, "quotite", e.target.value)}
                  />
                </Field>
                <Field label="Statut professionnel">
                  <select
                    className={inputCls}
                    value={assure.statutPro}
                    onChange={(e) => setAssure(index, "statutPro", e.target.value)}
                  >
                    {STATUT_PRO_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Profession" className="sm:col-span-2">
                  <input
                    className={inputCls}
                    value={assure.profession}
                    onChange={(e) => setAssure(index, "profession", e.target.value)}
                    placeholder="ex. Dessinateur-projeteur"
                  />
                </Field>
                <Field label="Profession à risque (optionnel)">
                  <select
                    className={inputCls}
                    value={assure.professionRisque}
                    onChange={(e) => setAssure(index, "professionRisque", e.target.value)}
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
                    value={assure.deplacementsPro}
                    onChange={(e) => setAssure(index, "deplacementsPro", e.target.value)}
                  >
                    {DEPLACEMENTS_PRO_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Profession manuelle">
                  <label className="inline-flex items-center gap-2 h-[42px] text-sm">
                    <input
                      type="checkbox"
                      checked={assure.professionManuelle}
                      onChange={(e) => setAssure(index, "professionManuelle", e.target.checked)}
                    />
                    Oui
                  </label>
                </Field>
                <Field label="Travaux en hauteur">
                  <label className="inline-flex items-center gap-2 h-[42px] text-sm">
                    <input
                      type="checkbox"
                      checked={assure.travauxHauteur}
                      onChange={(e) => setAssure(index, "travauxHauteur", e.target.checked)}
                    />
                    Oui
                  </label>
                </Field>
                <Field label="Fumeur">
                  <label className="inline-flex items-center gap-2 h-[42px] text-sm">
                    <input
                      type="checkbox"
                      checked={assure.fumeur}
                      onChange={(e) => setAssure(index, "fumeur", e.target.checked)}
                    />
                    Oui
                  </label>
                </Field>
                <Field label="Sports à risque (optionnel)">
                  <label className="inline-flex items-center gap-2 h-[42px] text-sm">
                    <input
                      type="checkbox"
                      checked={assure.sportsRisque}
                      onChange={(e) => {
                        setAssure(index, "sportsRisque", e.target.checked);
                        if (!e.target.checked) setAssure(index, "selectedSports", []);
                      }}
                    />
                    Oui
                  </label>
                </Field>
              </div>
              {assure.sportsRisque ? (
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-[11px] text-slate-500 mb-2">
                    Sélectionne jusqu’à 10 sports (déclaratif). Les ids Sésame seront branchés quand on aura l’annexe
                    Kereis — non bloquant pour tarifer.
                  </p>
                  <div className="flex flex-wrap gap-1.5 max-h-36 overflow-auto">
                    {ALL_SPORTS.map((sport) => {
                      const on = assure.selectedSports.includes(sport);
                      return (
                        <button
                          key={sport}
                          type="button"
                          onClick={() => toggleSport(index, sport)}
                          className={`rounded-full px-2.5 py-1 text-[11px] border ${
                            on
                              ? "bg-indigo-600 text-white border-indigo-600"
                              : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                          }`}
                        >
                          {sport}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">2. Prêts</h2>
          <p className="text-xs text-slate-500">
            Montant = <strong>capital restant dû (CRD)</strong> — base substitution LCIF. Sésame renvoie ensuite des
            propositions en CRD et/ou capital initial (filtre plus bas).
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Date d'effet (changement d'assurance)">
              <input
                type="date"
                className={inputCls}
                value={form.dateEffetGaranties}
                onChange={(e) => setField("dateEffetGaranties", e.target.value)}
              />
            </Field>
            <Field label="Objet du financement">
              <select
                className={inputCls}
                value={form.objetFinancement}
                onChange={(e) => setField("objetFinancement", e.target.value)}
              >
                {OBJET_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Banque / prêteur (optionnel)">
              <input
                className={inputCls}
                value={form.banquePreteuse}
                onChange={(e) => setField("banquePreteuse", e.target.value)}
                placeholder="ex. CIC"
              />
            </Field>
          </div>

          {prets.map((pret, index) => (
            <div key={index} className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-emerald-900">Prêt {index + 1}</h3>
                {prets.length > 1 ? (
                  <button
                    type="button"
                    className="text-slate-500 hover:text-red-600"
                    onClick={() => setPrets((prev) => prev.filter((_, i) => i !== index))}
                    aria-label="Supprimer ce prêt"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                ) : null}
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <Field label="Nature de prêt">
                  <select
                    className={inputCls}
                    value={pret.nature}
                    onChange={(e) => setPret(index, "nature", e.target.value)}
                  >
                    {NATURE_PRET_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Capital restant dû — CRD (€)">
                  <input
                    className={inputCls}
                    inputMode="decimal"
                    value={pret.capitalRestant}
                    onChange={(e) => setPret(index, "capitalRestant", e.target.value)}
                  />
                </Field>
                <Field label="Taux (%)">
                  <input
                    className={inputCls}
                    inputMode="decimal"
                    value={pret.taux}
                    onChange={(e) => setPret(index, "taux", e.target.value)}
                  />
                </Field>
                <Field label="Durée restante (mois)">
                  <input
                    className={inputCls}
                    inputMode="numeric"
                    value={pret.dureeRestante}
                    onChange={(e) => setPret(index, "dureeRestante", e.target.value)}
                  />
                </Field>
                <Field label="Différé d'amortissement (mois)">
                  <input
                    className={inputCls}
                    inputMode="numeric"
                    value={pret.dureeDiffere}
                    onChange={(e) => setPret(index, "dureeDiffere", e.target.value)}
                  />
                </Field>
              </div>
            </div>
          ))}

          <Button type="button" size="sm" variant="outline" onClick={() => setPrets((prev) => [...prev, EMPTY_PRET()])}>
            <Plus className="w-4 h-4" /> Ajouter un prêt
          </Button>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">3. Simulation (couvertures)</h2>
          <p className="text-xs text-slate-500">La quotité se règle par assuré (section 1).</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Field label="Franchise">
              <select
                className={inputCls}
                value={form.franchise}
                onChange={(e) => setField("franchise", e.target.value)}
              >
                <option value="30">30 j</option>
                <option value="60">60 j</option>
                <option value="90">90 j</option>
                <option value="180">180 j</option>
              </select>
            </Field>
            <Field label="Autres crédits immobiliers (Lemoine)">
              <label className="inline-flex items-center gap-2 h-[42px] text-sm">
                <input
                  type="checkbox"
                  checked={form.autresCreditsOui}
                  onChange={(e) => setField("autresCreditsOui", e.target.checked)}
                />
                Oui
              </label>
            </Field>
            {form.autresCreditsOui ? (
              <Field label="Capitaux restants autres crédits (€)">
                <input
                  className={inputCls}
                  inputMode="decimal"
                  value={form.encoursImmobilierAssure}
                  onChange={(e) => setField("encoursImmobilierAssure", e.target.value)}
                />
              </Field>
            ) : null}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">4. Propositions</h2>
          <p className="text-xs text-slate-500">
            {assures.length >= 2
              ? "Deux colonnes séparées : à gauche Assuré 1 (ex. Monsieur), à droite Assuré 2 (ex. Madame). Tu peux choisir deux assureurs différents. Même société → réduction couple ; sinon → tarifs hors couple. Total = somme des deux."
              : "Lance la simulation, filtre CRD / capital initial, choisis une offre, puis exporte le devis PDF."}
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <Button type="button" size="sm" disabled={Boolean(busy)} onClick={() => void runTarification()}>
              {busy === "tarif" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Simuler{assures.length >= 2 ? " (×2 tarifs couple)" : ""}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={Boolean(busy) || !allSelected}
              onClick={() => void runDevis()}
            >
              {busy === "devis" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              <Download className="w-4 h-4" />
              Exporter le devis
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={resetLab}>
              Réinitialiser
            </Button>
            <div className="flex flex-wrap gap-1.5 ml-auto">
              {(
                [
                  { id: "tous", label: "Tous" },
                  { id: "crd", label: "CRD" },
                  { id: "capital_initial", label: "Capital initial" },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setPropFilter(f.id)}
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
          </div>

          {lastResult && !lastResult.ok && lastResult.error ? (
            <p className="text-sm text-red-600">{lastResult.error}</p>
          ) : null}

          {activeByAssure.length > 0 ? (
            <div className="space-y-3">
              {hasCoupleColumns ? (
                <div
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    coupleApplies
                      ? "border-blue-200 bg-blue-50 text-blue-900"
                      : "border-amber-200 bg-amber-50 text-amber-950"
                  }`}
                >
                  {coupleApplies ? (
                    <p>
                      <strong>Réduction couple active</strong> — même société ({selectedMarques[0]}). Tarifs issus de
                      l’appel Sésame avec réduction couple.
                      {economieCouple != null ? (
                        <span className="ml-1">Économie couple estimée : {euro(economieCouple)}.</span>
                      ) : null}
                    </p>
                  ) : (
                    <p>
                      <strong>Réduction couple inactive</strong> — sociétés différentes
                      {selectedMarques.length
                        ? ` (${selectedMarques.join(" ≠ ")})`
                        : ""}. Tarifs hors réduction couple.
                    </p>
                  )}
                </div>
              ) : null}

              <div
                className={`grid gap-4 items-start ${
                  activeByAssure.length >= 2 ? "md:grid-cols-2" : "grid-cols-1"
                }`}
              >
                {activeByAssure.map((col, colIndex) => {
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
                          <strong>
                            {findProp(activeByAssure, col.referenceAssure, selectedCode)?.marque || "—"}
                          </strong>{" "}
                          <span className="font-mono opacity-70">{selectedCode}</span>
                          {" · "}
                          {euro(findProp(activeByAssure, col.referenceAssure, selectedCode)?.tarifTotalAssurance)}
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
                              onSelect={() =>
                                setSelectedByAssure((prev) => ({
                                  ...prev,
                                  [col.referenceAssure]: p.codeProduit,
                                }))
                              }
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
                        {coupleApplies ? " · réduction couple incluse" : hasCoupleColumns ? " · hors couple" : ""}
                      </p>
                    </div>
                    <div className="text-xs text-emerald-900 space-y-0.5">
                      {selectedProps.map((p, i) =>
                        p ? (
                          <p key={activeByAssure[i]?.referenceAssure || i}>
                            Assuré {i + 1} : <strong>{p.marque}</strong> {euro(p.tarifTotalAssurance)}
                          </p>
                        ) : null,
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Aucune proposition pour l’instant — clique sur Simuler.</p>
          )}

          {lastResult?.pdfBase64 ? (
            <div className="flex flex-wrap gap-2 items-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-700" />
              <span className="text-sm text-emerald-900 font-medium">Devis PDF prêt</span>
              <Button type="button" size="sm" variant="ghost" onClick={() => downloadPdf()}>
                <Download className="w-4 h-4" /> Télécharger à nouveau
              </Button>
            </div>
          ) : null}

          <div>
            <button
              type="button"
              className="text-xs font-semibold text-slate-500 hover:text-slate-800"
              onClick={() => setShowRawJson((v) => !v)}
            >
              {showRawJson ? "▾" : "▸"} JSON technique (debug)
            </button>
            {showRawJson && lastResult ? (
              <JsonBlock
                value={
                  lastResult.pdfBase64
                    ? { ...lastResult, pdfBase64: `[base64 ${Math.round(lastResult.pdfBase64.length / 1024)} KB]` }
                    : lastResult
                }
              />
            ) : null}
          </div>
        </section>

        {status?.recentCalls?.length ? (
          <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Journal</h2>
            <ul className="divide-y divide-slate-100 text-xs font-mono">
              {status.recentCalls.map((c, i) => (
                <li key={`${c.at}-${i}`} className="py-2 flex flex-wrap gap-x-3 gap-y-1">
                  <span className="text-slate-400">{c.at.slice(11, 19)}</span>
                  <span className={c.ok ? "text-emerald-700" : "text-red-600"}>
                    {c.method} {c.path} → {c.status}
                  </span>
                  <span className="text-slate-500">{c.durationMs}ms</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </div>
  );
}
