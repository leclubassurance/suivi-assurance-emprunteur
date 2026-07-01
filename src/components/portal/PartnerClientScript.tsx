import React, { useMemo, useState } from "react";
import { Copy, MessageCircle } from "lucide-react";
import { buildWhatsAppMessage, TRANSPARENCY_SCRIPT, TRANSPARENCY_SCRIPT_HINT } from "../../../shared/apporteurPortalContent";
import { APPORTEUR_PROSPECTION_DISCLAIMER_SHORT } from "../../../shared/apporteurCompliance";

type Props = {
  referralLink: string;
  partnerContactName: string;
  onCopy: (text: string, label: string) => void;
};

export default function PartnerClientScript({ referralLink, partnerContactName, onCopy }: Props) {
  const [clientPrenom, setClientPrenom] = useState("");
  const [includeTransparency, setIncludeTransparency] = useState(false);

  const baseMessage = useMemo(
    () =>
      buildWhatsAppMessage({
        clientPrenom,
        referralLink,
        partnerContactName,
      }),
    [clientPrenom, referralLink, partnerContactName],
  );

  const message = useMemo(
    () => (includeTransparency ? `${baseMessage}\n\n${TRANSPARENCY_SCRIPT}` : baseMessage),
    [baseMessage, includeTransparency],
  );

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <h2 className="text-sm font-black uppercase tracking-wide text-slate-700 mb-1 flex items-center gap-2">
        <MessageCircle className="w-4 h-4 text-[#25D366]" /> Message WhatsApp à envoyer
      </h2>
      <p className="text-xs text-slate-500 mb-4">
        Personnalisez le prénom de votre contact, puis copiez le message tel quel dans WhatsApp ou par SMS.
      </p>

      <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-4 leading-relaxed">
        {APPORTEUR_PROSPECTION_DISCLAIMER_SHORT}
      </p>

      <label className="block text-xs font-bold text-slate-600 mb-3">
        Prénom du client
        <input
          type="text"
          placeholder="ex. Sophie"
          value={clientPrenom}
          onChange={(e) => setClientPrenom(e.target.value)}
          className="mt-1.5 w-full sm:max-w-xs border border-slate-200 rounded-lg px-3 py-2 text-sm font-normal"
        />
      </label>

      <label className="flex items-start gap-2 text-xs text-slate-600 mb-4 cursor-pointer">
        <input
          type="checkbox"
          checked={includeTransparency}
          onChange={(e) => setIncludeTransparency(e.target.checked)}
          className="mt-0.5 rounded border-slate-300"
        />
        <span>
          <span className="font-bold text-slate-700">Ajouter la phrase de transparence</span>
          <span className="block text-slate-500 font-normal mt-0.5">{TRANSPARENCY_SCRIPT_HINT}</span>
        </span>
      </label>

      <div className="bg-[#f0f2f5] rounded-xl p-4 mb-4 border border-slate-100">
        <p className="text-[10px] font-bold uppercase text-slate-400 mb-2">Aperçu</p>
        <pre className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap font-sans">{message}</pre>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onCopy(message, "Message WhatsApp copié !")}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#25D366] text-white text-xs font-bold hover:bg-[#1da851]"
        >
          <Copy className="w-3.5 h-3.5" /> Copier le message
        </button>
        <button
          type="button"
          onClick={() => onCopy(TRANSPARENCY_SCRIPT, "Phrase de transparence copiée !")}
          className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50"
          title={TRANSPARENCY_SCRIPT_HINT}
        >
          <Copy className="w-3.5 h-3.5" /> Copier uniquement la phrase
        </button>
      </div>
    </section>
  );
}
