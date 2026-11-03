import { AlertTriangle, Info, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

const TONES = {
  info: { className: "border-line bg-surface-2 text-ink-2", Icon: Info },
  safety: { className: "border-accent/25 bg-accent-soft text-ink", Icon: ShieldCheck },
  warning: { className: "border-warning/40 bg-warning-soft text-ink", Icon: AlertTriangle },
} as const;

export function Notice({
  tone = "info",
  children,
  className,
}: {
  tone?: keyof typeof TONES;
  children: ReactNode;
  className?: string;
}) {
  const { className: toneClass, Icon } = TONES[tone];
  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm", toneClass, className)}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
