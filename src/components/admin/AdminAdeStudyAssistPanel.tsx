import React, { useEffect, useRef, useState } from "react";
import { Loader2, MessageSquare, RotateCcw, Send, Sparkles } from "lucide-react";
import { Tabs } from "../ui/Tabs";

export type AdeAssistMode = "kereis" | "study";

export type AdeAssistMessage = {
  role: "assistant" | "user";
  content: string;
  at: string;
};

export type AdeAssistState = {
  mode?: AdeAssistMode;
  overrides: {
    currentTotalEur?: number;
    proposedTotalEur?: number;
    remainingMonths?: number;
    feesAssureurEur?: number;
    notes?: string;
  };
  kereisPatches?: Record<string, string | number | boolean>;
  messages: AdeAssistMessage[];
  status: "idle" | "needs_input" | "ready" | "awaiting_clarification";
  pendingField?: string | null;
  openQuestions?: string[];
  updatedAt?: string;
};

type EconomyPreview = {
  ok?: boolean;
  reliability?: string;
  currentTotalEur?: number | null;
  proposedTotalEur?: number | null;
  remainingMonths?: number | null;
  feesAssureurEur?: number | null;
  grossSavingsEur?: number | null;
};

function fmtEur(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function renderMdLite(text: string) {
  const parts = String(text || "").split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return (
        <strong key={i} className="font-bold">
          {p.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

export default function AdminAdeStudyAssistPanel({
  dossierId,
  open,
  onClose,
  adminFetch,
  onReady,
  onDossierUpdated,
  initialMode = "study",
  onKereisDraft,
}: {
  dossierId: string;
  open: boolean;
  onClose: () => void;
  adminFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onReady?: (mode: AdeAssistMode) => void;
  onDossierUpdated?: () => void;
  initialMode?: AdeAssistMode;
  onKereisDraft?: (draft: any) => void;
}) {
  const [mode, setMode] = useState<AdeAssistMode>(initialMode);
  const [assist, setAssist] = useState<AdeAssistState | null>(null);
  const [preview, setPreview] = useState<EconomyPreview | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const startedKey = useRef<string | null>(null);

  const scrollDown = () => {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
  };

  const applyPayload = (data: any) => {
    if (data?.assist) {
      setAssist(data.assist);
      if (data.assist.mode === "kereis" || data.assist.mode === "study") {
        setMode(data.assist.mode);
      }
    }
    if (data?.economyPreview) setPreview(data.economyPreview);
    if (data?.kereisDraft && onKereisDraft) onKereisDraft(data.kereisDraft);
    if (data?.assist?.status === "ready") onReady?.(data.assist.mode || mode);
    onDossierUpdated?.();
    scrollDown();
  };

  const start = async (m: AdeAssistMode = mode) => {
    if (!dossierId) return;
    try {
      setBusy(true);
      setError(null);
      const res = await adminFetch(`/api/admin/dossiers/${encodeURIComponent(dossierId)}/ade-assist/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: m }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Impossible de démarrer l'assistant");
        return;
      }
      startedKey.current = `${dossierId}:${m}`;
      applyPayload(data);
    } catch {
      setError("Erreur réseau");
    } finally {
      setBusy(false);
    }
  };

  const load = async (m: AdeAssistMode) => {
    try {
      setBusy(true);
      const res = await adminFetch(`/api/admin/dossiers/${encodeURIComponent(dossierId)}/ade-assist`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.assist?.messages?.length && data.assist.mode === m) {
        applyPayload(data);
      } else {
        await start(m);
      }
    } catch {
      await start(m);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open || !dossierId) return;
    const key = `${dossierId}:${mode}`;
    if (startedKey.current === key && assist?.messages?.length) return;
    void load(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dossierId, mode]);

  useEffect(() => {
    if (open) setMode(initialMode);
  }, [open, initialMode]);

  useEffect(() => {
    scrollDown();
  }, [assist?.messages?.length]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    try {
      setBusy(true);
      setError(null);
      const res = await adminFetch(`/api/admin/dossiers/${encodeURIComponent(dossierId)}/ade-assist/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Envoi impossible");
        setInput(text);
        return;
      }
      applyPayload(data);
    } catch {
      setError("Erreur réseau");
      setInput(text);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    try {
      setBusy(true);
      setError(null);
      const res = await adminFetch(`/api/admin/dossiers/${encodeURIComponent(dossierId)}/ade-assist/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Reset impossible");
        return;
      }
      setAssist(data.assist);
      startedKey.current = null;
      await start(mode);
    } catch {
      setError("Erreur réseau");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const ready = assist?.status === "ready";
  const clarifying = assist?.status === "awaiting_clarification";

  return (
    <div className="rounded-2xl border border-indigo-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 bg-indigo-50 border-b border-indigo-100">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-4 h-4 text-indigo-700 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-black text-indigo-950">Assistant ADE courtier</p>
            <p className="text-[11px] text-indigo-800/80 truncate">
              Prompt LCIF — extraction Kereis + étude économie · STOP &amp; DEMANDER
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => void reset()}
            disabled={busy}
            className="p-2 rounded-lg text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
            title="Réinitialiser"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-bold text-indigo-800 px-2 py-1 rounded-lg hover:bg-indigo-100"
          >
            Fermer
          </button>
        </div>
      </div>

      <div className="px-4 pt-3">
        <Tabs
          value={mode}
          onChange={(m) => {
            setMode(m);
            startedKey.current = null;
          }}
          items={[
            { key: "kereis", label: "Fiche Kereis" },
            { key: "study", label: "Étude économie" },
          ]}
          className="w-full sm:w-auto"
        />
      </div>

      {mode === "study" ? (
        <div className="grid sm:grid-cols-4 gap-2 px-4 py-2 border-b border-slate-100 bg-slate-50 text-[11px] mt-2">
          <div>
            <span className="text-slate-500">Actuelle</span>
            <p className="font-bold text-slate-800">{fmtEur(preview?.currentTotalEur)}</p>
          </div>
          <div>
            <span className="text-slate-500">Devis</span>
            <p className="font-bold text-slate-800">{fmtEur(preview?.proposedTotalEur)}</p>
          </div>
          <div>
            <span className="text-slate-500">Durée</span>
            <p className="font-bold text-slate-800">
              {preview?.remainingMonths != null ? `${preview.remainingMonths} mois` : "—"}
            </p>
          </div>
          <div>
            <span className="text-slate-500">Économie brute</span>
            <p className={`font-bold ${ready ? "text-emerald-700" : "text-slate-800"}`}>
              {fmtEur(preview?.grossSavingsEur)}
            </p>
          </div>
        </div>
      ) : (
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 text-[11px] mt-2 text-slate-600">
          Complète les champs manquants pour la saisie Kereis (effet J+3 mois, CRD à l&apos;effet, Lemoine
          par tête…). Les patches mettent à jour la fiche copiable.
        </div>
      )}

      {ready ? (
        <div className="mx-4 mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 font-bold">
          {mode === "kereis"
            ? "Fiche Kereis prête — copiez-la puis générez le devis."
            : "Ancrages prêts — vous pouvez cliquer sur « Générer étude depuis devis »."}
        </div>
      ) : null}
      {clarifying ? (
        <div className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 font-bold">
          STOP &amp; DEMANDER — une clarification est requise avant de figer un chiffre.
        </div>
      ) : null}

      <div className="max-h-80 overflow-y-auto px-4 py-3 space-y-2.5">
        {(assist?.messages || []).length === 0 && busy ? (
          <p className="text-sm text-slate-500 inline-flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Analyse des documents…
          </p>
        ) : null}
        {(assist?.messages || []).map((m, idx) => (
          <div
            key={`${m.at}-${idx}`}
            className={`text-sm whitespace-pre-wrap rounded-xl px-3 py-2 max-w-[95%] ${
              m.role === "user"
                ? "ml-auto bg-indigo-600 text-white"
                : "mr-auto bg-slate-100 text-slate-800 border border-slate-200"
            }`}
          >
            {m.role === "assistant" ? renderMdLite(m.content) : m.content}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {error ? <p className="px-4 text-xs text-red-600 font-bold">{error}</p> : null}

      <div className="p-3 border-t border-slate-100 flex gap-2">
        <input
          className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-400"
          placeholder={
            mode === "kereis"
              ? "Ex. Banque : Caisse d'Épargne · CRD 185000 · Fumeur Non"
              : ready
                ? "Ancrages OK — ou posez une question de contrôle…"
                : "Ex. 4426,94 ou 222 — ou décrivez l'ambiguïté"
          }
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || !input.trim()}
          className="bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 text-white px-3 py-2 rounded-xl font-bold text-sm inline-flex items-center gap-1.5"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Envoyer
        </button>
      </div>

      <p className="px-4 pb-3 text-[10px] text-slate-400 inline-flex items-center gap-1">
        <MessageSquare className="w-3 h-3" />
        Courtier ADE LCIF · jamais d&apos;invention · « reset » pour tout effacer
      </p>
    </div>
  );
}
