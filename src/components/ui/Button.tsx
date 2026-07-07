import React from "react";
import { cn } from "../../lib/utils";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export function Button({
  children,
  className,
  size = "md",
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: ButtonSize;
  variant?: ButtonVariant;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 font-bold rounded-2xl transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none";

  const sizeStyles: Record<ButtonSize, string> = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2.5 text-sm",
    lg: "px-6 py-3.5 text-[15px]",
  };

  const variantStyles: Record<ButtonVariant, string> = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-700",
    secondary: "bg-slate-900 text-white hover:bg-slate-800 focus:ring-slate-900",
    outline: "border border-slate-200 bg-white text-slate-900 hover:bg-slate-50 focus:ring-slate-900",
    ghost: "bg-transparent text-slate-700 hover:bg-slate-100 focus:ring-slate-900",
    danger: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-700",
  };

  return (
    <button
      className={cn(base, sizeStyles[size], variantStyles[variant], className)}
      {...props}
    >
      {children}
    </button>
  );
}
