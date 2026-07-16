import React from "react";
import { UserRound } from "lucide-react";

export type LandingReferralProfile = {
  contactName: string;
  companyName?: string | null;
  profile: {
    photoUrl?: string;
    title?: string;
    bio?: string;
  };
};

export default function LandingReferralBanner({ data }: { data: LandingReferralProfile }) {
  const { contactName, companyName, profile } = data;
  return (
    <section
      aria-label="Conseiller qui vous recommande"
      className="w-full max-w-6xl mx-auto px-4 sm:px-6 -mt-2 mb-6 sm:mb-8"
    >
      <div className="rounded-2xl border border-blue-100 bg-white/90 shadow-sm px-4 py-3.5 sm:px-5 sm:py-4 flex gap-3.5 items-start">
        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full overflow-hidden bg-slate-100 border border-slate-200 shrink-0 flex items-center justify-center">
          {profile.photoUrl ? (
            <img
              src={profile.photoUrl}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <UserRound className="w-7 h-7 text-slate-300" aria-hidden />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#1E3A8A]/80">
            Recommandé par
          </p>
          <p className="font-bold text-slate-900 text-[15px] sm:text-base leading-tight">{contactName}</p>
          {profile.title ? (
            <p className="text-sm text-slate-600 mt-0.5">{profile.title}</p>
          ) : companyName ? (
            <p className="text-sm text-slate-600 mt-0.5">{companyName}</p>
          ) : null}
          {profile.bio ? (
            <p className="text-sm text-slate-600 mt-1.5 leading-snug">{profile.bio}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
