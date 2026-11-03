"use client";

import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useI18n } from "@/i18n/client";

import { Brand } from "./brand";
import { NavLinks } from "./nav";

/** Off-canvas navigation for small screens (native <dialog> for focus handling). */
export function MobileNav({ pendingCount }: { pendingCount: number | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const { dict, dir } = useI18n();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="-ms-1.5 rounded-md p-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink lg:hidden"
        aria-label={dict.shell.openMenu}
        aria-expanded={open}
      >
        <Menu aria-hidden className="size-5" />
      </button>
      <dialog
        ref={ref}
        dir={dir}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === ref.current) setOpen(false);
        }}
        className="m-0 h-dvh max-h-none w-72 max-w-[85vw] border-e border-line bg-surface p-0 text-ink ltr:me-auto rtl:ms-auto"
        aria-label={dict.nav.main}
      >
        <div className="flex h-full flex-col gap-6 p-4">
          <div className="flex items-center justify-between">
            <Brand />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink"
              aria-label={dict.shell.closeMenu}
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
          <NavLinks pendingCount={pendingCount} onNavigate={() => setOpen(false)} />
        </div>
      </dialog>
    </>
  );
}
