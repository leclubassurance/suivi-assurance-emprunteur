import React from "react";
import { cn } from "../../lib/utils";

export type TabItem<T extends string> = {
  key: T;
  label: string;
  count?: number;
  disabled?: boolean;
};

export function Tabs<T extends string>({
  value,
  items,
  onChange,
  className,
}: {
  value: T;
  items: Array<TabItem<T>>;
  onChange: (next: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex rounded-2xl border border-slate-200 bg-white p-1 gap-1", className)}>
      {items.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            disabled={item.disabled}
            onClick={() => onChange(item.key)}
            className={cn(
              "px-3 py-1.5 rounded-xl text-xs font-black transition",
              active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50",
              item.disabled ? "opacity-40 pointer-events-none" : "",
            )}
          >
            {item.label}
            {typeof item.count === "number" ? (
              <span className={cn("ml-2 text-[11px] font-black", active ? "text-white/85" : "text-slate-400")}>
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

