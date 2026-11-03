import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { Sparkline } from "@/components/charts/sparkline";
import { cn } from "@/lib/cn";

/**
 * KPI tile: label · value · optional delta vs a named period · optional trend.
 * Delta colour = direction × whether "up" is good for this metric.
 */
export function StatTile({
  label,
  value,
  hint,
  delta,
  deltaLabel,
  upIsGood = true,
  trend,
}: {
  label: string;
  value: string;
  hint?: string;
  /** Formatted delta text, e.g. "+12.4%". */
  delta?: { text: string; direction: "up" | "down" | "flat" };
  deltaLabel?: string;
  /** null = neutral metric (e.g. spend): the delta is shown without good/bad colour. */
  upIsGood?: boolean | null;
  /** Daily values for the period, oldest first (sparkline). */
  trend?: number[];
}) {
  const judged = delta && delta.direction !== "flat" && upIsGood !== null;
  const good = judged && (delta.direction === "up") === upIsGood;
  const bad = judged && !good;
  const Icon = !delta || delta.direction === "flat" ? Minus : delta.direction === "up" ? ArrowUpRight : ArrowDownRight;

  return (
    <div className="@container flex min-w-0 flex-col rounded-xl border border-line bg-surface p-3.5 shadow-card sm:p-4">
      <p className="text-xs text-ink-2 sm:text-[13px]" title={hint}>
        {label}
      </p>
      {/* Scales with the tile (container query units) so long localized values like "US$ ألف 95.3" stay on one line. */}
      <p data-kpi-value className="tabular mt-1 text-[clamp(1rem,14cqi,1.5rem)] leading-tight font-semibold tracking-tight whitespace-nowrap text-ink sm:mt-1.5">
        {value}
      </p>
      {delta ? (
        <p className="mt-1 flex flex-wrap items-center gap-x-1 text-xs">
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-medium",
              good && "text-good-ink",
              bad && "text-critical-ink",
              !good && !bad && "text-ink-2",
            )}
          >
            <Icon aria-hidden className="size-3.5" />
            <bdi>{delta.text}</bdi>
          </span>
          {deltaLabel ? <span className="text-ink-3">{deltaLabel}</span> : null}
        </p>
      ) : null}
      {trend ? (
        <div className="mt-auto pt-3">
          <Sparkline values={trend} />
        </div>
      ) : null}
    </div>
  );
}

export function deltaOf(fraction: number | null, format: (f: number) => string) {
  if (fraction === null || !Number.isFinite(fraction)) return undefined;
  const direction = Math.abs(fraction) < 0.0005 ? "flat" : fraction > 0 ? "up" : "down";
  return { text: format(fraction), direction } as const;
}
