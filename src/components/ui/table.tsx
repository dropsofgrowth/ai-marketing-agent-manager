import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/** Horizontally scrollable table wrapper — keeps the page itself from scrolling sideways. */
export function TableContainer({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="relative overflow-x-auto" role="region" aria-label={label} tabIndex={label ? 0 : undefined}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className, numeric }: { children?: ReactNode; className?: string; numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-line px-4 py-2.5 text-xs font-medium whitespace-nowrap text-ink-2",
        numeric ? "text-end" : "text-start",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className, numeric }: { children?: ReactNode; className?: string; numeric?: boolean }) {
  return (
    <td
      className={cn(
        "border-b border-line px-4 py-3 align-middle text-ink",
        numeric && "tabular text-end whitespace-nowrap",
        className,
      )}
    >
      {children}
    </td>
  );
}
