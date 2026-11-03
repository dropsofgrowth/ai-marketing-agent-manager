"use client";

import { Compass } from "lucide-react";
import Link from "next/link";

import { buttonClass } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";

export default function NotFound() {
  const { dict, locale } = useI18n();
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <Compass aria-hidden className="mx-auto size-8 text-ink-3" />
      <h1 className="mt-4 text-lg font-semibold text-ink">{dict.errors.notFoundTitle}</h1>
      <p className="mt-2 text-sm text-ink-2">{dict.errors.notFoundBody}</p>
      <Link href={`/${locale}`} className={buttonClass("primary", "md", "mt-6")}>
        {dict.common.backHome}
      </Link>
    </div>
  );
}
