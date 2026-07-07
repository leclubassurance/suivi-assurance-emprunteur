import React, { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  GraduationCap,
  HelpCircle,
  Home,
  LayoutGrid,
  MessageSquare,
  Route,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { cn } from "../../../lib/utils";

export type PortalNavItem = {
  id: string;
  label: string;
  shortLabel?: string;
  icon: LucideIcon;
  visible?: boolean;
  /** Affiché dans la barre fixe mobile (max 4 + Menu). */
  mobilePrimary?: boolean;
};

export const PORTAL_NAV_ICONS = {
  home: Home,
  phase: Route,
  formation: GraduationCap,
  contract: BookOpen,
  benefits: LayoutGrid,
  script: MessageSquare,
  journey: Route,
  earnings: TrendingUp,
  recruit: UserPlus,
  team: Users,
  referrals: Users,
  guide: HelpCircle,
} as const;

type Props = {
  items: PortalNavItem[];
  activeId: string | null;
  onJump: (id: string) => void;
  variant: "sidebar" | "mobile";
};

function visibleItems(items: PortalNavItem[]) {
  return items.filter((i) => i.visible !== false);
}

function NavButton({
  item,
  active,
  onClick,
  compact,
}: {
  item: PortalNavItem;
  active: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  const Icon = item.icon;
  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex flex-col items-center justify-center gap-1 py-2 px-1 min-w-0 flex-1",
          active ? "text-indigo-700" : "text-slate-500",
        )}
      >
        <span
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-xl transition-colors",
            active ? "bg-indigo-100 text-indigo-800" : "bg-transparent",
          )}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <span className="text-[10px] font-bold leading-tight text-center truncate w-full px-0.5">
          {item.shortLabel || item.label}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition-colors",
        active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50 border border-transparent hover:border-slate-200",
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", active ? "text-white" : "text-slate-400")} />
      <span className="truncate">{item.label}</span>
    </button>
  );
}

export function PortalSidebarNav({ items, activeId, onJump }: Omit<Props, "variant">) {
  const visible = visibleItems(items);
  if (visible.length <= 1) return null;

  return (
    <nav className="space-y-1">
      {visible.map((item) => (
        <NavButton
          key={item.id}
          item={item}
          active={activeId === item.id}
          onClick={() => onJump(item.id)}
        />
      ))}
    </nav>
  );
}

export function PortalMobileNav({ items, activeId, onJump }: Omit<Props, "variant">) {
  const [menuOpen, setMenuOpen] = useState(false);
  const visible = visibleItems(items);
  if (visible.length <= 1) return null;

  const primary = visible.filter((i) => i.mobilePrimary).slice(0, 4);
  const secondary = visible.filter((i) => !primary.some((p) => p.id === i.id));

  const handleJump = (id: string) => {
    setMenuOpen(false);
    onJump(id);
  };

  return (
    <>
      {menuOpen ? (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
            aria-label="Fermer le menu"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[70dvh] rounded-t-3xl bg-white border-t border-slate-200 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <p className="text-sm font-black text-slate-900">Toutes les sections</p>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="h-9 w-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-600"
                aria-label="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-4 grid grid-cols-2 gap-2">
              {visible.map((item) => {
                const Icon = item.icon;
                const active = activeId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleJump(item.id)}
                    className={cn(
                      "flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-colors",
                      active
                        ? "border-indigo-200 bg-indigo-50 text-indigo-900"
                        : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50",
                    )}
                  >
                    <Icon className={cn("h-5 w-5", active ? "text-indigo-700" : "text-slate-400")} />
                    <span className="text-xs font-black leading-snug">{item.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="h-[env(safe-area-inset-bottom)]" />
          </div>
        </div>
      ) : null}

      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-50 border-t border-slate-200/80 bg-white/95 backdrop-blur-md shadow-[0_-8px_30px_rgba(15,23,42,0.08)]"
        aria-label="Navigation principale"
      >
        <div className="flex items-stretch px-1 pt-1">
          {primary.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={activeId === item.id}
              onClick={() => handleJump(item.id)}
              compact
            />
          ))}
          {secondary.length > 0 ? (
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className={cn(
                "flex flex-col items-center justify-center gap-1 py-2 px-1 min-w-0 flex-1",
                menuOpen ? "text-indigo-700" : "text-slate-500",
              )}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                <LayoutGrid className="h-[18px] w-[18px]" />
              </span>
              <span className="text-[10px] font-bold">Menu</span>
            </button>
          ) : null}
        </div>
        <div className="h-[env(safe-area-inset-bottom)]" />
      </nav>
    </>
  );
}
