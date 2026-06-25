import React, { useEffect } from "react";
import { X, MapPin, HelpCircle } from "lucide-react";
import {
  DOCUMENT_EXAMPLES,
  type DocumentExampleId,
} from "../../content/documentExamples";

export default function DocumentExampleModal({
  exampleId,
  onClose,
}: {
  exampleId: DocumentExampleId | null;
  onClose: () => void;
}) {
  const example = exampleId ? DOCUMENT_EXAMPLES[exampleId] : null;

  useEffect(() => {
    if (!example) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [example, onClose]);

  if (!example) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="document-example-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Fermer"
      />
      <div className="relative w-full sm:max-w-2xl max-h-[92vh] sm:max-h-[88vh] bg-white rounded-t-[24px] sm:rounded-[24px] shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-5 sm:px-6 pt-5 pb-3 border-b border-slate-100 shrink-0">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.15em] text-slate-400 font-bold mb-1">
              Exemple de document
              {example.optional ? " · optionnel" : ""}
            </p>
            <h2 id="document-example-title" className="font-bold text-[#111318] text-lg leading-snug">
              {example.title}
            </h2>
            <p className="text-slate-500 text-[13px] mt-1">{example.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition shrink-0"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 sm:px-6 py-4 space-y-4">
          <div className="rounded-[16px] border border-slate-200 bg-slate-50 overflow-hidden">
            <img
              src={example.imageSrc}
              alt={example.imageAlt}
              className="w-full h-auto block"
              loading="lazy"
            />
            <p className="text-[11px] text-slate-400 text-center py-2 px-3 border-t border-slate-200/80">
              Exemple pédagogique — document fictif, à titre indicatif uniquement.
            </p>
          </div>

          <div className="bg-[#eff6ff] border border-blue-100 rounded-[16px] p-4">
            <div className="flex items-center gap-2 text-[#1E3A8A] font-bold text-[13px] mb-2">
              <HelpCircle className="w-4 h-4 shrink-0" />
              Pourquoi nous en avons besoin
            </div>
            <p className="text-slate-600 text-[14px] leading-relaxed">{example.why}</p>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-[16px] p-4">
            <div className="flex items-center gap-2 text-slate-800 font-bold text-[13px] mb-2">
              <MapPin className="w-4 h-4 shrink-0 text-slate-500" />
              Où le trouver
            </div>
            <p className="text-slate-600 text-[14px] leading-relaxed">{example.where}</p>
            {example.tips ? (
              <p className="text-slate-500 text-[13px] leading-relaxed mt-2">{example.tips}</p>
            ) : null}
          </div>
        </div>

        <div className="px-5 sm:px-6 py-4 border-t border-slate-100 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto sm:min-w-[200px] bg-[#1E3A8A] hover:bg-[#172554] text-white font-bold text-[14px] py-3.5 px-6 rounded-full transition-colors"
          >
            J&apos;ai compris
          </button>
        </div>
      </div>
    </div>
  );
}

export function DocumentExampleLink({
  exampleId,
  onOpen,
  className = "",
}: {
  exampleId: DocumentExampleId;
  onOpen: (id: DocumentExampleId) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(exampleId)}
      className={`inline-flex items-center gap-1.5 text-[13px] font-bold text-[#1E3A8A] hover:text-[#172554] underline underline-offset-2 decoration-[#1E3A8A]/30 hover:decoration-[#1E3A8A] transition-colors ${className}`}
    >
      Voir un exemple
    </button>
  );
}
