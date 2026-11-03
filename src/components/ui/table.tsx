import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/** Keeps the first column (the row's name) visible while the figures scroll sideways. */
const STICKY_FIRST_COLUMN = cn(
  "[&_tr>:first-child]:sticky [&_tr>:first-child]:start-0 [&_tr>:first-child]:z-[1] [&_tr>:first-child]:bg-surface",
  "[&_tr>:first-child]:shadow-[inset_-1px_0_0_var(--line)] rtl:[&_tr>:first-child]:shadow-[inset_1px_0_0_var(--line)]",
);

/** Horizontally scrollable table wrapper — keeps the page itself from scrolling sideways. */
export function TableContainer({
  children,
  label,
  className,
  stickyFirstColumn = false,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
  stickyFirstColumn?: boolean;
}) {
  return (
    <div
      className={cn("relative overflow-x-auto overscroll-x-contain", className)}
      role="region"
      aria-label={label}
      tabIndex={label ? 0 : undefined}
    >
      <table className={cn("w-full border-collapse text-sm", stickyFirstColumn && STICKY_FIRST_COLUMN)}>{children}</table>
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
