"use client";

import { Bot } from "lucide-react";
import Link from "next/link";

import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";

/** App logo + name. `iconOnly` is used in the tablet rail, where the name would not fit. */
export function Brand({
  iconOnly = false,
  className,
  iconClassName,
}: {
  iconOnly?: boolean;
  className?: string;
  iconClassName?: string;
}) {
  const { locale, dict } = useI18n();
  return (
    <Link
      href={`/${locale}`}
      className={cn(
        "flex min-w-0 items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        className,
      )}
      aria-label={iconOnly ? dict.meta.appName : undefined}
    >
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-on-accent", iconClassName)}>
        <Bot aria-hidden className="size-[18px]" />
      </span>
      {iconOnly ? null : (
        <span className="truncate text-[15px] font-semibold tracking-tight text-ink">{dict.meta.appName}</span>
      )}
    </Link>
  );
}
