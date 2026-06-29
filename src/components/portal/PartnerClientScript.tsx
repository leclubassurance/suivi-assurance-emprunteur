import React, { useMemo, useState } from "react";
import { Copy, MessageCircle } from "lucide-react";
import { buildWhatsAppMessage, TRANSPARENCY_SCRIPT } from "../../../shared/apporteurPortalContent";

type Props = {
  referralLink: string;
  partnerContactName: string;
  onCopy: (text: string, label: string) => void;
};

export default function PartnerClientScript({ referralLink, partnerContactName, onCopy }: Props) {
  const [clientPrenom, setClientPrenom] = useState("");

  const message = useMemo(
    () =>
      buildWhatsAppMessage({
        clientPrenom,
        referralLink,
        partnerContactName,
      }),
    [clientPrenom, referralLink, partnerContactName],
  );

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <h2 className="text-sm font-black uppercase tracking-wide text-slate-700 mb-1 flex items-center gap-2">
        <MessageCircle className="w-4 h-4 text-[#25D366]" /> Message WhatsApp à envoyer
      </h2>
      <p className="text-xs text-slate-500 mb-4">
        Personnalisez le prénom de votre contact, puis copiez le message tel quel dans WhatsApp ou par SMS.
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
          onClick={() => onCopy(TRANSPARENCY_SCRIPT, "Phrase transparence copiée !")}
          className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50"
        >
          <Copy className="w-3.5 h-3.5" /> Phrase transparence (optionnel)
        </button>
      </div>
    </section>
  );
}
