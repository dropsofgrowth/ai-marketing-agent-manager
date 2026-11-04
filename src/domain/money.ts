/** Number of minor-unit digits for an ISO-4217 currency (USD → 2, JPY → 0, KWD → 3). */
export function currencyDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

export function toMinorUnits(amountMajor: number, currency: string): number {
  return Math.round(amountMajor * 10 ** currencyDigits(currency));
}

/**
 * Converts a decimal string from an API (e.g. Shopify's "89.95") to integer minor
 * units without going through floating point. Extra fraction digits round half up.
 */
export function decimalToMinor(amount: string, currency: string): number {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!match) throw new Error("Invalid decimal amount.");
  const [, sign, whole, fraction = ""] = match;
  const digits = currencyDigits(currency);
  const padded = (fraction + "0".repeat(digits + 1)).slice(0, digits + 1);
  let minor = Number(whole) * 10 ** digits + Number(padded.slice(0, digits) || "0");
  if (Number(padded[digits]) >= 5) minor += 1;
  return sign ? -minor : minor;
}

export function fromMinorUnits(amountMinor: number, currency: string): number {
  return amountMinor / 10 ** currencyDigits(currency);
}

/** Signed percentage change from `from` to `to`, rounded to one decimal. */
export function percentChange(from: number, to: number): number {
  if (from === 0) return to === 0 ? 0 : 100;
  return Math.round(((to - from) / from) * 1000) / 10;
}

/** Round a minor-unit amount to the nearest whole major unit (e.g. whole dollars). */
export function roundToWholeMajor(amountMinor: number, currency: string): number {
  const factor = 10 ** currencyDigits(currency);
  return Math.round(amountMinor / factor) * factor;
}
