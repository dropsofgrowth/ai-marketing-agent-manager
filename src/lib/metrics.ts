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
