import "server-only";

import { notFound } from "next/navigation";

import { directionOf, isLocale, type Locale } from "./config";
import { getDictionary } from "./dictionaries";
import { createFormatter, interpolate } from "./format";

/** Resolves the dictionary and formatters for a `[lang]` route segment value. */
export function getI18n(lang: string) {
  if (!isLocale(lang)) notFound();
  const locale: Locale = lang;
  return {
    locale,
    dir: directionOf(locale),
    dict: getDictionary(locale),
    fmt: createFormatter(locale),
    t: interpolate,
  };
}

export type ServerI18n = ReturnType<typeof getI18n>;
