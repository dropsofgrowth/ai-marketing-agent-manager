import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Phone alternative to a wide table (shown below `md`): one stacked record per
 * row, so nothing scrolls sideways. Pair it with a <TableContainer
 * className="hidden md:block"> rendering the same rows for larger screens.
 */
export function DataList({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <ul aria-label={label} className={cn("divide-y divide-line md:hidden", className)}>
      {children}
    </ul>
  );
}

export function DataListItem({
  title,
  subtitle,
  leading,
  aside,
  children,
  footer,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Thumbnail / swatch before the title. */
  leading?: ReactNode;
  /** Status badge or key figure opposite the title. */
  aside?: ReactNode;
  /** Usually a <MetricGrid>. */
  children?: ReactNode;
  /** Row actions. */
  footer?: ReactNode;
}) {
  return (
    <li className="px-4 py-3.5 sm:px-5">
      <div className="flex items-start gap-3">
        {leading}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium break-words text-ink">{title}</div>
          {subtitle ? <div className="mt-0.5 text-xs text-ink-2">{subtitle}</div> : null}
        </div>
        {aside ? <div className="flex shrink-0 flex-col items-end gap-1 text-end">{aside}</div> : null}
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
      {footer ? <div className="mt-3">{footer}</div> : null}
    </li>
  );
}

/**
 * Label-over-value grid for a record's figures. `columns={3}` drops to 2 on the
 * narrowest phones. Values wrap rather than truncate — figures are never hidden.
 */
export function MetricGrid({
  items,
  columns = 3,
}: {
  items: { label: string; value: ReactNode; className?: string }[];
  columns?: 2 | 3;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-x-3 gap-y-2.5 rounded-lg bg-surface-2/70 px-3 py-2.5",
        columns === 3 && "min-[360px]:grid-cols-3",
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="truncate text-[11px] text-ink-2">{item.label}</dt>
          <dd className={cn("tabular text-sm font-medium break-words text-ink", item.className)}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
