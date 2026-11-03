"use client";

import { WifiOff } from "lucide-react";
import { useSyncExternalStore } from "react";

import { useI18n } from "@/i18n/client";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Shown while the browser reports no network, so stale data and failing actions aren't a surprise. */
export function OfflineBanner() {
  const { dict } = useI18n();
  const offline = useSyncExternalStore(
    subscribe,
    () => !navigator.onLine,
    () => false,
  );
  if (!offline) return null;
  return (
    <div role="status" className="px-page border-b border-warning/40 bg-warning-soft py-2 text-xs text-ink sm:text-[13px]">
      <p className="mx-auto flex max-w-[1400px] items-start gap-1.5">
        <WifiOff aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning-ink" />
        {dict.shell.offline}
      </p>
    </div>
  );
}
