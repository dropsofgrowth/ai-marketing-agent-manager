import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export const inputClass = cn(
  "block w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink",
  "placeholder:text-ink-3 focus:border-accent focus:outline-2 focus:outline-offset-0 focus:outline-accent/30",
  "aria-invalid:border-critical",
);

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs text-critical-ink">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-2">{hint}</p>
      ) : null}
    </div>
  );
}
