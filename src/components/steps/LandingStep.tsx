import React from 'react';
import { ArrowRight, Euro, Scale, Search, CircleDollarSign, ShieldCheck, Quote } from 'lucide-react';

export default function LandingStep({ onStart, onAdminAccess }: { onStart: () => void, onAdminAccess: () => void }) {
  return (
    <div className="flex flex-col w-full px-4 py-8 mx-auto max-w-6xl gap-6 font-sans pb-28 md:pb-8">
      
      <header className="flex items-center gap-5 sm:gap-6 px-2 sm:px-4 py-5 mb-2 border-b border-slate-200/70">
        <img
          src="https://res.cloudinary.com/dji8akleo/image/upload/v1777112444/6_oqr0zi.png"
          alt="Le Club Immobilier Français"
          className="h-14 sm:h-[4.5rem] w-auto object-contain shrink-0"
          referrerPolicy="no-referrer"
        />
        <div className="min-w-0 border-l border-slate-200 pl-5 sm:pl-6">
          <p className="text-[10px] sm:text-[11px] uppercase tracking-[0.18em] text-slate-500 font-bold mb-1">
            Assurance emprunteur
          </p>
          <p className="text-base sm:text-lg font-bold text-[#1E3A8A] leading-tight">
            Le Club Immobilier Français
          </p>
          <p className="text-[12px] sm:text-[13px] text-slate-500 mt-1">
            Courtier indépendant · ORIAS 24002253
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        <div className="lg:col-span-7 bg-gradient-to-br from-[#1E3A8A] to-[#172554] text-white rounded-[32px] p-8 md:p-12 flex flex-col justify-between relative overflow-hidden shadow-xl">
          <div>
            <div className="text-[10px] sm:text-[11px] uppercase tracking-[0.2em] text-blue-200/80 font-bold mb-8 flex flex-wrap gap-x-2 gap-y-1">
              <span>ASSURANCE EMPRUNTEUR</span>
              <span className="text-blue-300/50 hidden sm:inline">·</span>
              <span>ANALYSE PERSONNALISÉE</span>
              <span className="text-blue-300/50 hidden sm:inline">·</span>
              <span>SANS ENGAGEMENT</span>
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6 leading-[1.05]">
              Réduisez le coût<br />de votre assurance<br />de prêt.
            </h1>
            <p className="text-blue-100 text-[15px] md:text-[16px] max-w-md leading-relaxed mb-4">
              Déposez vos documents en ligne. Nous analysons votre situation et vous présentons, par email, une solution à garanties équivalentes (ou supérieures), en toute transparence.
            </p>
            <p className="text-blue-200/90 text-[13px] max-w-md leading-relaxed">
              Après envoi, vous recevez un lien personnel pour suivre l&apos;avancement de votre dossier à tout moment.
            </p>
          </div>
          
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6 mt-8">
            <button 
              onClick={onStart}
              className="bg-white text-[#1E3A8A] hover:bg-blue-50 flex items-center justify-center gap-3 px-8 py-4 rounded-full font-bold text-[15px] transition-all shadow-sm"
            >
              Commencer mon étude <ArrowRight className="w-[18px] h-[18px]" strokeWidth={2.5} />
            </button>
            <span className="text-blue-200/80 text-[13px] font-medium tracking-wide flex items-center gap-2">
              Loi Lemoine <span className="text-blue-300/40">·</span> 100% en ligne
            </span>
          </div>
        </div>

        <div className="lg:col-span-5 bg-[#1B315A] text-white rounded-[32px] p-8 flex flex-col shadow-xl">
          <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.15em] text-blue-200 font-bold mb-6">
            <div className="w-6 h-6 rounded-full bg-blue-400/20 flex items-center justify-center">
              <Euro className="w-3.5 h-3.5" />
            </div>
            CAS CONCRET — UN DOSSIER RÉEL
          </div>
          
          <div className="mb-8 leading-snug">
            <span className="font-bold text-xl">Un couple,</span> <span className="text-blue-100 text-xl">prêt en cours.</span><br/>
            <span className="text-blue-100 text-[16px]">227 575 € empruntés sur 21,5 ans.</span>
          </div>

          <div className="flex gap-3 sm:gap-4 mb-6">
            <div className="flex-1 bg-white/5 rounded-[16px] p-4 text-[13px] border border-white/5">
              <div className="flex justify-between items-center mb-4">
                <span className="uppercase text-[10px] tracking-wider text-blue-200 flex-1 truncate pr-2 font-semibold">Assurance bancaire</span>
                <span className="bg-white/10 px-1.5 py-0.5 rounded-[4px] text-[10px] font-bold tracking-wide">AVANT</span>
              </div>
              <div className="mb-4">
                <div className="text-blue-200/80 text-[11px] mb-1">Cotisation mensuelle</div>
                <div className="font-medium"><span className="text-lg">78,82 €</span>/mois</div>
              </div>
              <div>
                <div className="text-blue-200/80 text-[10px] uppercase mb-1 tracking-wider">TOTAL RESTANT DÛ</div>
                <div className="font-medium text-blue-200/40 line-through">20 335 €</div>
              </div>
            </div>

            <div className="flex-1 bg-white/5 rounded-[16px] p-4 text-[13px] border border-[#3b82f6]/40 relative overflow-hidden shadow-[0_0_15px_rgba(59,130,246,0.1)]">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-400/10 to-transparent"></div>
              <div className="relative z-10">
                <div className="flex justify-between items-center mb-4">
                  <span className="uppercase text-[10px] tracking-wider text-blue-200 flex-1 truncate pr-2 font-semibold">Nouvelle assurance</span>
                  <span className="bg-[#3b82f6] text-white px-1.5 py-0.5 rounded-[4px] text-[10px] font-bold shadow-sm tracking-wide">APRÈS</span>
                </div>
                <div className="mb-4">
                  <div className="text-blue-200/80 text-[11px] mb-1">Cotisation mensuelle</div>
                  <div className="font-medium"><span className="text-lg">31,46 €</span>/mois</div>
                </div>
                <div>
                  <div className="text-blue-200/80 text-[10px] uppercase mb-1 tracking-wider">TOTAL RESTANT DÛ</div>
                  <div className="font-bold text-[15px]">8 116 €</div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-[20px] p-5 sm:p-6 mt-auto flex items-center justify-between shadow-lg">
            <div className="text-[#1E3A8A] text-[13px] font-medium leading-[1.4]">
              <div className="text-[#2563eb] font-bold text-[11px] uppercase tracking-wider mb-1.5 leading-tight">ÉCONOMIE<br/>IMMÉDIATE</div>
              <div className="mb-0.5"><strong className="text-[14px] text-slate-800">−47 €/mois</strong></div>
              <div className="text-slate-500 text-[12px]">dès la 1ère<br/>mensualité, soit :</div>
            </div>
            <div className="text-4xl sm:text-[44px] font-bold text-[#1E3A8A] tracking-tighter shrink-0 ml-4">
              12 218 <span className="text-2xl sm:text-3xl font-bold ml-0.5">€</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        
        <div className="md:col-span-4 bg-white border border-slate-200/60 rounded-[28px] p-8 flex flex-col justify-center shadow-sm">
          <div className="text-[11px] uppercase tracking-[0.15em] text-slate-500 font-bold mb-8">
            EN CHIFFRES
          </div>
          <div className="grid grid-cols-2 gap-y-8 gap-x-4">
            <div>
              <div className="text-[26px] font-bold text-[#111318] mb-1.5 tracking-tight">&lt; 5 min</div>
              <div className="text-slate-500 text-[13px] leading-snug">Pour déposer votre<br/>dossier</div>
            </div>
            <div>
              <div className="text-[26px] font-bold text-[#111318] mb-1.5 tracking-tight">100%</div>
              <div className="text-slate-500 text-[13px] leading-snug">Garanties conservées</div>
            </div>
            <div>
              <div className="text-[26px] font-bold text-[#111318] mb-1.5 tracking-tight">3</div>
              <div className="text-slate-500 text-[13px] leading-snug">Documents suffisants</div>
            </div>
            <div>
              <div className="text-[26px] font-bold text-[#111318] mb-1.5 tracking-tight">−50%</div>
              <div className="text-slate-500 text-[13px] leading-snug">Économie moyenne</div>
            </div>
          </div>
        </div>

        <div className="md:col-span-5 bg-white border border-slate-200/60 rounded-[28px] p-8 shadow-sm">
          <div className="text-[11px] uppercase tracking-[0.15em] text-slate-500 font-bold mb-8">
            COMMENT ÇA MARCHE
          </div>
          <div className="space-y-7">
            <div className="flex gap-5">
              <div className="w-9 h-9 rounded-full bg-[#eff6ff] flex items-center justify-center text-[13px] font-bold text-[#1E3A8A] shrink-0 mt-0.5">01</div>
              <div>
                <div className="font-bold text-[#111318] text-[15px] mb-1">Transmettez vos documents</div>
                <div className="text-slate-500 text-[14px]">Offre de prêt et tableau d&apos;amortissement en PDF.</div>
              </div>
            </div>
            <div className="flex gap-5">
              <div className="w-9 h-9 rounded-full bg-[#eff6ff] flex items-center justify-center text-[13px] font-bold text-[#1E3A8A] shrink-0 mt-0.5">02</div>
              <div>
                <div className="font-bold text-[#111318] text-[15px] mb-1">Renseignez vos coordonnées</div>
                <div className="text-slate-500 text-[14px]">Informations personnelles et professionnelles.</div>
              </div>
            </div>
            <div className="flex gap-5">
              <div className="w-9 h-9 rounded-full bg-[#eff6ff] flex items-center justify-center text-[13px] font-bold text-[#1E3A8A] shrink-0 mt-0.5">03</div>
              <div>
                <div className="font-bold text-[#111318] text-[15px] mb-1">Charles Victor analyse votre dossier</div>
                <div className="text-slate-500 text-[14px]">Étude personnalisée par email sous 48h ouvrées.</div>
              </div>
            </div>
          </div>
        </div>

        <div className="md:col-span-3 bg-[#2A3547] text-white rounded-[28px] p-8 flex flex-col justify-between relative overflow-hidden shadow-md">
          <div className="w-48 h-48 bg-[#334155] rounded-full absolute -top-12 -right-12 opacity-50 blur-2xl pointer-events-none"></div>
          <div className="w-[42px] h-[42px] rounded-full border-[1.5px] border-white/20 flex items-center justify-center relative z-10">
            <Scale className="w-5 h-5 text-slate-200" />
          </div>
          <div className="relative z-10 mt-16">
            <div className="text-[10px] uppercase tracking-[0.15em] text-slate-400 font-bold mb-4">
              ÉTHIQUE & TRANSPARENCE
            </div>
            <div className="text-[22px] md:text-[24px] font-bold leading-[1.2] tracking-tight">
              Zéro engagement<br/>Zéro frais cachés
            </div>
          </div>
        </div>
        
      </div>

      <div className="bg-white border border-slate-200/60 rounded-[28px] p-8 md:p-10 shadow-sm">
        <div className="text-[11px] uppercase tracking-[0.15em] text-slate-500 font-bold mb-8">
          POURQUOI PASSER PAR LE CLUB ?
        </div>
        
        <div className="bg-[#F8FAFC] border border-[#e2e8f0]/60 p-6 md:p-8 rounded-[24px] mb-10 flex gap-4 md:gap-6 items-start">
          <Quote className="w-10 h-10 text-blue-200 fill-blue-100 shrink-0" />
          <p className="text-[15px] md:text-[16px] text-slate-600 font-medium leading-[1.7] mt-1.5">
            &quot;Notre cœur de métier, c&apos;est la transaction immobilière. En accompagnant nos clients sur leurs achats, nous avons réalisé que l&apos;assurance emprunteur représentait souvent des milliers d&apos;euros d&apos;économies laissés sur la table. On a décidé d&apos;y remédier.&quot;
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-8">
          <div>
            <div className="w-10 h-10 rounded-full border border-blue-100 flex items-center justify-center text-[#1E3A8A] mb-5 bg-[#eff6ff]">
              <Search className="w-4 h-4" strokeWidth={2.5} />
            </div>
            <h3 className="font-bold text-[#111318] text-[16px] mb-3 leading-snug">Accès aux meilleurs assureurs du marché</h3>
            <p className="text-slate-500 text-[14px] leading-relaxed">
              Nous comparons pour vous les offres des principaux acteurs du marché et retenons uniquement celle qui correspond le mieux à votre profil.
            </p>
          </div>
          <div>
            <div className="w-10 h-10 rounded-full border border-blue-100 flex items-center justify-center text-[#1E3A8A] mb-5 bg-[#eff6ff]">
              <CircleDollarSign className="w-4 h-4" strokeWidth={2.5} />
            </div>
            <h3 className="font-bold text-[#111318] text-[16px] mb-3 leading-snug">Rémunérés uniquement sur vos économies</h3>
            <p className="text-slate-500 text-[14px] leading-relaxed">
              Notre intérêt est aligné sur le vôtre — nous ne sommes rémunérés que si vous économisez réellement. Aucun frais caché, aucun engagement.
            </p>
          </div>
          <div>
            <div className="w-10 h-10 rounded-full border border-blue-100 flex items-center justify-center text-[#1E3A8A] mb-5 bg-[#eff6ff]">
              <ShieldCheck className="w-4 h-4" strokeWidth={2.5} />
            </div>
            <h3 className="font-bold text-[#111318] text-[16px] mb-3 leading-snug">Garanties équivalentes ou meilleures</h3>
            <p className="text-slate-500 text-[14px] leading-relaxed">
              Vous ne perdez rien. La loi Lemoine vous permet de changer à tout moment en conservant — voire en améliorant — votre niveau de couverture.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200/60 rounded-[28px] p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm">
        <div className="pl-2">
          <div className="font-bold text-[#111318] text-[15px] md:text-[16px] mb-1 leading-snug">
            Des centaines de dossiers d&apos;assurance emprunteur accompagnés
          </div>
          <div className="text-slate-500 text-[14px] leading-relaxed">
            Rejoignez nos clients qui ont optimisé leur assurance de prêt.
          </div>
        </div>
        <button 
          onClick={onStart}
          className="bg-[#1E3A8A] text-white hover:bg-[#172554] flex items-center justify-center gap-3 px-8 py-4 rounded-full font-bold text-[15px] transition-all shadow-sm whitespace-nowrap w-full md:w-auto"
        >
          Déposer mon dossier <ArrowRight className="w-[18px] h-[18px]" strokeWidth={2.5} />
        </button>
      </div>

      <footer className="text-center pb-8 pt-4 flex flex-col items-center gap-3">
        <div className="flex items-center gap-4 text-[13px] font-bold text-slate-400">
          <button type="button" className="hover:text-slate-600 transition-colors">Mentions légales</button>
          <span>·</span>
          <button type="button" className="hover:text-slate-600 transition-colors">Confidentialité</button>
          <span>·</span>
          <button type="button" onDoubleClick={onAdminAccess} className="hover:text-slate-600 transition-colors opacity-30 hover:opacity-100" title="Double‑clic">Admin</button>
        </div>
        <p className="text-slate-500 text-[12px] font-medium">
          Le Club Immobilier Français — 17 Passage Leroy, 44000 Nantes · ORIAS 24002253
        </p>
        <p className="text-slate-400 text-[12px]">© {new Date().getFullYear()} Le Club Immobilier Français.</p>
        <p className="text-slate-400 text-[11px] max-w-lg mx-auto leading-relaxed px-4">
          RGPD : ce site utilise la mémoire locale de votre navigateur pour conserver temporairement votre brouillon. Vos données ne sont transmises qu&apos;à la validation finale.
        </p>
      </footer>

      <div className="md:hidden fixed bottom-0 left-0 right-0 p-4 bg-white/95 backdrop-blur border-t border-slate-200 z-50">
        <button
          type="button"
          onClick={onStart}
          className="w-full bg-[#1E3A8A] text-white py-4 rounded-2xl font-bold text-[15px] flex items-center justify-center gap-2 shadow-lg"
        >
          Commencer mon étude <ArrowRight className="w-5 h-5" />
        </button>
      </div>

    </div>
  );
}
