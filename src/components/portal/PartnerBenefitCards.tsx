import React from "react";
import { getBenefitCards } from "../../../shared/apporteurPortalContent";

export default function PartnerBenefitCards({ payoutPerSignatureEur }: { payoutPerSignatureEur: number }) {
  const cards = getBenefitCards(payoutPerSignatureEur);

  return (
    <section className="grid sm:grid-cols-3 gap-3">
      {cards.map((card) => (
        <div
          key={card.key}
          className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm hover:border-indigo-100 transition-colors"
        >
          <div className="text-2xl mb-2" aria-hidden>
            {card.emoji}
          </div>
          <h3 className="text-sm font-black text-slate-900 mb-2">{card.title}</h3>
          <ul className="space-y-1">
            {card.lines.map((line) => (
              <li key={line} className="text-xs text-slate-600 leading-snug flex gap-1.5">
                <span className="text-emerald-500 shrink-0">✓</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
