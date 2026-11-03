import type { AdMetrics } from "@/integrations/meta-ads/types";

/** Derived advertising ratios. Every ratio returns null when its denominator is 0. */
export type DerivedMetrics = {
  roas: number | null;
  ctr: number | null;
  cpcMinor: number | null;
  cpaMinor: number | null;
  cpmMinor: number | null;
};

const ratio = (numerator: number, denominator: number) =>
  denominator > 0 ? numerator / denominator : null;

export function deriveMetrics(m: AdMetrics): DerivedMetrics {
  return {
    roas: ratio(m.purchaseValueMinor, m.spendMinor),
    ctr: ratio(m.clicks, m.impressions),
    cpcMinor: ratio(m.spendMinor, m.clicks),
    cpaMinor: ratio(m.spendMinor, m.purchases),
    cpmMinor: ratio(m.spendMinor * 1000, m.impressions),
  };
}

export function sumMetrics(rows: readonly AdMetrics[]): AdMetrics {
  return rows.reduce<AdMetrics>(
    (t, r) => ({
      spendMinor: t.spendMinor + r.spendMinor,
      impressions: t.impressions + r.impressions,
      clicks: t.clicks + r.clicks,
      purchases: t.purchases + r.purchases,
      purchaseValueMinor: t.purchaseValueMinor + r.purchaseValueMinor,
    }),
    { spendMinor: 0, impressions: 0, clicks: 0, purchases: 0, purchaseValueMinor: 0 },
  );
}

/** Relative change from `previous` to `current` as a fraction (0.12 = +12 %). */
export function relativeDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/**
 * Splits `rows` (oldest first) into at most `maxBuckets` runs of consecutive rows
 * and reduces each run to one value — used for KPI sparklines, which read best
 * with ~12–15 points whatever the date range. Runs are cut from the newest end,
 * so the latest point always covers a full run; only the oldest may be shorter.
 * Reducers should return per-day averages or pooled ratios (not raw sums), so a
 * shorter run doesn't look like a dip.
 */
export function bucketSeries<T>(
  rows: readonly T[],
  maxBuckets: number,
  reduce: (run: readonly T[]) => number | null,
): (number | null)[] {
  if (rows.length === 0 || maxBuckets < 1) return [];
  const size = Math.ceil(rows.length / maxBuckets);
  const runs: (readonly T[])[] = [];
  for (let end = rows.length; end > 0; end -= size) runs.unshift(rows.slice(Math.max(0, end - size), end));
  return runs.map(reduce);
}

/** Per-row average of `pick` over a run. */
export const averageOf =
  <T>(pick: (row: T) => number) =>
  (run: readonly T[]): number | null =>
    run.length ? run.reduce((total, row) => total + pick(row), 0) / run.length : null;

/** Pooled ratio Σnumerator / Σdenominator over a run (null when the denominator is 0). */
export const pooledRatioOf =
  <T>(numerator: (row: T) => number, denominator: (row: T) => number) =>
  (run: readonly T[]): number | null =>
    ratio(
      run.reduce((total, row) => total + numerator(row), 0),
      run.reduce((total, row) => total + denominator(row), 0),
    );
