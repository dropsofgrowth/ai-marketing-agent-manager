import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "accent" | "good" | "warning" | "critical";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-ink-2",
  accent: "bg-accent-soft text-accent-ink",
  good: "bg-good-soft text-good-ink",
  warning: "bg-warning-soft text-warning-ink",
  critical: "bg-critical-soft text-critical-ink",
};

/** Small status label. Status meaning is always carried by text (+ icon), never colour alone. */
export function Badge({
  tone = "neutral",
  icon,
  children,
  className,
  wrap = false,
}: {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Let long labels wrap (e.g. sentence-length statuses on narrow screens). */
  wrap?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        wrap ? "text-start" : "whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
