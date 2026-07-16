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
    <section aria-label="Conseiller qui vous recommande" className="w-full px-1 sm:px-0">
      <div className="flex gap-3.5 sm:gap-4 items-start max-w-xl lg:max-w-[28rem] rounded-2xl border border-blue-100/80 bg-white px-3.5 py-3 sm:px-4 sm:py-3.5 shadow-sm">
        <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full overflow-hidden bg-slate-100 border border-slate-200 shrink-0 flex items-center justify-center">
          {profile.photoUrl ? (
            <img
              src={profile.photoUrl}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <UserRound className="w-6 h-6 text-slate-300" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.14em] text-[#1E3A8A]/75">
            Recommandé par
          </p>
          <p className="font-bold text-slate-900 text-[14px] sm:text-[15px] leading-tight mt-0.5">
            {contactName}
          </p>
          {profile.title ? (
            <p className="text-[12px] sm:text-[13px] text-slate-500 mt-0.5">{profile.title}</p>
          ) : companyName ? (
            <p className="text-[12px] sm:text-[13px] text-slate-500 mt-0.5">{companyName}</p>
          ) : null}
          {profile.bio ? (
            <p className="text-[13px] sm:text-[13.5px] text-slate-600 mt-1.5 leading-snug">
              {profile.bio}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
