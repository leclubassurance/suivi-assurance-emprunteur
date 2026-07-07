import React from "react";
import { cn } from "../../lib/utils";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  const styles: Record<BadgeVariant, string> = {
    default: "bg-slate-100 text-slate-700 border-slate-200",
    success: "bg-emerald-50 text-emerald-800 border-emerald-100",
    warning: "bg-amber-50 text-amber-800 border-amber-100",
    danger: "bg-red-50 text-red-800 border-red-100",
    info: "bg-indigo-50 text-indigo-800 border-indigo-100",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center border px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide",
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}

