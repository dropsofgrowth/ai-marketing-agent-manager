"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { useI18n } from "@/i18n/client";

/**
 * Accessible modal built on the native <dialog> element (focus trapping, Esc to
 * close and inert background come from the browser). On phones it is a bottom
 * sheet (reachable with a thumb, clears the home indicator); from `sm` up it is a
 * centred modal.
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
      className={
        "animate-sheet-in mx-0 mt-auto mb-0 max-h-[92dvh] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-2xl border border-line bg-surface p-0 text-start text-ink shadow-xl " +
        "sm:m-auto sm:max-h-[calc(100dvh-4rem)] sm:w-[calc(100%-2rem)] sm:max-w-lg sm:rounded-xl"
      }
    >
      {open ? (
        <div className="px-4 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-5">
          <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong sm:hidden" />
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 id="dialog-title" className="text-base font-semibold">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="-m-2 grid size-9 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink pointer-coarse:size-10"
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
