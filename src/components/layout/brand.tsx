"use client";

import { Bot } from "lucide-react";
import Link from "next/link";

import { useI18n } from "@/i18n/client";

export function Brand() {
  const { locale, dict } = useI18n();
  return (
    <Link href={`/${locale}`} className="flex items-center gap-2.5 rounded-md">
      <span className="grid size-8 place-items-center rounded-lg bg-accent text-on-accent">
        <Bot aria-hidden className="size-[18px]" />
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-ink">{dict.meta.appName}</span>
    </Link>
  );
}
