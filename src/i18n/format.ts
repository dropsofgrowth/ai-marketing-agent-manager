import { currencyDigits, fromMinorUnits } from "@/domain/money";

import { INTL_LOCALE, type Locale } from "./config";

/** Replaces `{name}` placeholders. Values are inserted as text (React escapes them). */
export function interpolate(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

export type Formatter = ReturnType<typeof createFormatter>;

/** Locale-aware formatters. Pure — safe in both server and client components. */
export function createFormatter(locale: Locale) {
  const tag = INTL_LOCALE[locale];

  return {
    locale,

    currency(amountMinor: number, currency: string, options: { compact?: boolean } = {}) {
      const major = fromMinorUnits(amountMinor, currency);
      // Whole amounts drop the decimals ($120); fractional ones show all minor digits ($120.50).
      const digits = options.compact ? 1 : Number.isInteger(major) ? 0 : currencyDigits(currency);
      const formatted = new Intl.NumberFormat(tag, {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
        notation: options.compact ? "compact" : "standard",
        maximumFractionDigits: digits,
        minimumFractionDigits: options.compact ? 0 : digits,
      }).format(major);
      // Arabic ICU data emits e.g. "95.3 ألف US$". In RTL text the trailing "$" is a
      // weak bidi character and flips to "$US"; a left-to-right mark anchors it.
      return locale === "ar" ? formatted.replace(/[A-Za-z]+[$€£¥]/g, (symbol) => `${symbol}‎`) : formatted;
    },

    number(value: number, options: { compact?: boolean; digits?: number } = {}) {
      return new Intl.NumberFormat(tag, {
        notation: options.compact ? "compact" : "standard",
        maximumFractionDigits: options.digits ?? (options.compact ? 1 : 0),
      }).format(value);
    },

    /** `fraction` 0.125 → "12.5%". */
    percent(fraction: number, options: { signed?: boolean; digits?: number } = {}) {
      return new Intl.NumberFormat(tag, {
        style: "percent",
        maximumFractionDigits: options.digits ?? 1,
        signDisplay: options.signed ? "exceptZero" : "auto",
      }).format(fraction);
    },

    /** Return on ad spend, e.g. "3.42×". */
    roas(value: number | null) {
      if (value === null) return "—";
      return `${new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}×`;
    },

    date(value: Date | string, style: "short" | "medium" = "medium") {
      const date = typeof value === "string" ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value) : value;
      return new Intl.DateTimeFormat(tag, {
        timeZone: "UTC",
        ...(style === "short" ? { month: "short", day: "numeric" } : { dateStyle: "medium" }),
      }).format(date);
    },

    dateTime(value: Date | string) {
      return new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(
        typeof value === "string" ? new Date(value) : value,
      );
    },

    /** "3 hours ago" / "in 2 days". Call on the server only (depends on `now`). */
    relative(value: Date, now: Date) {
      const seconds = Math.round((value.getTime() - now.getTime()) / 1000);
      const abs = Math.abs(seconds);
      const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
      if (abs < 60) return rtf.format(seconds, "second");
      if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
      if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), "hour");
      return rtf.format(Math.round(seconds / 86_400), "day");
    },
  };
}
