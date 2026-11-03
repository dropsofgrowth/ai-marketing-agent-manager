export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function directionOf(locale: Locale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

/**
 * BCP-47 tags used for Intl formatting. Arabic uses Latin digits ("nu-latn"),
 * which is the norm for ad-platform metrics in Gulf/MENA business tools. Change
 * to "ar" to render Arabic-Indic digits instead.
 */
export const INTL_LOCALE: Record<Locale, string> = {
  en: "en-US",
  ar: "ar-u-nu-latn",
};

/** Swaps the locale prefix of a pathname: ("/en/meta-ads", "ar") → "/ar/meta-ads". */
export function switchLocalePath(pathname: string, locale: Locale): string {
  const segments = pathname.split("/");
  if (isLocale(segments[1])) segments[1] = locale;
  else segments.splice(1, 0, locale);
  return segments.join("/") || `/${locale}`;
}
