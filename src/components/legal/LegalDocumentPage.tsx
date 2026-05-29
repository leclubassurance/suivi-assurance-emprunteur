import React from "react";
import { ArrowLeft } from "lucide-react";
import type { LegalDocument, LegalBlock } from "../../content/legalTypes";

function Block({ block }: { block: LegalBlock }) {
  if (block.type === "p") {
    return <p className="text-[14px] leading-relaxed text-slate-600">{block.text}</p>;
  }
  if (block.type === "ul") {
    return (
      <ul className="list-disc pl-5 space-y-2 text-[14px] leading-relaxed text-slate-600">
        {block.items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    );
  }
  return (
    <ol className="list-decimal pl-5 space-y-2 text-[14px] leading-relaxed text-slate-600">
      {block.items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ol>
  );
}

export default function LegalDocumentPage({
  document,
  onBack,
}: {
  document: LegalDocument;
  onBack: () => void;
}) {
  return (
    <div className="min-h-[100dvh] bg-[#F8FAFC] font-sans">
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200/80">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-2 text-[13px] font-semibold text-slate-600 hover:text-[#1E3A8A] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Retour
          </button>
          <img
            src="https://res.cloudinary.com/dji8akleo/image/upload/v1777112444/6_oqr0zi.png"
            alt="Le Club Immobilier Français"
            className="h-9 w-auto object-contain"
            referrerPolicy="no-referrer"
          />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10 pb-16">
        <p className="text-[11px] uppercase tracking-[0.16em] font-bold text-slate-400 mb-2">
          {document.subtitle}
        </p>
        <h1 className="text-3xl font-bold text-[#1E3A8A] tracking-tight mb-3">{document.title}</h1>
        <p className="text-[12px] text-slate-400 mb-6">Dernière mise à jour : {document.lastUpdated}</p>

        <div className="rounded-2xl border border-amber-200/80 bg-amber-50/80 px-4 py-3 mb-8">
          <p className="text-[13px] leading-relaxed text-amber-950/90">{document.disclaimer}</p>
        </div>

        <div className="space-y-10">
          {document.sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-24">
              <h2 className="text-lg font-bold text-slate-900 mb-4">{section.title}</h2>
              <div className="space-y-4">
                {section.blocks.map((block, i) => (
                  <Block key={i} block={block} />
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-12 pt-8 border-t border-slate-200 flex flex-wrap gap-4 text-[13px] font-semibold text-slate-500">
          <button type="button" onClick={onBack} className="hover:text-[#1E3A8A]">
            ← Retour à l&apos;accueil
          </button>
        </div>
      </main>
    </div>
  );
}
