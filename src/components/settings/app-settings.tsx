"use client";

import { Check, Download, MonitorSmartphone, Share, ShieldAlert, SunMoon } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { LOCALES, LOCALE_NAMES, localeCookie, switchLocalePath } from "@/i18n/config";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { getInstallState, getServerInstallState, promptInstall, subscribeInstallState } from "@/lib/pwa/client";

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <dt className="flex items-center gap-2 text-sm text-ink-2">
        {icon}
        {label}
      </dt>
      <dd className="min-w-0 text-sm text-ink sm:text-end">{children}</dd>
    </div>
  );
}

/** Language, appearance and "install as app" — the device-level preferences. */
export function AppSettings() {
  const { locale, dict } = useI18n();
  const s = dict.settings;
  const pathname = usePathname();
  const install = useSyncExternalStore(subscribeInstallState, getInstallState, getServerInstallState);
  const [busy, setBusy] = useState(false);

  return (
    <dl className="divide-y divide-line">
      <Row icon={<MonitorSmartphone aria-hidden className="size-4" />} label={s.language}>
        {/* Full navigation (not client routing) so <html lang/dir> and fonts switch cleanly. */}
        <div role="group" aria-label={s.language} className="inline-flex rounded-lg border border-line-strong p-0.5">
          {LOCALES.map((target) => {
            const current = target === locale;
            return (
              <a
                key={target}
                href={switchLocalePath(pathname, target)}
                hrefLang={target}
                lang={target}
                aria-current={current ? "true" : undefined}
                onClick={() => {
                  document.cookie = localeCookie(target);
                }}
                className={cn(
                  "inline-flex h-8 min-w-24 items-center justify-center gap-1 rounded-md px-3 text-[13px] pointer-coarse:h-10",
                  current ? "bg-accent-soft font-semibold text-accent-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                )}
              >
                {current ? <Check aria-hidden className="size-3.5" strokeWidth={3} /> : null}
                {LOCALE_NAMES[target]}
              </a>
            );
          })}
        </div>
      </Row>

      <Row icon={<SunMoon aria-hidden className="size-4" />} label={s.appearance}>
        <span className="text-ink-2">{s.appearanceSystem}</span>
      </Row>

      <Row icon={<Download aria-hidden className="size-4" />} label={s.install}>
        <div role="status" className="sm:max-w-sm sm:ms-auto">
          {install === "installed" || install === "accepted" ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-good-ink">
              <Check aria-hidden className="size-4" />
              {install === "installed" ? s.installInstalled : s.installAccepted}
            </span>
          ) : install === "promptable" ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await promptInstall();
                setBusy(false);
              }}
            >
              <Download aria-hidden className="size-4" />
              {s.installButton}
            </Button>
          ) : install === "ios" ? (
            <span className="inline-flex items-start gap-1.5 text-ink-2">
              <Share aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-ink" />
              {s.installIos}
            </span>
          ) : install === "insecure" ? (
            <span className="inline-flex items-start gap-1.5 text-warning-ink">
              <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {s.installInsecure}
            </span>
          ) : install === "generic" ? (
            <span className="text-ink-2">{s.installGeneric}</span>
          ) : (
            <span className="text-ink-3">…</span>
          )}
        </div>
      </Row>
    </dl>
  );
}
