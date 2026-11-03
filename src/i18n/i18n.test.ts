import { describe, expect, it } from "vitest";

import { directionOf, switchLocalePath } from "@/i18n/config";
import { ar } from "@/i18n/dictionaries/ar";
import { en } from "@/i18n/dictionaries/en";
import { createFormatter, interpolate } from "@/i18n/format";

type Tree = { [key: string]: string | readonly string[] | Tree };

function leaves(tree: Tree, prefix = ""): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") return [[path, value] as [string, string]];
    if (Array.isArray(value)) return value.map((v, i) => [`${path}[${i}]`, v] as [string, string]);
    return leaves(value as Tree, path);
  });
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("dictionaries", () => {
  const enLeaves = new Map(leaves(en as unknown as Tree));
  const arLeaves = new Map(leaves(ar as unknown as Tree));

  it("have the same keys", () => {
    expect([...arLeaves.keys()].sort()).toEqual([...enLeaves.keys()].sort());
  });

  it("use the same placeholders in every string", () => {
    const mismatches = [...enLeaves].filter(
      ([key, value]) => placeholders(value).join() !== placeholders(arLeaves.get(key) ?? "").join(),
    );
    expect(mismatches.map(([key]) => key)).toEqual([]);
  });

  it("have no empty strings", () => {
    expect([...arLeaves].filter(([, v]) => !v.trim()).map(([k]) => k)).toEqual([]);
  });
});

describe("formatting", () => {
  it("interpolates placeholders", () => {
    expect(interpolate("Hello {name}, {n} new", { name: "Sara", n: 3 })).toBe("Hello Sara, 3 new");
    expect(interpolate("Keep {missing}", {})).toBe("Keep {missing}");
  });

  it("formats currency from minor units", () => {
    const fmt = createFormatter("en");
    expect(fmt.currency(12_000, "USD")).toBe("$120");
    expect(fmt.currency(12_050, "USD")).toBe("$120.50");
    expect(fmt.currency(9_530_000, "USD", { compact: true })).toBe("$95.3K");
  });

  it("uses Latin digits in Arabic and keeps the currency symbol in order", () => {
    const value = createFormatter("ar").currency(12_000, "USD");
    expect(value).toMatch(/120/);
    expect(value).toContain("US$‎");
  });

  it("formats ROAS and signed percentages", () => {
    const fmt = createFormatter("en");
    expect(fmt.roas(3.456)).toBe("3.46×");
    expect(fmt.roas(null)).toBe("—");
    expect(fmt.percent(0.2, { signed: true })).toBe("+20%");
  });
});

describe("locale routing helpers", () => {
  it("swaps or inserts the locale prefix", () => {
    expect(switchLocalePath("/en/meta-ads", "ar")).toBe("/ar/meta-ads");
    expect(switchLocalePath("/en", "ar")).toBe("/ar");
    expect(switchLocalePath("/settings", "en")).toBe("/en/settings");
  });

  it("knows text direction", () => {
    expect(directionOf("ar")).toBe("rtl");
    expect(directionOf("en")).toBe("ltr");
  });
});
