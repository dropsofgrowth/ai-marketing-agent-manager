"use client";

import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";

/** PLACEHOLDER identity until real sign-in exists (see src/server/auth/actor.ts). */
export function UserCard({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { dict, t } = useI18n();
  const name = "Demo Operator";
  const avatar = (
    <span
      aria-hidden
      className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-ink-2"
    >
      DO
    </span>
  );

  if (compact) {
    return (
      <div className={cn("grid place-items-center", className)} title={`${t(dict.shell.signedInAs, { name })} · ${dict.shell.roleOwner}`}>
        {avatar}
        <span className="sr-only">{t(dict.shell.signedInAs, { name })}</span>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2.5 rounded-lg border border-line px-3 py-2.5", className)}>
      {avatar}
      <div className="min-w-0 text-xs">
        <p className="truncate font-medium text-ink" title={t(dict.shell.signedInAs, { name })}>
          {name}
        </p>
        <p className="text-ink-2">{dict.shell.roleOwner}</p>
      </div>
    </div>
  );
}
