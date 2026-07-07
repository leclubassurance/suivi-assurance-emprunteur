import React from "react";
import { cn } from "../../lib/utils";

export function Select({
  label,
  error,
  options,
  className,
  id,
  placeholder = "Sélectionnez…",
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  error?: string;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
}) {
  const selectId = id || (label ? `select-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return (
    <div className={cn("flex flex-col space-y-1.5", className)}>
      {label ? (
        <label htmlFor={selectId} className="text-[13px] font-bold text-slate-700">
          {label}
        </label>
      ) : null}
      <select
        id={selectId}
        className={cn(
          "bento-input",
          error ? "border-red-300 ring-1 ring-red-100 bg-red-50" : "bg-white hover:border-slate-300",
        )}
        aria-label={label || "Sélection"}
        aria-invalid={Boolean(error) || undefined}
        {...props}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options?.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error ? <span className="text-[12px] text-red-500 font-medium">{error}</span> : null}
    </div>
  );
}

