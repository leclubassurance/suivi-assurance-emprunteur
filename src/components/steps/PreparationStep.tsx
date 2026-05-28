import React from 'react';
import { motion } from 'motion/react';
import { ArrowRight, FileText, CheckCircle2 } from 'lucide-react';
import { showToast } from '../../lib/toast';
import { getApiUrl } from '../../lib/utils';

export default function PreparationStep({ onNext }: { onNext: () => void }) {
  const [isChecked, setIsChecked] = React.useState(false);
  const [helpEmail, setHelpEmail] = React.useState("");
  const [helpPrenom, setHelpPrenom] = React.useState("");
  const [helpMsg, setHelpMsg] = React.useState("");
  const [helpSending, setHelpSending] = React.useState(false);

  const sendHelp = async () => {
    if (helpSending) return;
    const email = helpEmail.trim();
    const message = helpMsg.trim();
    if (!email.includes("@")) {
      showToast("Merci d’indiquer une adresse email valide.", "error");
      return;
    }
    if (message.length < 3) {
      showToast("Merci d’écrire votre question.", "error");
      return;
    }
    try {
      setHelpSending(true);
      showToast("Message envoyé. Camille vous répond par email.", "info");
      const res = await fetch(getApiUrl("/api/public/help"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, prenom: helpPrenom.trim(), message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || "Impossible d’envoyer le message.", "error");
        return;
      }
      showToast(`C’est noté. Référence : ${data.ref}.`, "success");
      setHelpMsg("");
    } catch {
      showToast("Erreur réseau. Réessayez.", "error");
    } finally {
      setHelpSending(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 gap-6 pb-20 flex-1 flex flex-col justify-center">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-8"
      >
        <div className="text-[11px] uppercase tracking-[0.15em] text-slate-500 font-bold mb-3">
          Prérequis
        </div>
        <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-[#111318] mb-4">Avant de commencer...</h2>
        <p className="text-slate-500 text-[15px] font-medium max-w-lg mx-auto">Veuillez rassembler les documents suivants pour une analyse de votre dossier. Vous pourrez les déposer à la fin du formulaire.</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="bg-white border border-slate-200/60 rounded-[24px] shadow-sm flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-slate-100 overflow-hidden mb-8">
          <div className="flex-1 p-8 text-center flex flex-col items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center mb-5">
              <FileText className="w-8 h-8 text-[#2563eb]" />
            </div>
            <h3 className="font-bold text-[#111318] text-[17px] mb-2 leading-snug">L'offre de prêt</h3>
            <p className="text-slate-500 text-[14px]">Document détaillé remis par votre banque lors de l'octroi du crédit.</p>
          </div>
          
          <div className="flex-1 p-8 text-center flex flex-col items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center mb-5">
              <FileText className="w-8 h-8 text-[#2563eb]" />
            </div>
            <h3 className="font-bold text-[#111318] text-[17px] mb-2 leading-snug">Tableau d'amortissement</h3>
            <p className="text-slate-500 text-[14px]">L'échéancier complet, détaillé jusqu'à la dernière échéance du prêt.</p>
          </div>

          <div className="flex-1 p-8 text-center flex flex-col items-center justify-center bg-slate-50">
            <div className="w-16 h-16 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center mb-5">
              <CheckCircle2 className="w-8 h-8 text-[#2563eb]" />
            </div>
            <h3 className="font-bold text-[#111318] text-[17px] mb-2 leading-snug">C'est tout !</h3>
            <p className="text-slate-500 text-[14px]">Vous pourrez les prendre en photo ou les importer en PDF à la dernière étape.</p>
          </div>
        </div>

        <div className="bg-white border border-slate-200/60 rounded-[24px] shadow-sm p-6 md:p-8 mb-8">
          <div className="text-[11px] uppercase tracking-[0.15em] text-slate-500 font-bold mb-3">
            Besoin d’aide ?
          </div>
          <h3 className="text-xl font-black text-[#111318] mb-2">Camille peut vous accompagner</h3>
          <p className="text-slate-500 text-[14px] leading-relaxed font-medium mb-6">
            Si vous ne trouvez pas vos documents (offre de prêt / échéancier), envoyez un message : Camille vous répond par email avec les étapes selon votre banque (appli bancaire, espace client, ou demande à votre conseiller).
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Email</label>
              <input
                value={helpEmail}
                onChange={(e) => setHelpEmail(e.target.value)}
                placeholder="votre.email@example.com"
                className="mt-1 w-full border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Prénom (optionnel)</label>
              <input
                value={helpPrenom}
                onChange={(e) => setHelpPrenom(e.target.value)}
                placeholder="Prénom"
                className="mt-1 w-full border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-bold text-slate-600 uppercase tracking-wide">Votre question</label>
              <textarea
                value={helpMsg}
                onChange={(e) => setHelpMsg(e.target.value)}
                placeholder="Ex : Je ne trouve pas le tableau d’amortissement sur mon application bancaire…"
                className="mt-1 w-full border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-200 min-h-[110px]"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-col sm:flex-row gap-3 items-center">
            <button
              type="button"
              onClick={sendHelp}
              disabled={helpSending}
              className={`px-6 py-3 rounded-xl font-bold text-sm transition-all w-full sm:w-auto ${
                helpSending ? "bg-slate-200 text-slate-500 cursor-not-allowed" : "bg-[#111318] text-white hover:bg-slate-800"
              }`}
            >
              {helpSending ? "Envoi en cours..." : "Envoyer à Camille"}
            </button>
            <div className="text-xs text-slate-500 font-medium">
              Vous recevrez la réponse sur l’email indiqué.
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center gap-6">
          <label className="flex items-center gap-3 cursor-pointer group bg-white border border-slate-200 rounded-2xl p-4 max-w-lg w-full shadow-sm hover:border-slate-300 transition-all select-none">
            <input 
              type="checkbox" 
              checked={isChecked}
              onChange={(e) => setIsChecked(e.target.checked)}
              className="w-5 h-5 rounded text-indigo-600 border-slate-300 focus:ring-indigo-500 transition-all cursor-pointer"
            />
            <span className="text-slate-600 text-xs sm:text-[13px] font-medium leading-relaxed">
              Je confirme avoir en ma possession <strong>l'offre de prêt</strong> <strong>et</strong> le <strong>tableau d'amortissement</strong> pour finaliser ma demande d'étude.
            </span>
          </label>

          <button 
            disabled={!isChecked}
            onClick={onNext}
            className={`flex items-center justify-center gap-3 px-8 py-4 rounded-full font-bold text-[15px] transition-all shadow-sm w-full md:w-auto min-w-[280px] ${
              isChecked 
                ? "bg-[#111318] text-white hover:bg-slate-800 cursor-pointer" 
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            J'ai mes documents, on commence <ArrowRight className="w-[18px] h-[18px]" strokeWidth={2.5} />
          </button>
        </div>
      </motion.div>
    </div>
  );
}
