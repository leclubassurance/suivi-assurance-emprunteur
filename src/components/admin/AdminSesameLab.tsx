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

export default function AdminSesameLab({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<LabStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<CallResult | null>(null);
  const [codeOffre, setCodeOffre] = useState("");
  const [idDossier, setIdDossier] = useState("");
  const [overridesJson, setOverridesJson] = useState("{\n  \n}");

  const refreshStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const res = await adminFetch("/api/admin/sesame-lab/status");
      const data = await res.json().catch(() => ({}));
      setStatus(data);
      if (data?.defaultCodeOffre && !codeOffre) setCodeOffre(String(data.defaultCodeOffre));
    } catch (err: any) {
      setStatus({ ok: false, error: err?.message || "Erreur réseau" });
    } finally {
      setLoadingStatus(false);
    }
  }, [codeOffre]);

  useEffect(() => {
    void refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function parseOverrides(): Record<string, unknown> | undefined {
    const raw = overridesJson.trim();
    if (!raw || raw === "{" || raw === "{\n  \n}") return undefined;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : undefined;
    } catch {
      throw new Error("JSON overrides invalide");
    }
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
          <p className="text-xs text-slate-500">GET offres / produits / frais — affiche la réponse JSON.</p>
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
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-600 flex-1 min-w-[180px]">
              Code offre
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
                value={codeOffre}
                onChange={(e) => setCodeOffre(e.target.value)}
                placeholder="ex. OFFRE 20 SUB"
              />
            </label>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={Boolean(busy) || !codeOffre.trim()}
              onClick={() =>
                void runCall("produits", () =>
                  adminFetch(
                    `/api/admin/sesame-lab/referentiel/offre/${encodeURIComponent(codeOffre.trim())}/produits`,
                  ),
                )
              }
            >
              {busy === "produits" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              GET produits
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={Boolean(busy) || !codeOffre.trim()}
              onClick={() =>
                void runCall("assureurs", () =>
                  adminFetch(
                    `/api/admin/sesame-lab/referentiel/offre/${encodeURIComponent(codeOffre.trim())}/assureurs`,
                  ),
                )
              }
            >
              {busy === "assureurs" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              GET assureurs
            </Button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Overrides payload (optionnel)</h2>
          <p className="text-xs text-slate-500">
            JSON fusionné dans le payload d&apos;exemple (codeOffre, codeProduit, codeBareme, idCommissionnement, idFormule…).
          </p>
          <textarea
            className="w-full min-h-[100px] rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono"
            value={overridesJson}
            onChange={(e) => setOverridesJson(e.target.value)}
            spellCheck={false}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={Boolean(busy)}
              onClick={() =>
                void runCall("sample", () => adminFetch("/api/admin/sesame-lab/sample-payload"))
              }
            >
              Voir payload exemple
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={Boolean(busy)}
              onClick={() =>
                void runCall("tarif", async () => {
                  const overrides = parseOverrides();
                  return adminFetch("/api/admin/sesame-lab/tarification", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ overrides }),
                  });
                })
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
                void runCall("devis", async () => {
                  const overrides = parseOverrides();
                  return adminFetch("/api/admin/sesame-lab/devis", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ overrides }),
                  });
                })
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
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Parcours détaillé</h2>
          <p className="text-xs text-slate-500">
            Création dossier → <code className="font-mono">id</code> + <code className="font-mono">lienSesame</code> · ouverture par id.
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
                void runCall("creation", async () => {
                  const overrides = parseOverrides();
                  return adminFetch("/api/admin/sesame-lab/dossier/creation", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ overrides }),
                  });
                })
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
