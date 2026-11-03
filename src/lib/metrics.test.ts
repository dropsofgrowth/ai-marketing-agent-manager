import { describe, expect, it } from "vitest";

import { averageOf, bucketSeries, pooledRatioOf } from "@/lib/metrics";

describe("bucketSeries", () => {
  const days = Array.from({ length: 30 }, (_, i) => ({ value: i + 1, num: i, den: 10 }));

  it("keeps short series as one point per row", () => {
    expect(bucketSeries(days.slice(0, 7), 15, averageOf((d) => d.value))).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("caps the number of points and cuts runs from the newest end", () => {
    const points = bucketSeries(days, 14, averageOf((d) => d.value));
    // ceil(30 / 14) = 3 days per run → 10 runs; newest run is days 28–30.
    expect(points).toHaveLength(10);
    expect(points.at(-1)).toBe(29);
    expect(points[0]).toBe(2);
  });

  it("averages a shorter oldest run instead of summing it", () => {
    const points = bucketSeries(days.slice(0, 7), 3, averageOf((d) => d.value));
    // runs: [1], [2,3,4], [5,6,7]
    expect(points).toEqual([1, 3, 6]);
  });

  it("pools ratios and returns null for a zero denominator", () => {
    const rows = [
      { num: 1, den: 2 },
      { num: 3, den: 2 },
      { num: 5, den: 0 },
    ];
    expect(bucketSeries(rows, 3, pooledRatioOf((r) => r.num, (r) => r.den))).toEqual([0.5, 1.5, null]);
    expect(bucketSeries(rows, 1, pooledRatioOf((r) => r.num, (r) => r.den))).toEqual([9 / 4]);
  });

  it("handles empty input", () => {
    expect(bucketSeries([], 10, averageOf((d: { v: number }) => d.v))).toEqual([]);
  });
});
