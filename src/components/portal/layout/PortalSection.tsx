import React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../../lib/utils";

const PortalSection = React.forwardRef<
  HTMLElement,
  {
    id?: string;
    icon?: LucideIcon;
    title: string;
    description?: string;
    children: React.ReactNode;
    className?: string;
    action?: React.ReactNode;
  }
>(function PortalSection(
  { id, icon: Icon, title, description, children, className, action },
  ref,
) {
  return (
    <section
      ref={ref}
      id={id}
      className={cn("scroll-mt-24 lg:scroll-mt-28 lcif-card overflow-hidden", className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 bg-slate-50/60">
        <div className="flex items-start gap-3 min-w-0">
          {Icon ? (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white border border-slate-200 text-indigo-700 shadow-sm">
              <Icon className="h-5 w-5" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 className="lcif-section-title">{title}</h2>
            {description ? <p className="lcif-help mt-1 max-w-2xl">{description}</p> : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
});

export default PortalSection;
