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
  QUALITE_OPTIONS,
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
};

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

function extractPropositions(data: unknown): Proposition[] {
  if (!Array.isArray(data)) return [];
  const out: Proposition[] = [];
  for (const block of data) {
    const tarifs = (block as any)?.tarifs;
    if (!Array.isArray(tarifs)) continue;
    for (const t of tarifs) {
      if (!t?.codeProduit) continue;
      const pret0 = Array.isArray(t.prets) ? t.prets[0] : undefined;
      out.push({
        ...t,
        codeProduit: String(t.codeProduit),
        marque: marqueFromCodeProduit(String(t.codeProduit)),
        taea: pret0?.taea,
        tauxMoyen: pret0?.tauxMoyen,
      });
    }
  }
  return out.sort(
    (a, b) => (a.tarifTotalAssurance ?? Infinity) - (b.tarifTotalAssurance ?? Infinity),
  );
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
  capitalRestant: string;
  taux: string;
  dureeRestante: string;
  dureeDiffere: string;
};

type LabForm = {
  // Projet / prêts (écran Kérys)
  dateEffetGaranties: string;
  objetFinancement: string;
  // Assuré
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
  professionManuelle: boolean;
  travauxHauteur: boolean;
  deplacementsPro: string;
  fumeur: boolean;
  // Simulation
  quotite: string;
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

const EMPTY_FORM: LabForm = {
  dateEffetGaranties: "2026-11-01",
  objetFinancement: "residence_principale",
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
  professionManuelle: false,
  travauxHauteur: false,
  deplacementsPro: "< 20000 Km",
  fumeur: false,
  quotite: "100",
  franchise: "90",
  autresCreditsOui: false,
  encoursImmobilierAssure: "0",
  banquePreteuse: "",
};

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

function formToOverrides(form: LabForm, prets: PretForm[]): Record<string, unknown> {
  const statutLabel =
    STATUT_PRO_OPTIONS.find((o) => o.value === form.statutPro)?.label || form.statutPro;
  const objet = OBJET_OPTIONS.find((o) => o.value === form.objetFinancement);
  return {
    dateEffetGaranties: form.dateEffetGaranties || undefined,
    idObjetFinancement: objet?.id ?? 8,
    civilite: form.civilite,
    prenom: form.prenom.trim() || undefined,
    nom: form.nom.trim() || undefined,
    dateNaissance: form.dateNaissance || undefined,
    codePostal: form.codePostal.trim() || undefined,
    fumeur: form.fumeur,
    professionLibelle: form.profession.trim() || statutLabel,
    idStatutProfessionnel: STATUT_PRO_TO_SESAME_ID[form.statutPro] ?? 1,
    idQualite: QUALITE_TO_SESAME_ID[form.qualite] ?? 3,
    professionManuelle: form.professionManuelle,
    travauxEnHauteur: form.travauxHauteur,
    deplacementsProfessionnels: form.deplacementsPro !== "< 20000 Km",
    quotite: Number(form.quotite || 100),
    franchise: Number(form.franchise || 90),
    fraisDistribution: 0,
    encoursImmobilierAssure: form.autresCreditsOui
      ? Number(form.encoursImmobilierAssure || 0)
      : 0,
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
  const [propositions, setPropositions] = useState<Proposition[]>([]);
  const [selectedCodeProduit, setSelectedCodeProduit] = useState<string | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const [form, setForm] = useState<LabForm>(EMPTY_FORM);
  const [prets, setPrets] = useState<PretForm[]>([EMPTY_PRET()]);

  const setField = <K extends keyof LabForm>(key: K, value: LabForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const setPret = (index: number, key: keyof PretForm, value: string) => {
    setPrets((prev) => prev.map((p, i) => (i === index ? { ...p, [key]: value } : p)));
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

  function buildBody(extra?: Record<string, unknown>) {
    return { overrides: { ...formToOverrides(form, prets), ...(extra || {}) } };
  }

  async function runCall(key: string, fn: () => Promise<Response>) {
    setBusy(key);
    if (key !== "devis") setLastResult(null);
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      setLastResult(data);
      if (key === "tarif" && data?.ok) {
        const props = extractPropositions(data.data);
        setPropositions(props);
        setSelectedCodeProduit((prev) => {
          if (prev && props.some((p) => p.codeProduit === prev)) return prev;
          return props[0]?.codeProduit || null;
        });
      }
      if (key === "devis" && data?.ok && data?.pdfBase64) {
        const a = document.createElement("a");
        a.href = `data:application/pdf;base64,${data.pdfBase64}`;
        a.download = data.fileName || `devis-${selectedCodeProduit || "lab"}-${Date.now()}.pdf`;
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
    a.download = src.fileName || `sesame-devis-${selectedCodeProduit || "lab"}.pdf`;
    a.click();
  }

  const selectedProp = propositions.find((p) => p.codeProduit === selectedCodeProduit) || null;

  return (
    <div className="min-h-[100dvh] bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
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

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
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

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">1. Coordonnées</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Field label="Civilité">
              <select className={inputCls} value={form.civilite} onChange={(e) => setField("civilite", e.target.value)}>
                <option value="Monsieur">Monsieur</option>
                <option value="Madame">Madame</option>
              </select>
            </Field>
            <Field label="Nom">
              <input className={inputCls} value={form.nom} onChange={(e) => setField("nom", e.target.value)} />
            </Field>
            <Field label="Prénom">
              <input className={inputCls} value={form.prenom} onChange={(e) => setField("prenom", e.target.value)} />
            </Field>
            <Field label="Date de naissance">
              <input
                type="date"
                className={inputCls}
                value={form.dateNaissance}
                onChange={(e) => setField("dateNaissance", e.target.value)}
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                className={inputCls}
                value={form.email}
                onChange={(e) => setField("email", e.target.value)}
              />
            </Field>
            <Field label="Téléphone">
              <input
                className={inputCls}
                value={form.telephone}
                onChange={(e) => setField("telephone", e.target.value)}
              />
            </Field>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">2. Informations personnelles</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Field label="Qualité">
              <select className={inputCls} value={form.qualite} onChange={(e) => setField("qualite", e.target.value)}>
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
                value={form.codePostal}
                onChange={(e) => setField("codePostal", e.target.value)}
              />
            </Field>
            <Field label="Statut professionnel">
              <select
                className={inputCls}
                value={form.statutPro}
                onChange={(e) => setField("statutPro", e.target.value)}
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
                value={form.profession}
                onChange={(e) => setField("profession", e.target.value)}
                placeholder="ex. Dessinateur-projeteur"
              />
            </Field>
            <Field label="Déplacements pro / an">
              <select
                className={inputCls}
                value={form.deplacementsPro}
                onChange={(e) => setField("deplacementsPro", e.target.value)}
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
                  checked={form.professionManuelle}
                  onChange={(e) => setField("professionManuelle", e.target.checked)}
                />
                Oui
              </label>
            </Field>
            <Field label="Travaux en hauteur">
              <label className="inline-flex items-center gap-2 h-[42px] text-sm">
                <input
                  type="checkbox"
                  checked={form.travauxHauteur}
                  onChange={(e) => setField("travauxHauteur", e.target.checked)}
                />
                Oui
              </label>
            </Field>
            <Field label="Fumeur">
              <label className="inline-flex items-center gap-2 h-[42px] text-sm">
                <input
                  type="checkbox"
                  checked={form.fumeur}
                  onChange={(e) => setField("fumeur", e.target.checked)}
                />
                Oui
              </label>
            </Field>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">3. Prêts</h2>
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
                <Field label="Capital restant dû (€)">
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
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">4. Simulation (couvertures)</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Field label="Quotité (%)">
              <input
                className={inputCls}
                inputMode="numeric"
                value={form.quotite}
                onChange={(e) => setField("quotite", e.target.value)}
              />
            </Field>
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
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">5. Propositions</h2>
          <p className="text-xs text-slate-500">
            Comme dans Kérys : lance la simulation, choisis une offre (CARDIF, AXA, Generali…), puis exporte le devis PDF.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <Button
              type="button"
              size="sm"
              disabled={Boolean(busy)}
              onClick={() =>
                void runCall("tarif", () =>
                  adminFetch("/api/admin/sesame-lab/tarification", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(buildBody()),
                  }),
                )
              }
            >
              {busy === "tarif" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Simuler
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={Boolean(busy) || !selectedCodeProduit}
              onClick={() =>
                void runCall("devis", () =>
                  adminFetch("/api/admin/sesame-lab/devis", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(
                      buildBody({
                        codeProduit: selectedCodeProduit,
                      }),
                    ),
                  }),
                )
              }
            >
              {busy === "devis" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              <Download className="w-4 h-4" />
              Exporter le devis (produit sélectionné)
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setForm(EMPTY_FORM);
                setPrets([EMPTY_PRET()]);
                setPropositions([]);
                setSelectedCodeProduit(null);
                setLastResult(null);
              }}
            >
              Réinitialiser
            </Button>
            {selectedProp ? (
              <span className="text-xs text-slate-600">
                Sélection : <strong>{selectedProp.marque}</strong>{" "}
                <span className="font-mono text-slate-400">{selectedProp.codeProduit}</span>
              </span>
            ) : null}
          </div>

          {lastResult && !lastResult.ok && lastResult.error ? (
            <p className="text-sm text-red-600">{lastResult.error}</p>
          ) : null}

          {propositions.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800">
                  {propositions.length} proposition{propositions.length > 1 ? "s" : ""}
                </p>
                <p className="text-[11px] text-slate-500">Triées du moins cher au plus cher (coût total)</p>
              </div>
              <ul className="space-y-2">
                {propositions.map((p) => {
                  const selected = p.codeProduit === selectedCodeProduit;
                  const nonAssurable = p.type && p.type !== "TARIFABLE";
                  return (
                    <li key={p.codeProduit}>
                      <button
                        type="button"
                        disabled={Boolean(nonAssurable)}
                        onClick={() => setSelectedCodeProduit(p.codeProduit)}
                        className={`w-full text-left rounded-xl border px-4 py-3 transition ${
                          selected
                            ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200"
                            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                        } ${nonAssurable ? "opacity-60 cursor-not-allowed" : ""}`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-base font-bold text-slate-900">{p.marque}</span>
                              {selected ? (
                                <span className="rounded-full bg-emerald-600 text-white text-[10px] font-bold px-2 py-0.5">
                                  SÉLECTIONNÉ
                                </span>
                              ) : null}
                              {p.reductionCouple ? (
                                <span className="rounded-full bg-blue-50 text-blue-700 text-[10px] font-semibold px-2 py-0.5 border border-blue-100">
                                  Réduction couple
                                </span>
                              ) : null}
                              {nonAssurable ? (
                                <span className="rounded-full bg-amber-50 text-amber-800 text-[10px] font-semibold px-2 py-0.5 border border-amber-100">
                                  {p.type}
                                </span>
                              ) : (
                                <span className="rounded-full bg-slate-100 text-slate-600 text-[10px] font-semibold px-2 py-0.5">
                                  Tarifable
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] font-mono text-slate-400 mt-0.5">{p.codeProduit}</p>
                            {p.messages?.length ? (
                              <p className="text-xs text-amber-700 mt-1">
                                {p.messages.map((m) => m.texte).filter(Boolean).join(" · ")}
                              </p>
                            ) : null}
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-bold text-slate-900">{euro(p.tarifTotalAssurance)}</p>
                            <p className="text-[11px] text-slate-500">Coût total assurance</p>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                          <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                            <p className="text-slate-500">Cotisations</p>
                            <p className="font-semibold text-slate-800">{euro(p.tarifTotalCotisations)}</p>
                          </div>
                          <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                            <p className="text-slate-500">
                              Les {p.xPremieresAnnees ?? 8} premières années
                            </p>
                            <p className="font-semibold text-slate-800">
                              {euro(p.tarifCotisationsXPremieresAnnees)}
                            </p>
                          </div>
                          <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                            <p className="text-slate-500">TAEA</p>
                            <p className="font-semibold text-slate-800">{pct(p.taea)}</p>
                          </div>
                          <div className="rounded-lg bg-slate-50 px-2.5 py-2">
                            <p className="text-slate-500">Taux moyen</p>
                            <p className="font-semibold text-slate-800">{pct(p.tauxMoyen)}</p>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
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
