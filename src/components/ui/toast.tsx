"use client";

import { CheckCircle2, X, XCircle } from "lucide-react";
import { createContext, useActionState, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { IDLE, type ActionResult } from "@/server/actions/result";

type Toast = { id: number; tone: "success" | "error"; message: string };

const ToastContext = createContext<((toast: Omit<Toast, "id">) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const { dict } = useI18n();

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = Date.now() + Math.random();
      setToasts((all) => [...all.slice(-2), { ...toast, id }]);
      window.setTimeout(() => dismiss(id), 6000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="bottom-above-tabbar pointer-events-none fixed inset-x-4 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:end-6 sm:w-96 md:bottom-6"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex w-full items-start gap-2 rounded-lg border bg-surface px-3.5 py-3 text-sm shadow-lg",
              toast.tone === "success" ? "border-good/40" : "border-critical/40",
            )}
          >
            {toast.tone === "success" ? (
              <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-good-ink" />
            ) : (
              <XCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-critical-ink" />
            )}
            <p className="flex-1 text-ink">{toast.message}</p>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="-m-1 rounded p-1 text-ink-3 hover:text-ink"
              aria-label={dict.common.close}
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

type ServerAction = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

/**
 * useActionState + a toast with the translated result. The toast is raised inside
 * the action (not in an effect) so it still shows when the component unmounts
 * because the refreshed page no longer lists it.
 */
export function useActionWithToast(action: ServerAction, options: { onSuccess?: () => void } = {}) {
  const push = useContext(ToastContext);
  const { dict, t } = useI18n();
  const { onSuccess } = options;

  const wrapped = useMemo(
    () => async (prev: ActionResult, formData: FormData) => {
      const result = await action(prev, formData);
      if (result.status === "success") {
        push?.({ tone: "success", message: t(dict.success[result.code], result.params) });
        onSuccess?.();
      } else if (result.status === "error" && result.code !== "INVALID_INPUT") {
        push?.({ tone: "error", message: t(dict.errors[result.code], result.params) });
      }
      return result;
    },
    [action, push, dict, t, onSuccess],
  );

  return useActionState(wrapped, IDLE);
}
