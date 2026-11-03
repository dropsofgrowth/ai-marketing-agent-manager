import type { Locale } from "@/i18n/config";

import { ar } from "./ar";
import { en, type Dictionary } from "./en";

const DICTIONARIES: Record<Locale, Dictionary> = { en, ar };

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}

export type { Dictionary };
