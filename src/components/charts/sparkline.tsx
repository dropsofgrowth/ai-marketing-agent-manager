import { cn } from "@/lib/cn";

/**
 * Tiny trend line for KPI tiles: the period in the de-emphasis grey, the latest
 * point in the accent colour. Decorative context only (aria-hidden) — exact
 * values live in the full charts and their data tables. Time always runs
 * left → right, also in RTL layouts, matching the other charts.
 */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const points = values.filter((v) => Number.isFinite(v));
  if (points.length < 2) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  // 12% headroom so the line and end dot never touch the tile edges.
  const y = (v: number) => 88 - ((v - min) / span) * 76;
  const x = (i: number) => (i / (points.length - 1)) * 100;
  const last = points.length - 1;

  return (
    <div aria-hidden dir="ltr" className={cn("relative h-8", className)}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
        <polyline
          points={points.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
          fill="none"
          stroke="var(--axis)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-surface"
        style={{ left: `${x(last)}%`, top: `${y(points[last])}%` }}
      />
    </div>
  );
}
