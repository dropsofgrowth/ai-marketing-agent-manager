"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { useI18n } from "@/i18n/client";

/**
 * Accessible modal built on the native <dialog> element (focus trapping, Esc to
 * close and inert background come from the browser).
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { dict, dir } = useI18n();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      dir={dir}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose(); // click on backdrop
      }}
      aria-labelledby="dialog-title"
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border text-start border-line bg-surface p-0 text-ink shadow-xl"
    >
      {open ? (
        <div className="p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 id="dialog-title" className="text-base font-semibold">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="-m-1 rounded-md p-1 text-ink-2 hover:bg-surface-2 hover:text-ink"
              aria-label={dict.common.close}
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
