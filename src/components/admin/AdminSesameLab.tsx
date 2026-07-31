import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  payload?: unknown;
  pdfBase64?: string;
  fileName?: string;
};

/**
 * Lab = même infos que le formulaire client + codes catalogue Kereis (hors client).
 * Pas de poids / taille (jamais demandés au client).
 */
type LabForm = {
  // Catalogue Kereis (pas client) — à découvrir via GET offres / produits
  codeOffre: string;
  codeProduit: string;
  codeBareme: string;
  idCommissionnement: string;
  fraisDistribution: string;
  dateEffetGaranties: string;
  // Assuré (formulaire client)
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
  // Prêt (formulaire client + champs souvent lus sur l’offre de prêt)
  capitalRestant: string;
  banquePreteuse: string;
  datePremiereEcheance: string;
  dureeRestante: string;
  taux: string;
};

const EMPTY_FORM: LabForm = {
  codeOffre: "",
  codeProduit: "",
  codeBareme: "",
  idCommissionnement: "0",
  fraisDistribution: "0",
  dateEffetGaranties: "2026-11-01",
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
  capitalRestant: "",
  banquePreteuse: "",
  datePremiereEcheance: "",
  dureeRestante: "",
  taux: "",
};

/** Mapping provisoire statut formulaire → id Sésame (à affiner avec annexes Kereis). */
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
  hint,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  hint?: string;
}) {
  return (
    <label className={`text-xs text-slate-600 block ${className || ""}`}>
      {label}
      <div className="mt-1">{children}</div>
      {hint ? <p className="mt-1 text-[10px] text-slate-400">{hint}</p> : null}
    </label>
  );
}

const inputCls = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm";
const monoCls = `${inputCls} font-mono`;

function extractOfferCodes(data: unknown): string[] {
  const codes = new Set<string>();
  const walk = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    for (const key of ["codeOffre", "code", "codeProduit", "codeBareme"]) {
      if (typeof o[key] === "string" && o[key].trim()) codes.add(String(o[key]).trim());
    }
    Object.values(o).forEach(walk);
  };
  walk(data);
  return Array.from(codes).slice(0, 40);
}

function formToOverrides(form: LabForm): Record<string, unknown> {
  const statutLabel =
    STATUT_PRO_OPTIONS.find((o) => o.value === form.statutPro)?.label || form.statutPro || "Employé de bureau";
  const overrides: Record<string, unknown> = {
    codeOffre: form.codeOffre.trim() || undefined,
    codeProduit: form.codeProduit.trim() || undefined,
    codeBareme: form.codeBareme.trim() || undefined,
    idCommissionnement: form.idCommissionnement.trim() || "0",
    fraisDistribution: form.fraisDistribution.trim() ? Number(form.fraisDistribution) : 0,
    dateEffetGaranties: form.dateEffetGaranties.trim() || undefined,
    civilite: form.civilite,
    prenom: form.prenom.trim() || undefined,
    nom: form.nom.trim() || undefined,
    dateNaissance: form.dateNaissance.trim() || undefined,
    codePostal: form.codePostal.trim() || undefined,
    fumeur: form.fumeur,
    professionLibelle: form.profession.trim() || statutLabel,
    idStatutProfessionnel: STATUT_PRO_TO_SESAME_ID[form.statutPro] ?? 1,
    idQualite: QUALITE_TO_SESAME_ID[form.qualite] ?? 3,
    professionManuelle: form.professionManuelle,
    travauxEnHauteur: form.travauxHauteur,
    deplacementsProfessionnels: form.deplacementsPro !== "< 20000 Km",
    montantPret: form.capitalRestant.trim() ? Number(form.capitalRestant) : undefined,
    dureePret: form.dureeRestante.trim() ? Number(form.dureeRestante) : undefined,
    tauxPret: form.taux.trim() ? Number(form.taux) : undefined,
  };
  for (const k of Object.keys(overrides)) {
    if (overrides[k] === undefined || overrides[k] === "") delete overrides[k];
  }
  return overrides;
}

export default function AdminSesameLab({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<LabStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<CallResult | null>(null);
  const [idDossier, setIdDossier] = useState("");
  const [form, setForm] = useState<LabForm>(EMPTY_FORM);
  const [defaultsHydrated, setDefaultsHydrated] = useState(false);
  const [discoveredCodes, setDiscoveredCodes] = useState<string[]>([]);

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

  function buildBody() {
    return { overrides: formToOverrides(form) };
  }

  async function runCall(key: string, fn: () => Promise<Response>) {
    setBusy(key);
    setLastResult(null);
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      setLastResult(data);
      if ((key === "offres" || key === "produits") && data?.data) {
        const codes = extractOfferCodes(data.data);
        if (codes.length) setDiscoveredCodes(codes);
      }
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
        ENV TEST — substitution ADE · appels R1 uniquement · aucune écriture CRM
      </div>
    );

  const statutHint = useMemo(
    () => STATUT_PRO_OPTIONS.find((o) => o.value === form.statutPro)?.label,
    [form.statutPro],
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
              </dl>
              {status?.error ? <p className="text-sm text-red-600">{status.error}</p> : null}
            </>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
              Codes catalogue Kereis (pas le client)
            </h2>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Tu ne les connais pas encore : c’est normal. Clique <strong>GET offres</strong>, puis choisis une offre de
              substitution dans la liste / le JSON. Ensuite <strong>GET produits</strong> pour obtenir produit + barème.
              Une fois trouvés, on les figera sur Railway — le client ne les saisit jamais.
            </p>
          </div>
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
              1. GET offres
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
              2. GET produits
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={Boolean(busy)}
              onClick={() =>
                void runCall("frais", () => adminFetch("/api/admin/sesame-lab/referentiel/frais-distribution"))
              }
            >
              {busy === "frais" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              GET frais
            </Button>
          </div>

          {discoveredCodes.length > 0 ? (
            <div>
              <p className="text-xs text-slate-500 mb-2">Codes détectés dans la dernière réponse — clique pour remplir :</p>
              <div className="flex flex-wrap gap-1.5">
                {discoveredCodes.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-mono hover:bg-indigo-50 hover:border-indigo-200"
                    onClick={() => {
                      if (!form.codeOffre) setField("codeOffre", c);
                      else if (!form.codeProduit) setField("codeProduit", c);
                      else if (!form.codeBareme) setField("codeBareme", c);
                      else setField("codeOffre", c);
                    }}
                    title="Remplit le prochain champ catalogue vide"
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Field label="Code offre substitution" hint="Depuis GET offres">
              <input
                className={monoCls}
                value={form.codeOffre}
                onChange={(e) => setField("codeOffre", e.target.value)}
                placeholder="après GET offres"
              />
            </Field>
            <Field label="Code produit" hint="Depuis GET produits">
              <input
                className={monoCls}
                value={form.codeProduit}
                onChange={(e) => setField("codeProduit", e.target.value)}
                placeholder="après GET produits"
              />
            </Field>
            <Field label="Code barème" hint="Souvent dans la fiche produit">
              <input
                className={monoCls}
                value={form.codeBareme}
                onChange={(e) => setField("codeBareme", e.target.value)}
                placeholder="après GET produits"
              />
            </Field>
            <Field label="Commissionnement" hint="0 pour l’instant">
              <input
                className={monoCls}
                value={form.idCommissionnement}
                onChange={(e) => setField("idCommissionnement", e.target.value)}
              />
            </Field>
            <Field label="Frais distribution (€)" hint="0 pour l’instant">
              <input
                className={inputCls}
                inputMode="decimal"
                value={form.fraisDistribution}
                onChange={(e) => setField("fraisDistribution", e.target.value)}
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
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-5">
          <div>
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
              Données client (= formulaire site)
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Uniquement ce que tu demandes au client. Pas de poids / taille. Plus tard : prérempli depuis le dossier CRM.
            </p>
          </div>

          <div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide mb-2">Assuré</h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Field label="Civilité">
                <select className={inputCls} value={form.civilite} onChange={(e) => setField("civilite", e.target.value)}>
                  <option value="Monsieur">Monsieur</option>
                  <option value="Madame">Madame</option>
                </select>
              </Field>
              <Field label="Prénom">
                <input className={inputCls} value={form.prenom} onChange={(e) => setField("prenom", e.target.value)} />
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
              <Field label="Qualité">
                <select className={inputCls} value={form.qualite} onChange={(e) => setField("qualite", e.target.value)}>
                  {QUALITE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Code postal de résidence">
                <input
                  className={monoCls}
                  value={form.codePostal}
                  onChange={(e) => setField("codePostal", e.target.value)}
                />
              </Field>
              <Field label="Statut professionnel" hint={statutHint}>
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
              <Field label="Métier exercé" className="sm:col-span-2">
                <input
                  className={inputCls}
                  value={form.profession}
                  onChange={(e) => setField("profession", e.target.value)}
                  placeholder="ex. Comptable"
                />
              </Field>
              <Field label="Déplacements pro">
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
          </div>

          <div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide mb-2">Prêt</h3>
            <p className="text-[11px] text-slate-500 mb-2">
              Capital restant = formulaire client. Durée / taux = en général lus sur l’offre de prêt / tableau
              d’amortissement (pas saisis par le client sur le site).
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Field label="Capital restant dû (€)">
                <input
                  className={inputCls}
                  inputMode="decimal"
                  value={form.capitalRestant}
                  onChange={(e) => setField("capitalRestant", e.target.value)}
                />
              </Field>
              <Field label="Banque prêteuse">
                <input
                  className={inputCls}
                  value={form.banquePreteuse}
                  onChange={(e) => setField("banquePreteuse", e.target.value)}
                />
              </Field>
              <Field label="Date 1ère échéance">
                <input
                  type="month"
                  className={inputCls}
                  value={form.datePremiereEcheance}
                  onChange={(e) => setField("datePremiereEcheance", e.target.value)}
                />
              </Field>
              <Field label="Durée restante (mois)" hint="Souvent depuis le tableau d’amortissement">
                <input
                  className={inputCls}
                  inputMode="numeric"
                  value={form.dureeRestante}
                  onChange={(e) => setField("dureeRestante", e.target.value)}
                />
              </Field>
              <Field label="Taux (%)" hint="Souvent depuis l’offre de prêt">
                <input
                  className={inputCls}
                  inputMode="decimal"
                  value={form.taux}
                  onChange={(e) => setField("taux", e.target.value)}
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
            <Button type="button" size="sm" variant="ghost" onClick={() => setForm(EMPTY_FORM)}>
              Réinitialiser
            </Button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Parcours détaillé</h2>
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
