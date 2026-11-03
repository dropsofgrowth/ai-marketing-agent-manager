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
