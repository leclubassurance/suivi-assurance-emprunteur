import React, { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FlaskConical,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { adminFetch } from "../../lib/adminApi";
import { Button } from "../ui/Button";

type LabStatus = {
  ok: boolean;
  env?: string;
  baseUrl?: string;
  basicAuthConfigured?: boolean;
  codeEntite?: string | null;
  defaultCodeOffre?: string | null;
  labAllowed?: boolean;
  missing?: string[];
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

type CallResult = {
  ok?: boolean;
  status?: number;
  durationMs?: number;
  requestId?: string;
  error?: string;
  data?: unknown;
  pdfBase64?: string;
  fileName?: string;
};

/** Champs saisis à la main (avant mapping auto depuis le formulaire CRM). */
type LabForm = {
  codeOffre: string;
  codeProduit: string;
  codeBareme: string;
  idCommissionnement: string;
  fraisDistribution: string;
  idFormule: string;
  dateEffetGaranties: string;
  civilite: string;
  prenom: string;
  nom: string;
  dateNaissance: string;
  codePostal: string;
  fumeur: boolean;
  poids: string;
  taille: string;
  quotite: string;
  franchise: string;
  idStatutProfessionnel: string;
  professionLibelle: string;
  montantPret: string;
  dureePret: string;
  tauxPret: string;
  idTypePret: string;
};

const EMPTY_FORM: LabForm = {
  codeOffre: "",
  codeProduit: "",
  codeBareme: "",
  idCommissionnement: "0",
  fraisDistribution: "0",
  idFormule: "101",
  dateEffetGaranties: "2026-11-01",
  civilite: "Monsieur",
  prenom: "",
  nom: "",
  dateNaissance: "",
  codePostal: "",
  fumeur: false,
  poids: "75",
  taille: "178",
  quotite: "100",
  franchise: "90",
  idStatutProfessionnel: "1",
  professionLibelle: "Employe de bureau",
  montantPret: "",
  dureePret: "",
  tauxPret: "",
  idTypePret: "51",
};

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
        ok ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-amber-50 text-amber-800 border border-amber-200"
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
const monoCls = `${inputCls} font-mono`;

function formToOverrides(form: LabForm, extraJson?: Record<string, unknown>): Record<string, unknown> {
  const overrides: Record<string, unknown> = {
    codeOffre: form.codeOffre.trim() || undefined,
    codeProduit: form.codeProduit.trim() || undefined,
    codeBareme: form.codeBareme.trim() || undefined,
    idCommissionnement: form.idCommissionnement.trim() || undefined,
    fraisDistribution: form.fraisDistribution.trim() ? Number(form.fraisDistribution) : 0,
    idFormule: form.idFormule.trim() ? Number(form.idFormule) : undefined,
    dateEffetGaranties: form.dateEffetGaranties.trim() || undefined,
    civilite: form.civilite,
    prenom: form.prenom.trim() || undefined,
    nom: form.nom.trim() || undefined,
    dateNaissance: form.dateNaissance.trim() || undefined,
    codePostal: form.codePostal.trim() || undefined,
    fumeur: form.fumeur,
    poids: form.poids.trim() ? Number(form.poids) : undefined,
    taille: form.taille.trim() ? Number(form.taille) : undefined,
    quotite: form.quotite.trim() ? Number(form.quotite) : undefined,
    franchise: form.franchise.trim() ? Number(form.franchise) : undefined,
    idStatutProfessionnel: form.idStatutProfessionnel.trim()
      ? Number(form.idStatutProfessionnel)
      : undefined,
    professionLibelle: form.professionLibelle.trim() || undefined,
    montantPret: form.montantPret.trim() ? Number(form.montantPret) : undefined,
    dureePret: form.dureePret.trim() ? Number(form.dureePret) : undefined,
    tauxPret: form.tauxPret.trim() ? Number(form.tauxPret) : undefined,
    idTypePret: form.idTypePret.trim() ? Number(form.idTypePret) : undefined,
  };
  // Drop undefined keys
  for (const k of Object.keys(overrides)) {
    if (overrides[k] === undefined || overrides[k] === "") delete overrides[k];
  }
  return { ...overrides, ...(extraJson || {}) };
}

export default function AdminSesameLab({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<LabStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<CallResult | null>(null);
  const [idDossier, setIdDossier] = useState("");
  const [form, setForm] = useState<LabForm>(EMPTY_FORM);
  const [showAdvancedJson, setShowAdvancedJson] = useState(false);
  const [overridesJson, setOverridesJson] = useState("{\n  \n}");
  const [defaultsHydrated, setDefaultsHydrated] = useState(false);

  const setField = <K extends keyof LabForm>(key: K, value: LabForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const refreshStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const res = await adminFetch("/api/admin/sesame-lab/status");
      const data = await res.json().catch(() => ({}));
      setStatus(data);
      if (!defaultsHydrated) {
        setForm((prev) => ({
          ...prev,
          codeOffre: prev.codeOffre || String(data?.defaultCodeOffre || ""),
        }));
        setDefaultsHydrated(true);
      }
    } catch (err: any) {
      setStatus({ ok: false, error: err?.message || "Erreur réseau" });
    } finally {
      setLoadingStatus(false);
    }
  }, [defaultsHydrated]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  function parseExtraJson(): Record<string, unknown> | undefined {
    if (!showAdvancedJson) return undefined;
    const raw = overridesJson.trim();
    if (!raw || raw === "{" || raw === "{\n  \n}") return undefined;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : undefined;
    } catch {
      throw new Error("JSON avancé invalide");
    }
  }

  function buildBody() {
    return { overrides: formToOverrides(form, parseExtraJson()) };
  }

  async function runCall(key: string, fn: () => Promise<Response>) {
    setBusy(key);
    setLastResult(null);
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      setLastResult(data);
      await refreshStatus();
    } catch (err: any) {
      setLastResult({ ok: false, error: err?.message || "Erreur réseau" });
    } finally {
      setBusy(null);
    }
  }

  function downloadPdf() {
    if (!lastResult?.pdfBase64) return;
    const a = document.createElement("a");
    a.href = `data:application/pdf;base64,${lastResult.pdfBase64}`;
    a.download = lastResult.fileName || "sesame-lab-devis.pdf";
    a.click();
  }

  const envBanner =
    status?.env === "production" ? (
      <div className="rounded-lg border border-red-300 bg-red-50 text-red-800 px-4 py-3 text-sm font-medium">
        SESAME_ENV=production — le lab est bloqué. Passez SESAME_ENV=test sur Railway pour tester R1.
      </div>
    ) : (
      <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-950 px-4 py-3 text-sm font-semibold flex items-center gap-2">
        <FlaskConical className="w-4 h-4 shrink-0" />
        ENV TEST — appels vers Sésame R1 uniquement. Aucune écriture sur les dossiers CRM.
      </div>
    );

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
            Lab Sésame (test)
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => void refreshStatus()} disabled={loadingStatus}>
            {loadingStatus ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Statut
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {envBanner}

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Statut connexion</h2>
          {loadingStatus && !status ? (
            <p className="text-sm text-slate-500">Chargement…</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <StatusPill ok={Boolean(status?.labAllowed)} label={status?.labAllowed ? "Lab autorisé" : "Lab bloqué"} />
                <StatusPill
                  ok={Boolean(status?.basicAuthConfigured)}
                  label={status?.basicAuthConfigured ? "Basic Auth configuré" : "Basic Auth manquant"}
                />
                <StatusPill
                  ok={Boolean(status?.codeEntite)}
                  label={status?.codeEntite ? `codeEntite ${status.codeEntite}` : "codeEntite manquant"}
                />
              </div>
              <dl className="grid sm:grid-cols-2 gap-2 text-sm text-slate-700">
                <div>
                  <dt className="text-xs text-slate-500">Base URL</dt>
                  <dd className="font-mono text-xs break-all">{status?.baseUrl || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">ENV</dt>
                  <dd className="font-semibold">{status?.env || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Offre par défaut</dt>
                  <dd className="font-mono text-xs">{status?.defaultCodeOffre || "non défini"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Variables manquantes</dt>
                  <dd className="text-xs">{status?.missing?.length ? status.missing.join(", ") : "aucune"}</dd>
                </div>
              </dl>
              {status?.error ? <p className="text-sm text-red-600">{status.error}</p> : null}
            </>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Référentiel</h2>
          <p className="text-xs text-slate-500">
            Découvre les codes offre / produit autorisés pour ton compte, puis reporte-les dans le formulaire ci-dessous.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={Boolean(busy)}
              onClick={() =>
                void runCall("offres", () => adminFetch("/api/admin/sesame-lab/referentiel/offres"))
              }
            >
              {busy === "offres" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              GET offres
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={Boolean(busy)}
              onClick={() =>
                void runCall("frais", () => adminFetch("/api/admin/sesame-lab/referentiel/frais-distribution"))
              }
            >
              {busy === "frais" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              GET frais distribution
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={Boolean(busy) || !form.codeOffre.trim()}
              onClick={() =>
                void runCall("produits", () =>
                  adminFetch(
                    `/api/admin/sesame-lab/referentiel/offre/${encodeURIComponent(form.codeOffre.trim())}/produits`,
                  ),
                )
              }
            >
              {busy === "produits" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              GET produits (code offre)
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={Boolean(busy) || !form.codeOffre.trim()}
              onClick={() =>
                void runCall("assureurs", () =>
                  adminFetch(
                    `/api/admin/sesame-lab/referentiel/offre/${encodeURIComponent(form.codeOffre.trim())}/assureurs`,
                  ),
                )
              }
            >
              {busy === "assureurs" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              GET assureurs
            </Button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-5">
          <div>
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Saisie devis / tarification</h2>
            <p className="text-xs text-slate-500 mt-1">
              Parcours LCIF = <strong>substitution ADE uniquement</strong>. Les codes offre/produit/barème viennent du
              catalogue Kereis (GET offres / produits), pas du client. Commissionnement / frais = <strong>0</strong> pour
              l&apos;instant (modifiable plus tard via Railway).
            </p>
          </div>

          <div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide mb-2">Codes LCIF / Sésame (catalogue)</h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Field label="Code offre substitution *">
                <input
                  className={monoCls}
                  value={form.codeOffre}
                  onChange={(e) => setField("codeOffre", e.target.value)}
                  placeholder="via GET offres"
                />
              </Field>
              <Field label="Code produit *">
                <input
                  className={monoCls}
                  value={form.codeProduit}
                  onChange={(e) => setField("codeProduit", e.target.value)}
                  placeholder="via GET produits"
                />
              </Field>
              <Field label="Code barème *">
                <input
                  className={monoCls}
                  value={form.codeBareme}
                  onChange={(e) => setField("codeBareme", e.target.value)}
                  placeholder="ex. 3"
                />
              </Field>
              <Field label="Id commissionnement (0 pour l’instant)">
                <input
                  className={monoCls}
                  value={form.idCommissionnement}
                  onChange={(e) => setField("idCommissionnement", e.target.value)}
                  placeholder="0"
                />
              </Field>
              <Field label="Frais distribution (€)">
                <input
                  className={inputCls}
                  inputMode="decimal"
                  value={form.fraisDistribution}
                  onChange={(e) => setField("fraisDistribution", e.target.value)}
                  placeholder="0"
                />
              </Field>
              <Field label="Id formule">
                <input
                  className={monoCls}
                  value={form.idFormule}
                  onChange={(e) => setField("idFormule", e.target.value)}
                  placeholder="101"
                />
              </Field>
              <Field label="Date effet garanties">
                <input
                  type="date"
                  className={inputCls}
                  value={form.dateEffetGaranties}
                  onChange={(e) => setField("dateEffetGaranties", e.target.value)}
                />
              </Field>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide mb-2">Assuré</h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Field label="Civilité">
                <select
                  className={inputCls}
                  value={form.civilite}
                  onChange={(e) => setField("civilite", e.target.value)}
                >
                  <option value="Monsieur">Monsieur</option>
                  <option value="Madame">Madame</option>
                </select>
              </Field>
              <Field label="Prénom">
                <input
                  className={inputCls}
                  value={form.prenom}
                  onChange={(e) => setField("prenom", e.target.value)}
                />
              </Field>
              <Field label="Nom">
                <input className={inputCls} value={form.nom} onChange={(e) => setField("nom", e.target.value)} />
              </Field>
              <Field label="Date de naissance">
                <input
                  type="date"
                  className={inputCls}
                  value={form.dateNaissance}
                  onChange={(e) => setField("dateNaissance", e.target.value)}
                />
              </Field>
              <Field label="Code postal">
                <input
                  className={monoCls}
                  value={form.codePostal}
                  onChange={(e) => setField("codePostal", e.target.value)}
                  placeholder="44000"
                />
              </Field>
              <Field label="Fumeur">
                <label className="inline-flex items-center gap-2 h-[42px] text-sm text-slate-800">
                  <input
                    type="checkbox"
                    checked={form.fumeur}
                    onChange={(e) => setField("fumeur", e.target.checked)}
                  />
                  Oui
                </label>
              </Field>
              <Field label="Poids (kg)">
                <input
                  className={inputCls}
                  inputMode="numeric"
                  value={form.poids}
                  onChange={(e) => setField("poids", e.target.value)}
                />
              </Field>
              <Field label="Taille (cm)">
                <input
                  className={inputCls}
                  inputMode="numeric"
                  value={form.taille}
                  onChange={(e) => setField("taille", e.target.value)}
                />
              </Field>
              <Field label="Quotité (%)">
                <input
                  className={inputCls}
                  inputMode="numeric"
                  value={form.quotite}
                  onChange={(e) => setField("quotite", e.target.value)}
                />
              </Field>
              <Field label="Franchise (j)">
                <input
                  className={inputCls}
                  inputMode="numeric"
                  value={form.franchise}
                  onChange={(e) => setField("franchise", e.target.value)}
                />
              </Field>
              <Field label="Id statut pro">
                <input
                  className={monoCls}
                  value={form.idStatutProfessionnel}
                  onChange={(e) => setField("idStatutProfessionnel", e.target.value)}
                />
              </Field>
              <Field label="Libellé profession" className="sm:col-span-2">
                <input
                  className={inputCls}
                  value={form.professionLibelle}
                  onChange={(e) => setField("professionLibelle", e.target.value)}
                />
              </Field>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide mb-2">Prêt</h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Field label="Montant (€)">
                <input
                  className={inputCls}
                  inputMode="decimal"
                  value={form.montantPret}
                  onChange={(e) => setField("montantPret", e.target.value)}
                  placeholder="150000"
                />
              </Field>
              <Field label="Durée (mois)">
                <input
                  className={inputCls}
                  inputMode="numeric"
                  value={form.dureePret}
                  onChange={(e) => setField("dureePret", e.target.value)}
                  placeholder="240"
                />
              </Field>
              <Field label="Taux (%)">
                <input
                  className={inputCls}
                  inputMode="decimal"
                  value={form.tauxPret}
                  onChange={(e) => setField("tauxPret", e.target.value)}
                  placeholder="3.5"
                />
              </Field>
              <Field label="Id type prêt">
                <input
                  className={monoCls}
                  value={form.idTypePret}
                  onChange={(e) => setField("idTypePret", e.target.value)}
                  placeholder="51"
                />
              </Field>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              disabled={Boolean(busy)}
              onClick={() =>
                void runCall("sample", () =>
                  adminFetch("/api/admin/sesame-lab/sample-payload", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(buildBody()),
                  }),
                )
              }
            >
              Voir payload construit
            </Button>
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
              POST tarification
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={Boolean(busy)}
              onClick={() =>
                void runCall("devis", () =>
                  adminFetch("/api/admin/sesame-lab/devis", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(buildBody()),
                  }),
                )
              }
            >
              {busy === "devis" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              POST devis (PDF)
            </Button>
            {lastResult?.pdfBase64 ? (
              <Button type="button" size="sm" variant="ghost" onClick={downloadPdf}>
                <Download className="w-4 h-4" /> Télécharger PDF
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setForm(EMPTY_FORM)}
            >
              Réinitialiser
            </Button>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <button
              type="button"
              className="text-xs font-semibold text-slate-600 hover:text-slate-900"
              onClick={() => setShowAdvancedJson((v) => !v)}
            >
              {showAdvancedJson ? "▾" : "▸"} JSON avancé (optionnel)
            </button>
            {showAdvancedJson ? (
              <>
                <p className="text-xs text-slate-500 mt-2">
                  Fusionné par-dessus le formulaire (champs supplémentaires annexes Kereis).
                </p>
                <textarea
                  className="mt-2 w-full min-h-[100px] rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono"
                  value={overridesJson}
                  onChange={(e) => setOverridesJson(e.target.value)}
                  spellCheck={false}
                />
              </>
            ) : null}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Parcours détaillé</h2>
          <p className="text-xs text-slate-500">
            Utilise le même formulaire ci-dessus. Création → <code className="font-mono">id</code> +{" "}
            <code className="font-mono">lienSesame</code>.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={Boolean(busy)}
              onClick={() =>
                void runCall("connexion", () =>
                  adminFetch("/api/admin/sesame-lab/connexion", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: "{}",
                  }),
                )
              }
            >
              {busy === "connexion" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              POST connexion
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={Boolean(busy)}
              onClick={() =>
                void runCall("creation", () =>
                  adminFetch("/api/admin/sesame-lab/dossier/creation", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(buildBody()),
                  }),
                )
              }
            >
              {busy === "creation" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              POST création parcours
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-600">
              idDossier
              <input
                className="mt-1 block w-40 rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
                value={idDossier}
                onChange={(e) => setIdDossier(e.target.value)}
                placeholder="ex. 123456"
              />
            </label>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={Boolean(busy) || !idDossier.trim()}
              onClick={() =>
                void runCall("ouverture", () =>
                  adminFetch("/api/admin/sesame-lab/dossier/ouverture", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ idDossier: Number(idDossier) }),
                  }),
                )
              }
            >
              {busy === "ouverture" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              POST ouverture
            </Button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Dernier résultat</h2>
          {lastResult ? (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                <StatusPill ok={Boolean(lastResult.ok)} label={lastResult.ok ? "OK" : "Erreur"} />
                {lastResult.status != null ? <span className="text-slate-600">HTTP {lastResult.status}</span> : null}
                {lastResult.durationMs != null ? (
                  <span className="text-slate-600">{lastResult.durationMs} ms</span>
                ) : null}
                {lastResult.requestId ? (
                  <span className="font-mono text-slate-500">requestId {lastResult.requestId}</span>
                ) : null}
              </div>
              {lastResult.error ? <p className="text-sm text-red-600">{lastResult.error}</p> : null}
              {(() => {
                const lien =
                  lastResult.data &&
                  typeof lastResult.data === "object" &&
                  (lastResult.data as any).lienSesame
                    ? String((lastResult.data as any).lienSesame)
                    : null;
                return lien ? (
                  <a
                    href={lien}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-semibold text-blue-700 underline break-all"
                  >
                    Ouvrir lienSesame
                  </a>
                ) : null;
              })()}
              <JsonBlock
                value={
                  lastResult.pdfBase64
                    ? { ...lastResult, pdfBase64: `[base64 ${Math.round(lastResult.pdfBase64.length / 1024)} KB]` }
                    : lastResult
                }
              />
            </>
          ) : (
            <p className="text-sm text-slate-500">Aucun appel pour l&apos;instant.</p>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Journal des appels</h2>
          {!status?.recentCalls?.length ? (
            <p className="text-sm text-slate-500">Vide.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-xs font-mono">
              {status.recentCalls.map((c, i) => (
                <li key={`${c.at}-${i}`} className="py-2 flex flex-wrap gap-x-3 gap-y-1">
                  <span className="text-slate-400">{c.at.slice(11, 19)}</span>
                  <span className={c.ok ? "text-emerald-700" : "text-red-600"}>
                    {c.method} {c.path} → {c.status}
                  </span>
                  <span className="text-slate-500">{c.durationMs}ms</span>
                  {c.requestId ? <span className="text-slate-400">{c.requestId}</span> : null}
                  {c.error ? <span className="text-red-500 truncate max-w-full">{c.error}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
