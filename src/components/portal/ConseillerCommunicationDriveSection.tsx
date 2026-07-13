import React from "react";
import { ExternalLink, Megaphone } from "lucide-react";
import { CONSEILLER_COMMUNICATION_DRIVE_URL } from "../../../shared/conseillerImmoClub";

type Props = {
  variant?: "section" | "card";
};

export default function ConseillerCommunicationDriveSection({ variant = "section" }: Props) {
  if (variant === "card") {
    return (
      <a
        href={CONSEILLER_COMMUNICATION_DRIVE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="lcif-card p-4 text-left hover:border-sky-200 hover:shadow-md transition-all group block sm:col-span-2"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-700 mb-3 group-hover:bg-sky-100">
          <Megaphone className="h-5 w-5" />
        </span>
        <p className="text-sm font-black text-slate-900 flex items-center gap-1.5">
          Kit communication
          <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
        </p>
        <p className="text-xs text-slate-500 mt-1">
          Visuels, posts réseaux sociaux et modèles LCIF sur Google Drive
        </p>
      </a>
    );
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
      <div className="bg-gradient-to-r from-sky-950 via-sky-900 to-indigo-900 px-5 py-5 sm:px-6 text-white">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
            <Megaphone className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-black tracking-tight">Kit communication</h2>
            <p className="text-sm text-sky-100/90 mt-1 leading-relaxed max-w-xl">
              Accédez aux visuels, textes et supports pour vos réseaux sociaux, newsletters et
              communications clients — mis à disposition par LCIF.
            </p>
          </div>
        </div>
      </div>
      <div className="p-4 sm:p-5">
        <a
          href={CONSEILLER_COMMUNICATION_DRIVE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 w-full sm:w-auto rounded-xl bg-[#1E3A8A] hover:bg-indigo-900 text-white font-bold text-sm px-5 py-3 transition-colors shadow-sm"
        >
          <ExternalLink className="w-4 h-4" />
          Ouvrir le dossier Drive
        </a>
        <p className="text-xs text-slate-500 mt-3 leading-relaxed">
          Le lien s&apos;ouvre dans un nouvel onglet. Contactez LCIF si vous n&apos;avez pas les
          droits d&apos;accès.
        </p>
      </div>
    </section>
  );
}
