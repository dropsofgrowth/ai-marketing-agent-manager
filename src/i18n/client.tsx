"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { directionOf, type Locale } from "./config";
import type { Dictionary } from "./dictionaries";
import { createFormatter, interpolate, type Formatter } from "./format";

type I18nContextValue = {
  locale: Locale;
  dir: "ltr" | "rtl";
  dict: Dictionary;
  fmt: Formatter;
  t: typeof interpolate;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  locale,
  dict,
  children,
}: {
  locale: Locale;
  dict: Dictionary;
  children: ReactNode;
}) {
  const value = useMemo<I18nContextValue>(
    () => ({ locale, dir: directionOf(locale), dict, fmt: createFormatter(locale), t: interpolate }),
    [locale, dict],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside <I18nProvider>");
  return value;
}
