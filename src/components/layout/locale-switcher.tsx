"use client";

import { Languages } from "lucide-react";
import { usePathname } from "next/navigation";

import { useI18n } from "@/i18n/client";
import { LOCALE_COOKIE, switchLocalePath } from "@/i18n/config";

/**
 * Switches between English and Arabic, keeping the current page. Uses a full
 * navigation so <html lang/dir> and fonts reset cleanly, and stores the choice in
 * a cookie so "/" opens in the preferred language next time.
 */
export function LocaleSwitcher() {
  const pathname = usePathname();
  const { locale, dict } = useI18n();
  const target = locale === "en" ? "ar" : "en";
  const href = switchLocalePath(pathname, target);

  return (
    <a
      href={href}
      hrefLang={target}
      lang={target}
      onClick={() => {
        document.cookie = `${LOCALE_COOKIE}=${target}; path=/; max-age=31536000; samesite=lax`;
      }}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong px-2.5 text-[13px] font-medium text-ink hover:bg-surface-2"
      aria-label={dict.shell.switchLanguageLabel}
    >
      <Languages aria-hidden className="size-4" />
      {dict.shell.switchLanguage}
    </a>
  );
}
