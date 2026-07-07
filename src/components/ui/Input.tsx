import React from "react";
import { cn } from "../../lib/utils";

export function Input({
  label,
  error,
  className,
  id,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string;
}) {
  const inputId = id || (label ? `input-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return (
    <div className={cn("flex flex-col space-y-1.5", className)}>
      {label ? (
        <label htmlFor={inputId} className="text-[13px] font-bold text-slate-700">
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        className={cn(
          "bento-input",
          error ? "border-red-300 ring-1 ring-red-100 bg-red-50" : "bg-white hover:border-slate-300",
        )}
        aria-invalid={Boolean(error) || undefined}
        {...props}
      />
      {error ? <span className="text-[12px] text-red-500 font-medium">{error}</span> : null}
    </div>
  );
}

